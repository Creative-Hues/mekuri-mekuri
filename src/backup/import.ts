import { db, newId, type ImageRecord, type Note, type Page } from '../db/db'
import { remapContentIds } from '../editor/contentWalk'
import { fromBase64, type Backup, type BackupImage } from './format'

/** バックアップの画像を、データベースに入れる形にする(使われているかは次の起動時に改めて判定する) */
function toRecord(img: BackupImage, id = img.id): ImageRecord {
  return {
    id,
    mime: img.mime,
    data: fromBase64(img.data),
    width: img.width,
    height: img.height,
    createdAt: Date.now(),
    unusedSince: null,
  }
}

/** 今のデータをすべて消して、ファイルの中身に置き換える */
export async function importReplace(backup: Backup): Promise<void> {
  const images = backup.images.map((img) => toRecord(img))
  await db.transaction('rw', db.notes, db.pages, db.images, async () => {
    await db.pages.clear()
    await db.notes.clear()
    await db.images.clear()
    await db.notes.bulkAdd(backup.notes)
    await db.pages.bulkAdd(backup.pages)
    await db.images.bulkAdd(images)
  })
}

/**
 * 今のデータは残し、ファイルのノートを本棚の先頭に追加する。
 * ID はすべて振り直し、本文の中の画像・ノートへのリンクの参照も新しい ID に書き換える
 */
export async function importAppend(backup: Backup): Promise<void> {
  const ids = {
    notes: new Map(backup.notes.map((n) => [n.id, newId()])),
    pages: new Map(backup.pages.map((p) => [p.id, newId()])),
    images: new Map(backup.images.map((img) => [img.id, newId()])),
  }
  const images = backup.images.map((img) => toRecord(img, ids.images.get(img.id)))
  await db.transaction('rw', db.notes, db.pages, db.images, async () => {
    const first = await db.notes.orderBy('order').first()
    const base = (first?.order ?? 0) - backup.notes.length - 1
    const sorted = [...backup.notes].sort((a, b) => a.order - b.order)
    const notes: Note[] = sorted.map((n, i) => ({ ...n, id: ids.notes.get(n.id)!, order: base + i }))
    const pages: Page[] = backup.pages
      .filter((p) => ids.notes.has(p.noteId))
      .map((p) => ({
        ...p,
        id: ids.pages.get(p.id)!,
        noteId: ids.notes.get(p.noteId)!,
        content: remapContentIds(p.content, ids),
        stickies: p.stickies.map((s) => ({ ...s, id: newId(), content: remapContentIds(s.content, ids) })),
      }))
    await db.notes.bulkAdd(notes)
    await db.pages.bulkAdd(pages)
    await db.images.bulkAdd(images)
  })
}
