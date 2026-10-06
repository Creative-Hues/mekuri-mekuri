import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/db/db'
import { createNote, getPages, insertPage, reorderPages } from '../src/db/repo'
import { NoteHistory } from '../src/history/noteHistory'

// ページ一覧での並び替えと、その「元に戻す/やり直し」のテスト

beforeEach(async () => {
  await db.notes.clear()
  await db.pages.clear()
})

/** ページが3枚あるノートを作る */
async function noteWith3Pages() {
  const note = await createNote('テスト')
  await insertPage(note.id, 1)
  await insertPage(note.id, 2)
  const ids = (await getPages(note.id)).map((p) => p.id)
  return { noteId: note.id, ids }
}

const orderOf = async (noteId: string) => (await getPages(noteId)).map((p) => p.id)

function historyFor(noteId: string) {
  return new NoteHistory({
    setPageContent: async () => {},
    removePage: async () => null,
    restorePage: async () => {},
    rename: async () => {},
    reorderPages: (ids) => reorderPages(noteId, ids),
  })
}

describe('ページの並び替え', () => {
  it('指定した順に並び、order が 0,1,2 に振り直される', async () => {
    const { noteId, ids } = await noteWith3Pages()
    const [a, b, c] = ids
    await reorderPages(noteId, [c, a, b])
    const pages = await getPages(noteId)
    expect(pages.map((p) => p.id)).toEqual([c, a, b])
    expect(pages.map((p) => p.order)).toEqual([0, 1, 2])
  })

  it('並び替えてもページの中身は変わらない', async () => {
    const { noteId, ids } = await noteWith3Pages()
    const before = await db.pages.bulkGet(ids)
    await reorderPages(noteId, [...ids].reverse())
    const after = await db.pages.bulkGet(ids)
    expect(after.map((p) => p?.content)).toEqual(before.map((p) => p?.content))
    expect(after.map((p) => p?.stickies)).toEqual(before.map((p) => p?.stickies))
  })

  it('指定に入っていないページは後ろに残る(消えない)', async () => {
    const { noteId, ids } = await noteWith3Pages()
    const [a, b, c] = ids
    await reorderPages(noteId, [b, a])
    expect(await orderOf(noteId)).toEqual([b, a, c])
  })

  it('ほかのノートのページには影響しない', async () => {
    const one = await noteWith3Pages()
    const two = await noteWith3Pages()
    await reorderPages(one.noteId, [...one.ids].reverse())
    expect(await orderOf(two.noteId)).toEqual(two.ids)
  })
})

describe('並び替えの元に戻す/やり直し', () => {
  it('元に戻すで前の並び、やり直しで並び替えた後に戻る', async () => {
    const { noteId, ids } = await noteWith3Pages()
    const [a, b, c] = ids
    const history = historyFor(noteId)

    const after = [b, c, a]
    await reorderPages(noteId, after)
    history.recordPageOrder(ids, after)
    expect(history.canUndo()).toBe(true)

    await history.undo()
    expect(await orderOf(noteId)).toEqual([a, b, c])
    expect(history.canRedo()).toBe(true)

    await history.redo()
    expect(await orderOf(noteId)).toEqual([b, c, a])
  })

  it('2回並び替えたら、2回元に戻せる', async () => {
    const { noteId, ids } = await noteWith3Pages()
    const [a, b, c] = ids
    const history = historyFor(noteId)

    await reorderPages(noteId, [b, a, c])
    history.recordPageOrder([a, b, c], [b, a, c])
    await reorderPages(noteId, [b, c, a])
    history.recordPageOrder([b, a, c], [b, c, a])

    await history.undo()
    expect(await orderOf(noteId)).toEqual([b, a, c])
    await history.undo()
    expect(await orderOf(noteId)).toEqual([a, b, c])
    expect(history.canUndo()).toBe(false)
  })

  it('並びが変わらないときは履歴に残さない', async () => {
    const { noteId, ids } = await noteWith3Pages()
    const history = historyFor(noteId)
    history.recordPageOrder(ids, [...ids])
    expect(history.canUndo()).toBe(false)
  })
})
