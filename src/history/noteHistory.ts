import type { Node as PMNode } from '@tiptap/pm/model'
import type { NoteDesign, Page, Sticky } from '../db/db'

/**
 * ノート単位の「元に戻す/やり直し」の履歴。
 * 文章の編集・行の移動・付箋・ページの追加/削除/並び替え・タイトル変更・デザインを1本の履歴で扱う。
 * 履歴はメモリ上だけに持ち、アプリを閉じると消える。
 */

export type HistoryEntry =
  | {
      kind: 'text'
      pageId: string
      /** 変更前・変更後のページ内容(ProseMirrorのノードは不変なので参照を持つだけで安全) */
      before: PMNode
      after: PMNode
      /** まとめる判定用:最後に記録した時刻 */
      lastAt: number
    }
  | { kind: 'addPage'; page: Page; index: number }
  | { kind: 'deletePage'; page: Page; index: number }
  | { kind: 'rename'; before: string; after: string }
  /** ノートのデザイン(紙・縁・表紙) */
  | { kind: 'design'; before: NoteDesign; after: NoteDesign }
  | { kind: 'pageOrder'; before: string[]; after: string[] }
  | {
      kind: 'stickies'
      pageId: string
      /** 変更前・変更後のそのページの付箋すべて */
      before: Sticky[]
      after: Sticky[]
      /** 同じ付箋への続けての文字入力を1回にまとめるための目印(null ならまとめない) */
      mergeKey: string | null
      lastAt: number
    }
  /** 複数の変更を1回の「元に戻す」で戻す(別のページへの行の移動など) */
  | { kind: 'group'; entries: HistoryEntry[] }

/** 実際に元に戻す/やり直す処理(ノート画面が用意する) */
export interface HistoryApplier {
  /** ページ内容を指定の内容にする */
  setPageContent(pageId: string, doc: PMNode): Promise<void>
  /** ページを完全に削除し、削除時点のページ(内容込み)を返す(ページの追加を元に戻すとき) */
  removePage(pageId: string): Promise<Page | null>
  /** ページをゴミ箱に入れ、その時点のページ(内容込み)を返す(ページの削除をやり直すとき) */
  trashPage(pageId: string): Promise<Page | null>
  /** ページを index の位置に戻す(ゴミ箱に入っていれば、ゴミ箱から出す) */
  restorePage(page: Page, index: number): Promise<void>
  rename(title: string): Promise<void>
  setDesign(design: NoteDesign): Promise<void>
  /** ページを pageIds の順に並べる */
  reorderPages(pageIds: string[]): Promise<void>
  /** ページの付箋を指定のものにする */
  setStickies(pageId: string, stickies: Sticky[]): Promise<void>
}

/** これ以内の連続入力は1回の「元に戻す」にまとめる(ミリ秒) */
const GROUP_DELAY = 700
const LIMIT = 200

export class NoteHistory {
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []
  private listeners = new Set<() => void>()
  /** 元に戻す処理の最中に起きた変更を記録しないための目印 */
  private applying = false
  /** 次の文章変更は前とまとめない */
  private breakGroup = false
  private busy: Promise<void> = Promise.resolve()

  constructor(private applier: HistoryApplier) {}

  get isApplying(): boolean {
    return this.applying
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    this.listeners.forEach((fn) => fn())
  }

  private push(entry: HistoryEntry) {
    this.undoStack.push(entry)
    if (this.undoStack.length > LIMIT) this.undoStack.shift()
    this.redoStack = []
    this.emit()
  }

  /** 文章の変更を記録する(エディタの変更ごとに呼ばれる) */
  recordText(pageId: string, before: PMNode, after: PMNode) {
    if (this.applying) return
    const now = Date.now()
    const top = this.undoStack[this.undoStack.length - 1]
    if (
      !this.breakGroup &&
      top?.kind === 'text' &&
      top.pageId === pageId &&
      now - top.lastAt < GROUP_DELAY &&
      this.redoStack.length === 0
    ) {
      top.after = after
      top.lastAt = now
      return
    }
    this.breakGroup = false
    this.push({ kind: 'text', pageId, before, after, lastAt: now })
  }

  /**
   * 履歴に残さない変更(トグル見出しの開閉など)があったとき、
   * 直前の記録の「変更後」を今の内容に合わせる(やり直しで開閉が戻らないように)
   */
  syncLatest(pageId: string, doc: PMNode) {
    if (this.applying) return
    const top = this.undoStack[this.undoStack.length - 1]
    if (top?.kind === 'text' && top.pageId === pageId && this.redoStack.length === 0) {
      top.after = doc
    }
  }

  /** 書式の変更などで、次の入力を新しいまとまりにしたいとき */
  closeGroup() {
    this.breakGroup = true
  }

  recordAddPage(page: Page, index: number) {
    this.breakGroup = true
    this.push({ kind: 'addPage', page, index })
  }

  recordDeletePage(page: Page, index: number) {
    this.breakGroup = true
    this.push({ kind: 'deletePage', page, index })
  }

  recordDesign(before: NoteDesign, after: NoteDesign) {
    if (JSON.stringify(before) === JSON.stringify(after)) return
    this.breakGroup = true
    this.push({ kind: 'design', before, after })
  }

  recordRename(before: string, after: string) {
    if (before === after) return
    this.breakGroup = true
    this.push({ kind: 'rename', before, after })
  }

  /**
   * 履歴に残さずに変更する(自分で記録する変更:行の移動など)。
   * fn の中で起きたエディタの変更は recordText されない
   */
  silently(fn: () => void) {
    const was = this.applying
    this.applying = true
    try {
      fn()
    } finally {
      this.applying = was
    }
  }

  /** 行の移動を記録する(関わったページの変更前後。複数ページでも1回で戻す) */
  recordMove(changes: { pageId: string; before: PMNode; after: PMNode }[]) {
    if (!changes.length) return
    this.breakGroup = true
    this.push({
      kind: 'group',
      entries: changes.map((c) => ({ kind: 'text', pageId: c.pageId, before: c.before, after: c.after, lastAt: 0 })),
    })
    this.breakGroup = true
  }

  /**
   * 付箋の変更を記録する。
   * mergeKey が同じで続けて(GROUP_DELAY 以内)変更したときは1回にまとめる(付箋の文字入力・ドラッグ中の移動)
   */
  recordStickies(pageId: string, before: Sticky[], after: Sticky[], mergeKey: string | null = null) {
    if (this.applying) return
    const now = Date.now()
    const top = this.undoStack[this.undoStack.length - 1]
    if (
      mergeKey &&
      !this.breakGroup &&
      top?.kind === 'stickies' &&
      top.pageId === pageId &&
      top.mergeKey === mergeKey &&
      now - top.lastAt < GROUP_DELAY &&
      this.redoStack.length === 0
    ) {
      top.after = after
      top.lastAt = now
      return
    }
    this.breakGroup = false
    this.push({ kind: 'stickies', pageId, before, after, mergeKey, lastAt: now })
    // 付箋の変更のあとに本文を書いたら、別の「元に戻す」にする
    if (!mergeKey) this.breakGroup = true
  }

  recordPageOrder(before: string[], after: string[]) {
    if (before.join() === after.join()) return
    this.breakGroup = true
    this.push({ kind: 'pageOrder', before, after })
  }

  undo(): Promise<void> {
    return this.enqueue(async () => {
      const entry = this.undoStack.pop()
      if (!entry) return
      await this.run(entry, 'undo')
      this.redoStack.push(entry)
    })
  }

  redo(): Promise<void> {
    return this.enqueue(async () => {
      const entry = this.redoStack.pop()
      if (!entry) return
      await this.run(entry, 'redo')
      this.undoStack.push(entry)
    })
  }

  /** 連打しても順番に処理する */
  private enqueue(task: () => Promise<void>): Promise<void> {
    this.busy = this.busy.then(async () => {
      this.applying = true
      this.breakGroup = true
      try {
        await task()
      } catch (e) {
        console.error('元に戻す/やり直しに失敗しました', e)
      } finally {
        this.applying = false
        this.emit()
      }
    })
    return this.busy
  }

  private async run(entry: HistoryEntry, dir: 'undo' | 'redo') {
    const a = this.applier
    switch (entry.kind) {
      case 'text':
        await a.setPageContent(entry.pageId, dir === 'undo' ? entry.before : entry.after)
        break
      case 'addPage':
        if (dir === 'undo') {
          // やり直しのときに同じ内容で戻せるよう、削除時点の内容を覚えておく
          const removed = await a.removePage(entry.page.id)
          if (removed) entry.page = removed
        } else {
          await a.restorePage(entry.page, entry.index)
        }
        break
      case 'deletePage':
        // 削除したページはゴミ箱に入っている。元に戻すとゴミ箱から戻り、やり直すと再びゴミ箱へ
        if (dir === 'undo') {
          await a.restorePage(entry.page, entry.index)
        } else {
          const trashed = await a.trashPage(entry.page.id)
          if (trashed) entry.page = trashed
        }
        break
      case 'rename':
        await a.rename(dir === 'undo' ? entry.before : entry.after)
        break
      case 'design':
        await a.setDesign(dir === 'undo' ? entry.before : entry.after)
        break
      case 'pageOrder':
        await a.reorderPages(dir === 'undo' ? entry.before : entry.after)
        break
      case 'stickies':
        await a.setStickies(entry.pageId, dir === 'undo' ? entry.before : entry.after)
        break
      case 'group': {
        const list = dir === 'undo' ? [...entry.entries].reverse() : entry.entries
        for (const e of list) await this.run(e, dir)
        break
      }
    }
  }
}
