import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/db/db'
import {
  createNote,
  getPages,
  getShelfNotes,
  getTrash,
  insertPage,
  purgeMany,
  restorePages,
  retrashPages,
  setFavorites,
  setNotesDeletedAt,
  setNoteOrder,
  setFavorite,
  trashNotes,
  trashPage,
} from '../src/db/repo'
import { ShelfHistory } from '../src/history/shelfHistory'

// 本棚・ゴミ箱のまとめての操作と、本棚の「元に戻す/やり直し」

const history = () =>
  new ShelfHistory({ setOrder: setNoteOrder, setFavorite, setFavorites, setNotesDeletedAt, restorePages, retrashPages })

const shelfIds = async () => (await getShelfNotes()).map((n) => n.id)
const deletedAt = async (id: string) => (await db.notes.get(id))?.deletedAt

beforeEach(async () => {
  await db.notes.clear()
  await db.pages.clear()
})

describe('本棚でまとめて', () => {
  it('お気に入りにする → 元に戻すと、ノートごとの元の状態に戻る', async () => {
    const a = await createNote('a')
    const b = await createNote('b')
    await setFavorite(a.id, true)
    const h = history()
    const before = { [a.id]: true, [b.id]: false }
    const after = { [a.id]: true, [b.id]: true }
    await setFavorites(after)
    h.record({ kind: 'favorites', before, after })
    expect((await db.notes.get(b.id))!.favorite).toBe(true)
    await h.undo()
    expect((await db.notes.get(a.id))!.favorite).toBe(true) // もともとお気に入りだったものは外さない
    expect((await db.notes.get(b.id))!.favorite).toBe(false)
    await h.redo()
    expect((await db.notes.get(b.id))!.favorite).toBe(true)
  })

  it('ゴミ箱へ → 元に戻すと本棚の同じ位置に戻り、やり直すと同じ日時でゴミ箱へ', async () => {
    const a = await createNote('a')
    const b = await createNote('b')
    const c = await createNote('c')
    const order = await shelfIds()
    const h = history()
    await trashNotes([a.id, c.id], 1000)
    h.record({ kind: 'trash', noteIds: [a.id, c.id], at: 1000 })
    expect(await shelfIds()).toEqual([b.id])
    expect((await getTrash()).notes.map((n) => n.id).sort()).toEqual([a.id, c.id].sort())

    await h.undo()
    expect(await shelfIds()).toEqual(order)
    await h.redo()
    expect(await deletedAt(a.id)).toBe(1000)
    expect(await deletedAt(c.id)).toBe(1000)
  })

  it('完全に削除したノートは、元に戻すときに飛ばす(ほかのノートは戻る)', async () => {
    const a = await createNote('a')
    const b = await createNote('b')
    const h = history()
    await trashNotes([a.id, b.id], 1000)
    h.record({ kind: 'trash', noteIds: [a.id, b.id], at: 1000 })
    await purgeMany([a.id], [])
    await h.undo()
    expect(await db.notes.get(a.id)).toBeUndefined()
    expect(await shelfIds()).toEqual([b.id])
  })

  it('何も選んでいない操作は履歴に残さない', () => {
    const h = history()
    h.record({ kind: 'trash', noteIds: [], at: 1 })
    h.record({ kind: 'favorites', before: { a: true }, after: { a: true } })
    h.record({ kind: 'restore', notes: {}, pages: [] })
    expect(h.canUndo()).toBe(false)
  })
})

describe('ゴミ箱でまとめて', () => {
  it('ノートとページを元に戻す → 本棚の「元に戻す」で、ゴミ箱に入れた日時のままゴミ箱へ戻る', async () => {
    const a = await createNote('a')
    const n = await createNote('ページのあるノート')
    await insertPage(n.id, 1)
    await insertPage(n.id, 2)
    const pages = await getPages(n.id)
    await trashNotes([a.id], 500)
    await trashPage(pages[1].id, 600)
    await trashPage(pages[2].id, 700)

    const h = history()
    const notes = { [a.id]: 500 }
    await setNotesDeletedAt({ [a.id]: null })
    const restored = await restorePages([pages[2].id, pages[1].id])
    h.record({ kind: 'restore', notes, pages: restored })
    // ページは元の位置に戻る
    expect((await getPages(n.id)).map((p) => p.id)).toEqual(pages.map((p) => p.id))
    expect(await deletedAt(a.id)).toBeNull()

    await h.undo()
    expect(await deletedAt(a.id)).toBe(500)
    expect((await db.pages.get(pages[1].id))!.deletedAt).toBe(600)
    expect((await db.pages.get(pages[2].id))!.deletedAt).toBe(700)
    expect((await getPages(n.id)).map((p) => p.id)).toEqual([pages[0].id])

    await h.redo()
    expect(await deletedAt(a.id)).toBeNull()
    expect((await getPages(n.id)).map((p) => p.id)).toEqual(pages.map((p) => p.id))
  })

  it('まとめて完全に削除(ノートは中のページごと)', async () => {
    const a = await createNote('a')
    const b = await createNote('b')
    await insertPage(b.id, 1)
    const bp = await getPages(b.id)
    await trashNotes([a.id], 1)
    await trashPage(bp[1].id, 2)
    await purgeMany([a.id], [bp[1].id])
    expect(await db.notes.get(a.id)).toBeUndefined()
    expect(await db.pages.where('noteId').equals(a.id).count()).toBe(0)
    expect(await db.pages.get(bp[1].id)).toBeUndefined()
    expect((await getTrash()).pages).toEqual([])
    expect(await db.notes.get(b.id)).toBeTruthy()
  })
})
