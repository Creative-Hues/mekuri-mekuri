import { restorePages, retrashPages, setFavorite, setFavorites, setNoteOrder, setNotesDeletedAt } from '../db/repo'

/**
 * 本棚の「元に戻す/やり直し」の履歴(ノートの並び替え・お気に入り・まとめての操作)。
 * ノートの中の履歴(noteHistory.ts)とは別。アプリを閉じると消える。
 * 本棚の画面で、ボタンと Ctrl+Z(Macは⌘+Z)で使う。
 * 完全に削除は取り消せないので、ここには入れない(もう完全に削除したノート・ページは、元に戻すときに飛ばす)
 */

export type ShelfEntry =
  | { kind: 'order'; before: string[]; after: string[] }
  | { kind: 'favorite'; noteId: string; before: boolean; after: boolean }
  /** まとめてお気に入りを付ける/外す(ノートごとの前と後) */
  | { kind: 'favorites'; before: Record<string, boolean>; after: Record<string, boolean> }
  /** まとめてゴミ箱へ。at:ゴミ箱に入れた日時(やり直しでも同じ日時にして、30日の数え方を変えない) */
  | { kind: 'trash'; noteIds: string[]; at: number }
  /** ゴミ箱の画面でまとめて元に戻した(元に戻すと、ゴミ箱に入れた日時のままゴミ箱へ戻る) */
  | { kind: 'restore'; notes: Record<string, number>; pages: { id: string; deletedAt: number }[] }

export interface ShelfApplier {
  setOrder(noteIds: string[]): Promise<void>
  setFavorite(noteId: string, favorite: boolean): Promise<void>
  setFavorites(values: Record<string, boolean>): Promise<void>
  setNotesDeletedAt(values: Record<string, number | null>): Promise<void>
  restorePages(pageIds: string[]): Promise<unknown>
  retrashPages(records: { id: string; deletedAt: number }[]): Promise<void>
}

const LIMIT = 100

const sameRecord = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k])

export class ShelfHistory {
  private undoStack: ShelfEntry[] = []
  private redoStack: ShelfEntry[] = []
  private listeners = new Set<() => void>()
  private busy: Promise<void> = Promise.resolve()

  constructor(private applier: ShelfApplier) {}

  canUndo = () => this.undoStack.length > 0
  canRedo = () => this.redoStack.length > 0

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    this.listeners.forEach((fn) => fn())
  }

  record(entry: ShelfEntry) {
    if (entry.kind === 'order' && entry.before.join() === entry.after.join()) return
    if (entry.kind === 'favorite' && entry.before === entry.after) return
    if (entry.kind === 'favorites' && sameRecord(entry.before, entry.after)) return
    if (entry.kind === 'trash' && entry.noteIds.length === 0) return
    if (entry.kind === 'restore' && Object.keys(entry.notes).length === 0 && entry.pages.length === 0) return
    this.undoStack.push(entry)
    if (this.undoStack.length > LIMIT) this.undoStack.shift()
    this.redoStack = []
    this.emit()
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
      try {
        await task()
      } catch (e) {
        console.error('元に戻す/やり直しに失敗しました', e)
      } finally {
        this.emit()
      }
    })
    return this.busy
  }

  private async run(entry: ShelfEntry, dir: 'undo' | 'redo') {
    const undo = dir === 'undo'
    switch (entry.kind) {
      case 'order':
        await this.applier.setOrder(undo ? entry.before : entry.after)
        return
      case 'favorite':
        await this.applier.setFavorite(entry.noteId, undo ? entry.before : entry.after)
        return
      case 'favorites':
        await this.applier.setFavorites(undo ? entry.before : entry.after)
        return
      case 'trash':
        await this.applier.setNotesDeletedAt(Object.fromEntries(entry.noteIds.map((id) => [id, undo ? null : entry.at])))
        return
      case 'restore':
        if (undo) {
          await this.applier.setNotesDeletedAt(entry.notes)
          await this.applier.retrashPages(entry.pages)
        } else {
          await this.applier.setNotesDeletedAt(Object.fromEntries(Object.keys(entry.notes).map((id) => [id, null])))
          await this.applier.restorePages(entry.pages.map((p) => p.id))
        }
        return
    }
  }
}

/** アプリ全体で1つの本棚の履歴(ノートの画面でお気に入りを切り替えたときも、ここに記録する) */
export const shelfHistory = new ShelfHistory({
  setOrder: setNoteOrder,
  setFavorite,
  setFavorites,
  setNotesDeletedAt,
  restorePages,
  retrashPages,
})
