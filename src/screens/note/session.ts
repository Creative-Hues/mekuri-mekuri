import type { Editor, JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { savePageContent } from '../../db/repo'
import { NoteHistory, type HistoryApplier } from '../../history/noteHistory'

/** 入力が止まってから保存するまでの時間(ミリ秒) */
const SAVE_DELAY = 500

/**
 * 開いているノート1冊分の状態をまとめたもの。
 * - 表示中のエディタ
 * - 最新のページ内容(エディタを作り直すときに使う)
 * - 自動保存の待ち
 * - 元に戻す/やり直しの履歴
 */
export class NoteSession {
  readonly history: NoteHistory
  private editors = new Map<string, Editor>()
  private latest = new Map<string, JSONContent>()
  private pending = new Map<string, ReturnType<typeof setTimeout>>()
  private listeners = new Set<() => void>()
  /** 最後に触ったページ(仮のボタン列の操作対象) */
  activePageId: string | null = null

  constructor(
    readonly noteId: string,
    applier: Omit<HistoryApplier, 'setPageContent'> & {
      /** ページを表示位置まで送る */
      showPage: (pageId: string) => void
    },
  ) {
    this.history = new NoteHistory({
      ...applier,
      setPageContent: async (pageId, doc) => {
        applier.showPage(pageId)
        await this.setContent(pageId, doc)
      },
    })
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** 書式の状態などが変わったことを知らせる(仮のボタン列の表示更新用) */
  emit() {
    this.listeners.forEach((fn) => fn())
  }

  // ---- エディタの登録 ----

  register(pageId: string, editor: Editor) {
    this.editors.set(pageId, editor)
  }

  unregister(pageId: string, editor: Editor) {
    if (this.editors.get(pageId) === editor) this.editors.delete(pageId)
  }

  getEditor(pageId: string | null): Editor | undefined {
    return pageId ? this.editors.get(pageId) : undefined
  }

  get activeEditor(): Editor | undefined {
    return this.getEditor(this.activePageId)
  }

  /** エディタを作るときの最初の内容(未保存の最新内容があればそちらを優先) */
  initialContent(pageId: string, stored: JSONContent): JSONContent {
    return this.latest.get(pageId) ?? stored
  }

  // ---- 保存 ----

  /** エディタの内容が変わったとき:少し待ってから保存する */
  changed(pageId: string, content: JSONContent) {
    this.latest.set(pageId, content)
    const t = this.pending.get(pageId)
    if (t) clearTimeout(t)
    this.pending.set(
      pageId,
      setTimeout(() => void this.flush(pageId), SAVE_DELAY),
    )
  }

  /** 待っている保存をすぐ実行する */
  async flush(pageId: string): Promise<void> {
    const t = this.pending.get(pageId)
    if (!t) return
    clearTimeout(t)
    this.pending.delete(pageId)
    const content = this.latest.get(pageId)
    if (content) await savePageContent(pageId, content)
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.pending.keys()].map((id) => this.flush(id)))
  }

  /** ページが消えたとき、そのページの保存待ちを捨てる */
  forget(pageId: string) {
    const t = this.pending.get(pageId)
    if (t) clearTimeout(t)
    this.pending.delete(pageId)
    this.latest.delete(pageId)
  }

  /** 元に戻す/やり直しでページ内容を差し替える */
  private async setContent(pageId: string, doc: PMNode) {
    const json = doc.toJSON() as JSONContent
    const t = this.pending.get(pageId)
    if (t) clearTimeout(t)
    this.pending.delete(pageId)
    this.latest.set(pageId, json)
    const editor = this.editors.get(pageId)
    if (editor && !editor.isDestroyed) {
      // 履歴に記録されないよう history.isApplying の間に差し替える
      editor.commands.setContent(json, { emitUpdate: false })
    }
    await savePageContent(pageId, json)
  }
}
