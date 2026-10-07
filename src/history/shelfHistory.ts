import { setFavorite, setNoteOrder } from '../db/repo'

/**
 * 本棚の「元に戻す/やり直し」の履歴(ノートの並び替え・お気に入り)。
 * ノートの中の履歴(noteHistory.ts)とは別。アプリを閉じると消える。
 * 本棚の画面で、ボタンと Ctrl+Z(Macは⌘+Z)で使う
 */

export type ShelfEntry =
  | { kind: 'order'; before: string[]; after: string[] }
  | { kind: 'favorite'; noteId: string; before: boolean; after: boolean }

export interface ShelfApplier {
  setOrder(noteIds: string[]): Promise<void>
  setFavorite(noteId: string, favorite: boolean): Promise<void>
}

const LIMIT = 100

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
    if (entry.kind === 'order') {
      await this.applier.setOrder(dir === 'undo' ? entry.before : entry.after)
    } else {
      await this.applier.setFavorite(entry.noteId, dir === 'undo' ? entry.before : entry.after)
    }
  }
}

/** アプリ全体で1つの本棚の履歴(ノートの画面でお気に入りを切り替えたときも、ここに記録する) */
export const shelfHistory = new ShelfHistory({ setOrder: setNoteOrder, setFavorite })
