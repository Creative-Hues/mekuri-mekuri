import type { Editor, JSONContent } from '@tiptap/core'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { Page, Sticky } from '../../db/db'
import { savePageContent, savePageStickies } from '../../db/repo'
import { NoteHistory, type HistoryApplier } from '../../history/noteHistory'
import { movableAt, planMove, planMoveAdjacent, type MoveSource } from '../../editor/blockMove'

/** 入力が止まってから保存するまでの時間(ミリ秒) */
const SAVE_DELAY = 500

/** 行の選択モードの状態 */
export interface SelectState {
  /** 選択モード中か */
  active: boolean
  /** 「ここへ移動」を押して、移動先のタップを待っているか */
  placing: boolean
}

/**
 * 開いているノート1冊分の状態をまとめたもの。
 * - 表示中のエディタ(ページ本文・付箋)
 * - 最新のページ内容・付箋(エディタを作り直すときに使う)
 * - 自動保存の待ち
 * - 元に戻す/やり直しの履歴
 * - 行の選択モード
 */
export class NoteSession {
  readonly history: NoteHistory
  private editors = new Map<string, Editor>()
  private latest = new Map<string, JSONContent>()
  private pending = new Map<string, ReturnType<typeof setTimeout>>()
  private latestStickies = new Map<string, Sticky[]>()
  private pendingStickies = new Map<string, ReturnType<typeof setTimeout>>()
  private stickyEditors = new Map<string, Editor>()
  private stored = new Map<string, Page>()
  private schema: Schema | null = null
  private listeners = new Set<() => void>()
  /** 最後に触ったページ(ツールバーの操作対象) */
  activePageId: string | null = null
  /** 最後に触った付箋(付箋の文字を書いているときは、ツールバーは付箋に効く) */
  activeStickyId: string | null = null
  /** 追加した直後で、カーソルを置きたい付箋 */
  focusStickyId: string | null = null
  /** 行の選択モード */
  select: SelectState = { active: false, placing: false }
  /** 選んだ行(ページごとの位置。選択モード中はページを編集できないので位置はずれない) */
  private selected = new Map<string, Set<number>>()

  constructor(
    readonly noteId: string,
    private applier: Omit<HistoryApplier, 'setPageContent' | 'setStickies'> & {
      /** ページを表示位置まで送る */
      showPage: (pageId: string) => void
    },
  ) {
    this.history = new NoteHistory({
      ...applier,
      setPageContent: async (pageId, doc) => {
        applier.showPage(pageId)
        await this.applyDoc(pageId, doc)
      },
      setStickies: async (pageId, stickies) => {
        applier.showPage(pageId)
        await this.applyStickies(pageId, stickies)
      },
    })
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** 書式の状態などが変わったことを知らせる(ツールバーなどの表示更新用) */
  emit() {
    this.listeners.forEach((fn) => fn())
  }

  /** 保存済みのページ(ノート画面が、一覧が変わるたびに渡す) */
  syncPages(pages: Page[]) {
    this.stored = new Map(pages.map((p) => [p.id, p]))
  }

  /** ページの順(0から)。見つからなければ -1 */
  pageIndex(pageId: string): number {
    return [...this.stored.keys()].indexOf(pageId)
  }

  // ---- エディタの登録 ----

  register(pageId: string, editor: Editor) {
    this.editors.set(pageId, editor)
    this.schema ??= editor.schema
    if (this.select.active) editor.setEditable(false)
    // ハンドルなど、エディタができるのを待っている部品に知らせる
    this.emit()
  }

  unregister(pageId: string, editor: Editor) {
    if (this.editors.get(pageId) === editor) this.editors.delete(pageId)
  }

  getEditor(pageId: string | null): Editor | undefined {
    return pageId ? this.editors.get(pageId) : undefined
  }

  /** 表示中のページのエディタすべて */
  get pageEditors(): [string, Editor][] {
    return [...this.editors.entries()].filter(([, e]) => !e.isDestroyed)
  }

  registerSticky(stickyId: string, editor: Editor) {
    this.stickyEditors.set(stickyId, editor)
    if (this.select.active) editor.setEditable(false)
  }

  unregisterSticky(stickyId: string, editor: Editor) {
    if (this.stickyEditors.get(stickyId) === editor) this.stickyEditors.delete(stickyId)
    if (this.activeStickyId === stickyId) this.activeStickyId = null
  }

  getStickyEditor(stickyId: string): Editor | undefined {
    const e = this.stickyEditors.get(stickyId)
    return e && !e.isDestroyed ? e : undefined
  }

  /** ツールバーの操作対象:付箋を書いているときは付箋、そうでなければページ */
  get activeEditor(): Editor | undefined {
    if (this.activeStickyId) {
      const sticky = this.getStickyEditor(this.activeStickyId)
      if (sticky) return sticky
    }
    return this.getEditor(this.activePageId)
  }

  /** エディタを作るときの最初の内容(未保存の最新内容があればそちらを優先) */
  initialContent(pageId: string, stored: JSONContent): JSONContent {
    return this.latest.get(pageId) ?? stored
  }

  /** ページの今の内容(エディタがあればエディタの内容)。わからなければ null */
  getDoc(pageId: string): PMNode | null {
    const editor = this.editors.get(pageId)
    if (editor && !editor.isDestroyed) return editor.state.doc
    const json = this.latest.get(pageId) ?? this.stored.get(pageId)?.content
    if (!json || !this.schema) return null
    try {
      return this.schema.nodeFromJSON(json)
    } catch (e) {
      console.error('ページの内容を読めませんでした', e)
      return null
    }
  }

  // ---- 本文の保存 ----

  /** エディタの内容が変わったとき:少し待ってから保存する */
  changed(pageId: string, content: JSONContent) {
    this.latest.set(pageId, content)
    const t = this.pending.get(pageId)
    if (t) clearTimeout(t)
    this.pending.set(
      pageId,
      setTimeout(() => void this.flushContent(pageId), SAVE_DELAY),
    )
  }

  private async flushContent(pageId: string): Promise<void> {
    const t = this.pending.get(pageId)
    if (!t) return
    clearTimeout(t)
    this.pending.delete(pageId)
    const content = this.latest.get(pageId)
    if (content) await savePageContent(pageId, content)
  }

  /** 待っている保存(本文・付箋)をすぐ実行する */
  async flush(pageId: string): Promise<void> {
    await Promise.all([this.flushContent(pageId), this.flushStickies(pageId)])
  }

  async flushAll(): Promise<void> {
    const ids = new Set([...this.pending.keys(), ...this.pendingStickies.keys()])
    await Promise.all([...ids].map((id) => this.flush(id)))
  }

  /** ページが消えたとき、そのページの保存待ちを捨てる */
  forget(pageId: string) {
    for (const map of [this.pending, this.pendingStickies]) {
      const t = map.get(pageId)
      if (t) clearTimeout(t)
      map.delete(pageId)
    }
    this.latest.delete(pageId)
    this.latestStickies.delete(pageId)
    this.selected.delete(pageId)
  }

  /** ページ内容を差し替えて保存する(元に戻す・行の移動)。履歴には記録しない */
  async applyDoc(pageId: string, doc: PMNode) {
    const json = doc.toJSON() as JSONContent
    const t = this.pending.get(pageId)
    if (t) clearTimeout(t)
    this.pending.delete(pageId)
    this.latest.set(pageId, json)
    // 内容が変わると、選んでいた行の位置が合わなくなるので選び直してもらう
    this.selected.delete(pageId)
    const editor = this.editors.get(pageId)
    if (editor && !editor.isDestroyed) {
      this.history.silently(() => {
        editor.commands.setContent(json, { emitUpdate: false })
      })
    }
    await savePageContent(pageId, json)
  }

  // ---- 付箋 ----

  /** ページの今の付箋 */
  getStickies(pageId: string): Sticky[] {
    return this.latestStickies.get(pageId) ?? this.stored.get(pageId)?.stickies ?? []
  }

  /**
   * 付箋を変更する(追加・移動・大きさ・色・文字・削除)。
   * mergeKey が同じ変更が続いたら、1回の「元に戻す」にまとめる
   */
  updateStickies(pageId: string, fn: (list: Sticky[]) => Sticky[], mergeKey: string | null = null) {
    const before = this.getStickies(pageId)
    const after = fn(before)
    if (after === before) return
    this.latestStickies.set(pageId, after)
    this.history.recordStickies(pageId, before, after, mergeKey)
    const t = this.pendingStickies.get(pageId)
    if (t) clearTimeout(t)
    this.pendingStickies.set(
      pageId,
      setTimeout(() => void this.flushStickies(pageId), SAVE_DELAY),
    )
    this.emit()
  }

  private async flushStickies(pageId: string): Promise<void> {
    const t = this.pendingStickies.get(pageId)
    if (!t) return
    clearTimeout(t)
    this.pendingStickies.delete(pageId)
    const list = this.latestStickies.get(pageId)
    if (list) await savePageStickies(pageId, list)
  }

  /** 元に戻す/やり直しで付箋を差し替える */
  private async applyStickies(pageId: string, stickies: Sticky[]) {
    const t = this.pendingStickies.get(pageId)
    if (t) clearTimeout(t)
    this.pendingStickies.delete(pageId)
    this.latestStickies.set(pageId, stickies)
    this.emit()
    await savePageStickies(pageId, stickies)
  }

  // ---- 行の選択モード ----

  setSelectMode(active: boolean) {
    this.select = { active, placing: false }
    if (!active) this.selected.clear()
    // 選択モード中は文字を書けないようにする(選んだ行の位置がずれないように)
    for (const [, e] of this.pageEditors) e.setEditable(!active)
    for (const e of this.stickyEditors.values()) if (!e.isDestroyed) e.setEditable(!active)
    if (active) (document.activeElement as HTMLElement | null)?.blur?.()
    this.emit()
  }

  setPlacing(placing: boolean) {
    this.select = { ...this.select, placing }
    this.emit()
  }

  isSelected(pageId: string, pos: number): boolean {
    return this.selected.get(pageId)?.has(pos) ?? false
  }

  toggleSelected(pageId: string, pos: number, on?: boolean) {
    let set = this.selected.get(pageId)
    if (!set) {
      set = new Set()
      this.selected.set(pageId, set)
    }
    const next = on ?? !set.has(pos)
    if (next) set.add(pos)
    else set.delete(pos)
    this.emit()
  }

  get selectedCount(): number {
    let n = 0
    for (const s of this.selected.values()) n += s.size
    return n
  }

  /** 選んだ行(ページの順) */
  selectedSources(): MoveSource[] {
    return [...this.selected.entries()]
      .filter(([, set]) => set.size > 0)
      .map(([pageId, set]) => ({ pageId, positions: [...set] }))
      .sort((a, b) => this.pageIndex(a.pageId) - this.pageIndex(b.pageId))
  }

  // ---- 行の移動 ----

  /**
   * 行を移動する(ドラッグ・選択モード・別のページへ)。
   * 関わったページをまとめて1回の「元に戻す」で戻せるように記録する。動かせたら true
   */
  async moveBlocks(sources: MoveSource[], target: { pageId: string; pos: number }): Promise<boolean> {
    const docs = new Map<string, PMNode>()
    for (const id of new Set([...sources.map((s) => s.pageId), target.pageId])) {
      const doc = this.getDoc(id)
      if (!doc) return false
      docs.set(id, doc)
    }
    const result = planMove(docs, sources, target)
    if (!result) return false
    this.history.recordMove([...result.docs].map(([pageId, after]) => ({ pageId, before: docs.get(pageId)!, after })))
    await Promise.all([...result.docs].map(([pageId, doc]) => this.applyDoc(pageId, doc)))
    this.emit()
    return true
  }

  /** カーソルのある行を1つ上/下へ(Alt+↑ / Alt+↓)。動かせたら true */
  moveAdjacent(editor: Editor, pageId: string, dir: 'up' | 'down'): boolean {
    const { state } = editor
    const result = planMoveAdjacent(state.doc, state.selection.from, dir)
    if (!result) return false
    const before = state.doc
    // カーソルが行のどこにあったかを覚えておき、動かした先でも同じ所に置く
    const offset = state.selection.from - (movableAt(before, state.selection.from)?.pos ?? 0)
    this.history.recordMove([{ pageId, before, after: result.doc }])
    this.history.silently(() => {
      const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, result.doc.content)
      const pos = Math.min(result.insertedAt + offset, tr.doc.content.size)
      tr.setSelection(TextSelection.near(tr.doc.resolve(pos)))
      // 保存は、エディタの onUpdate(session.changed)でいつもどおり行われる
      editor.view.dispatch(tr.scrollIntoView())
    })
    return true
  }
}
