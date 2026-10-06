import { db, newId, type Note, type Page } from '../db/db'
import type { Backup } from './format'

/** 今のデータをすべて消して、ファイルの中身に置き換える */
export async function importReplace(backup: Backup): Promise<void> {
  await db.transaction('rw', db.notes, db.pages, async () => {
    await db.pages.clear()
    await db.notes.clear()
    await db.notes.bulkAdd(backup.notes)
    await db.pages.bulkAdd(backup.pages)
  })
}

/** 今のデータは残し、ファイルのノートを本棚の先頭に追加する(IDは振り直す) */
export async function importAppend(backup: Backup): Promise<void> {
  await db.transaction('rw', db.notes, db.pages, async () => {
    const first = await db.notes.orderBy('order').first()
    const base = (first?.order ?? 0) - backup.notes.length - 1
    const idMap = new Map<string, string>()
    const sorted = [...backup.notes].sort((a, b) => a.order - b.order)
    const notes: Note[] = sorted.map((n, i) => {
      const id = newId()
      idMap.set(n.id, id)
      return { ...n, id, order: base + i }
    })
    const pages: Page[] = backup.pages
      .filter((p) => idMap.has(p.noteId))
      .map((p) => ({
        ...p,
        id: newId(),
        noteId: idMap.get(p.noteId)!,
        stickies: p.stickies.map((s) => ({ ...s, id: newId() })),
      }))
    await db.notes.bulkAdd(notes)
    await db.pages.bulkAdd(pages)
  })
}
