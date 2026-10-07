import type { JSONContent } from '@tiptap/core'
import { db, emptyDoc, newId, type Note, type NoteDesign, type Page, type Sticky } from './db'
import { newNoteDesign } from '../design/defaults'

/** ゴミ箱に入れてから完全に削除するまでの日数 */
export const TRASH_DAYS = 30
const DAY = 24 * 60 * 60 * 1000

/** 新しいページの行(ゴミ箱の項目は空にしておく) */
function blankPage(noteId: string, now: number): Page {
  return {
    id: newId(),
    noteId,
    order: 0,
    content: emptyDoc(),
    stickies: [],
    deletedAt: null,
    deletedIndex: null,
    createdAt: now,
    updatedAt: now,
  }
}

// ---- ノート ----

/** ノートを作る(1ページ目つき)。新しいノートは本棚の先頭に置く */
export async function createNote(title = ''): Promise<Note> {
  const now = Date.now()
  return db.transaction('rw', db.notes, db.pages, async () => {
    const first = await db.notes.orderBy('order').first()
    const note: Note = {
      id: newId(),
      title,
      order: first ? first.order - 1 : 0,
      favorite: false,
      deletedAt: null,
      design: newNoteDesign(),
      createdAt: now,
      updatedAt: now,
    }
    await db.notes.add(note)
    await db.pages.add(blankPage(note.id, now))
    return note
  })
}

export async function renameNote(noteId: string, title: string): Promise<void> {
  await db.notes.update(noteId, { title, updatedAt: Date.now() })
}

export async function setNoteDesign(noteId: string, design: NoteDesign): Promise<void> {
  await db.notes.update(noteId, { design, updatedAt: Date.now() })
}

/** お気に入りの切り替え(更新日時は変えない:中身の編集ではないため) */
export async function setFavorite(noteId: string, favorite: boolean): Promise<void> {
  await db.notes.update(noteId, { favorite })
}

/** 本棚の並びを noteIds の順にする(order を 0,1,2… に振る)。noteIds にないノートは変えない */
export async function setNoteOrder(noteIds: string[]): Promise<void> {
  await db.transaction('rw', db.notes, async () => {
    await Promise.all(noteIds.map((id, i) => db.notes.update(id, { order: i })))
  })
}

/** 本棚に並べるノート(ゴミ箱のものを除く。並び順どおり) */
export async function getShelfNotes(): Promise<Note[]> {
  return (await db.notes.orderBy('order').toArray()).filter((n) => n.deletedAt == null)
}

/** ノートをゴミ箱に入れる(中のページはそのまま。復元するとページも戻る) */
export async function trashNote(noteId: string, now = Date.now()): Promise<void> {
  await db.notes.update(noteId, { deletedAt: now })
}

/** ゴミ箱のノートを元に戻す(本棚の元の位置に戻る) */
export async function restoreNote(noteId: string): Promise<void> {
  await db.notes.update(noteId, { deletedAt: null })
}

/** ノートと中のページ(ゴミ箱のページも)を完全に削除する */
export async function purgeNote(noteId: string): Promise<void> {
  await db.transaction('rw', db.notes, db.pages, async () => {
    await db.pages.where('noteId').equals(noteId).delete()
    await db.notes.delete(noteId)
  })
}

// ---- ページ ----

/** ノートのページ(ゴミ箱のものを除く。並び順どおり) */
export async function getPages(noteId: string): Promise<Page[]> {
  const pages = await db.pages.where('[noteId+order]').between([noteId, -Infinity], [noteId, Infinity]).toArray()
  return pages.filter((p) => p.deletedAt == null)
}

/** 並び順を 0,1,2… に振り直す */
async function reindex(pages: Page[]): Promise<void> {
  const changed = pages
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => p.order !== i)
  await Promise.all(changed.map(({ p, i }) => db.pages.update(p.id, { order: i })))
}

/**
 * index の位置にページを入れる。
 * page を渡すと(元に戻すときなど)その内容・IDのまま入れる
 */
export async function insertPage(noteId: string, index: number, page?: Page): Promise<Page> {
  const now = Date.now()
  return db.transaction('rw', db.notes, db.pages, async () => {
    // 同じページがすでに並んでいたら(ゴミ箱から戻した後など)、二重にならないよう一度外す
    const pages = (await getPages(noteId)).filter((p) => p.id !== page?.id)
    const record: Page = page
      ? { ...page, noteId, deletedAt: null, deletedIndex: null, updatedAt: now }
      : blankPage(noteId, now)
    await db.pages.put(record)
    const at = Math.max(0, Math.min(index, pages.length))
    pages.splice(at, 0, record)
    await reindex(pages)
    await db.notes.update(noteId, { updatedAt: now })
    return { ...record, order: at }
  })
}

/** ページを完全に削除し、削除したページと位置を返す(「ページの追加」を元に戻すとき用) */
export async function deletePage(pageId: string): Promise<{ page: Page; index: number } | null> {
  return db.transaction('rw', db.notes, db.pages, async () => {
    const page = await db.pages.get(pageId)
    if (!page) return null
    const pages = await getPages(page.noteId)
    const index = pages.findIndex((p) => p.id === pageId)
    await db.pages.delete(pageId)
    if (index >= 0) pages.splice(index, 1)
    await reindex(pages)
    await db.notes.update(page.noteId, { updatedAt: Date.now() })
    return { page, index: Math.max(0, index) }
  })
}

/** ページをゴミ箱に入れ、ゴミ箱に入れる前のページと位置を返す(元に戻す用) */
export async function trashPage(pageId: string, now = Date.now()): Promise<{ page: Page; index: number } | null> {
  return db.transaction('rw', db.notes, db.pages, async () => {
    const page = await db.pages.get(pageId)
    if (!page || page.deletedAt != null) return null
    const pages = await getPages(page.noteId)
    const index = pages.findIndex((p) => p.id === pageId)
    await db.pages.update(pageId, { deletedAt: now, deletedIndex: index })
    pages.splice(index, 1)
    await reindex(pages)
    await db.notes.update(page.noteId, { updatedAt: now })
    return { page, index }
  })
}

/** ゴミ箱のページを、ゴミ箱に入れたときの位置へ戻す(ページ数が減っていたら最後に) */
export async function restorePage(pageId: string): Promise<Page | null> {
  const page = await db.pages.get(pageId)
  if (!page || page.deletedAt == null) return null
  return insertPage(page.noteId, page.deletedIndex ?? Infinity, page)
}

/** ゴミ箱のページを完全に削除する */
export async function purgePage(pageId: string): Promise<void> {
  await db.pages.delete(pageId)
}

export interface TrashContents {
  /** ゴミ箱のノート(新しく入れた順) */
  notes: Note[]
  /** ゴミ箱のページ(ノートがゴミ箱でないもの。新しく入れた順) */
  pages: { page: Page; note: Note }[]
}

/** ゴミ箱の中身 */
export async function getTrash(): Promise<TrashContents> {
  return db.transaction('r', db.notes, db.pages, async () => {
    const all = await db.notes.toArray()
    const byId = new Map(all.map((n) => [n.id, n]))
    const notes = all.filter((n) => n.deletedAt != null).sort((a, b) => b.deletedAt! - a.deletedAt!)
    const pages = (await db.pages.filter((p) => p.deletedAt != null).toArray())
      .map((page) => ({ page, note: byId.get(page.noteId) }))
      .filter((x): x is { page: Page; note: Note } => !!x.note && x.note.deletedAt == null)
      .sort((a, b) => b.page.deletedAt! - a.page.deletedAt!)
    return { notes, pages }
  })
}

/** ゴミ箱に入れてから完全に削除されるまでの残り日数(1日未満も1日と数える) */
export function daysLeft(deletedAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((deletedAt + TRASH_DAYS * DAY - now) / DAY))
}

/** ゴミ箱に入れてから30日たったノート・ページを完全に削除する。消した数を返す */
export async function purgeExpired(now = Date.now()): Promise<{ notes: number; pages: number }> {
  const limit = now - TRASH_DAYS * DAY
  return db.transaction('rw', db.notes, db.pages, async () => {
    const notes = await db.notes.filter((n) => n.deletedAt != null && n.deletedAt <= limit).toArray()
    for (const n of notes) {
      await db.pages.where('noteId').equals(n.id).delete()
      await db.notes.delete(n.id)
    }
    const pages = await db.pages.filter((p) => p.deletedAt != null && p.deletedAt <= limit).toArray()
    await db.pages.bulkDelete(pages.map((p) => p.id))
    return { notes: notes.length, pages: pages.length }
  })
}

/** ゴミ箱を空にする */
export async function emptyTrash(): Promise<void> {
  const { notes, pages } = await getTrash()
  for (const n of notes) await purgeNote(n.id)
  await db.pages.bulkDelete(pages.map((p) => p.page.id))
}

/**
 * ページの並びを pageIds の順にする(ページ一覧での並び替え・元に戻す用)。
 * pageIds にないページは後ろに残す
 */
export async function reorderPages(noteId: string, pageIds: string[]): Promise<void> {
  await db.transaction('rw', db.notes, db.pages, async () => {
    const pages = await getPages(noteId)
    const rank = new Map(pageIds.map((id, i) => [id, i]))
    const sorted = [...pages].sort(
      (a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || a.order - b.order,
    )
    await reindex(sorted)
    await db.notes.update(noteId, { updatedAt: Date.now() })
  })
}

export async function savePageStickies(pageId: string, stickies: Sticky[]): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.notes, db.pages, async () => {
    const page = await db.pages.get(pageId)
    if (!page) return
    await db.pages.update(pageId, { stickies, updatedAt: now })
    await db.notes.update(page.noteId, { updatedAt: now })
  })
}

export async function savePageContent(pageId: string, content: JSONContent): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.notes, db.pages, async () => {
    const page = await db.pages.get(pageId)
    if (!page) return
    await db.pages.update(pageId, { content, updatedAt: now })
    await db.notes.update(page.noteId, { updatedAt: now })
  })
}
