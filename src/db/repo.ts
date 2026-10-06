import type { JSONContent } from '@tiptap/core'
import { db, emptyDoc, newId, type Note, type Page, type Sticky } from './db'

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
      createdAt: now,
      updatedAt: now,
    }
    await db.notes.add(note)
    await db.pages.add({
      id: newId(),
      noteId: note.id,
      order: 0,
      content: emptyDoc(),
      stickies: [],
      createdAt: now,
      updatedAt: now,
    })
    return note
  })
}

export async function renameNote(noteId: string, title: string): Promise<void> {
  await db.notes.update(noteId, { title, updatedAt: Date.now() })
}

/** ノートと中のページを完全に削除する(フェーズ3でゴミ箱行きに変える) */
export async function deleteNote(noteId: string): Promise<void> {
  await db.transaction('rw', db.notes, db.pages, async () => {
    await db.pages.where('noteId').equals(noteId).delete()
    await db.notes.delete(noteId)
  })
}

// ---- ページ ----

export async function getPages(noteId: string): Promise<Page[]> {
  return db.pages.where('[noteId+order]').between([noteId, -Infinity], [noteId, Infinity]).toArray()
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
    const pages = await getPages(noteId)
    const record: Page = page
      ? { ...page, noteId, updatedAt: now }
      : { id: newId(), noteId, order: 0, content: emptyDoc(), stickies: [], createdAt: now, updatedAt: now }
    await db.pages.put(record)
    const at = Math.max(0, Math.min(index, pages.length))
    pages.splice(at, 0, record)
    await reindex(pages)
    await db.notes.update(noteId, { updatedAt: now })
    return { ...record, order: at }
  })
}

/** ページを削除し、削除したページと位置を返す(元に戻す用) */
export async function deletePage(pageId: string): Promise<{ page: Page; index: number } | null> {
  return db.transaction('rw', db.notes, db.pages, async () => {
    const page = await db.pages.get(pageId)
    if (!page) return null
    const pages = await getPages(page.noteId)
    const index = pages.findIndex((p) => p.id === pageId)
    await db.pages.delete(pageId)
    pages.splice(index, 1)
    await reindex(pages)
    await db.notes.update(page.noteId, { updatedAt: Date.now() })
    return { page, index }
  })
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
