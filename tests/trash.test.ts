import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/db/db'
import {
  TRASH_DAYS,
  createNote,
  daysLeft,
  deletePage,
  emptyTrash,
  getPages,
  getShelfNotes,
  getTrash,
  insertPage,
  purgeExpired,
  purgeNote,
  restoreNote,
  restorePage,
  savePageContent,
  setNoteDesign,
  trashNote,
  trashPage,
} from '../src/db/repo'
import { NoteHistory } from '../src/history/noteHistory'
import { legacyDesign } from '../src/design/defaults'

// ゴミ箱(ノート・ページ)と、30日での自動削除のテスト

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date(2026, 9, 7, 12, 0).getTime()

beforeEach(async () => {
  await db.notes.clear()
  await db.pages.clear()
})

/** A・B・C の3ページのノート */
async function noteABC() {
  const note = await createNote('テスト')
  await insertPage(note.id, 1)
  await insertPage(note.id, 2)
  const ids = (await getPages(note.id)).map((p) => p.id)
  const texts = ['A', 'B', 'C']
  for (let i = 0; i < 3; i++) {
    await savePageContent(ids[i], { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: texts[i] }] }] })
  }
  return { noteId: note.id, ids }
}
const orderOf = async (noteId: string) => (await getPages(noteId)).map((p) => p.id)

describe('ページのゴミ箱', () => {
  it('ゴミ箱に入れると一覧から消え、残りのページの順番が振り直される(データは残る)', async () => {
    const { noteId, ids } = await noteABC()
    const [a, b, c] = ids
    const result = await trashPage(b, NOW)
    expect(result?.index).toBe(1)
    const pages = await getPages(noteId)
    expect(pages.map((p) => p.id)).toEqual([a, c])
    expect(pages.map((p) => p.order)).toEqual([0, 1])
    const trashed = await db.pages.get(b)
    expect(trashed).toMatchObject({ deletedAt: NOW, deletedIndex: 1 })
    expect(trashed?.content.content?.[0].content?.[0].text).toBe('B')
  })

  it('元に戻すと、ゴミ箱に入れたときの位置へ戻る', async () => {
    const { noteId, ids } = await noteABC()
    const [a, b, c] = ids
    await trashPage(b, NOW)
    await restorePage(b)
    expect(await orderOf(noteId)).toEqual([a, b, c])
    expect(await db.pages.get(b)).toMatchObject({ deletedAt: null, deletedIndex: null })
  })

  it('ページが減っていたら、最後に戻る', async () => {
    const { noteId, ids } = await noteABC()
    const [a, , c] = ids
    await trashPage(c, NOW) // 3ページ目をゴミ箱へ
    await deletePage(a)
    await restorePage(c)
    expect((await orderOf(noteId)).at(-1)).toBe(c)
  })

  it('ゴミ箱の一覧に、どのノートのページかと一緒に出る', async () => {
    const { ids } = await noteABC()
    await trashPage(ids[1], NOW)
    const trash = await getTrash()
    expect(trash.pages.map((x) => x.page.id)).toEqual([ids[1]])
    expect(trash.pages[0].note.title).toBe('テスト')
  })

  it('同じページを2回ゴミ箱に入れても何も起きない', async () => {
    const { ids } = await noteABC()
    await trashPage(ids[1], NOW)
    expect(await trashPage(ids[1], NOW + 1)).toBeNull()
    expect((await db.pages.get(ids[1]))?.deletedAt).toBe(NOW)
  })
})

describe('ノートのゴミ箱', () => {
  it('ゴミ箱に入れると本棚から消え、元に戻すとページごと戻る', async () => {
    const { noteId, ids } = await noteABC()
    const other = await createNote('ほかのノート')
    await trashNote(noteId, NOW)
    expect((await getShelfNotes()).map((n) => n.id)).toEqual([other.id])
    expect((await getTrash()).notes.map((n) => n.id)).toEqual([noteId])

    await restoreNote(noteId)
    expect((await getShelfNotes()).map((n) => n.id)).toContain(noteId)
    expect(await orderOf(noteId)).toEqual(ids)
  })

  it('ゴミ箱のノートの中のページは、ページの一覧には出さない(ノートと一緒に扱う)', async () => {
    const { noteId, ids } = await noteABC()
    await trashPage(ids[0], NOW)
    await trashNote(noteId, NOW)
    const trash = await getTrash()
    expect(trash.notes).toHaveLength(1)
    expect(trash.pages).toHaveLength(0)
  })

  it('完全に削除すると、ゴミ箱のページも含めてすべて消える', async () => {
    const { noteId, ids } = await noteABC()
    await trashPage(ids[0], NOW)
    await trashNote(noteId, NOW)
    await purgeNote(noteId)
    expect(await db.notes.get(noteId)).toBeUndefined()
    expect(await db.pages.where('noteId').equals(noteId).count()).toBe(0)
  })

  it('ゴミ箱を空にすると、ゴミ箱の中だけが消える', async () => {
    const one = await noteABC()
    const two = await noteABC()
    await trashNote(one.noteId, NOW)
    await trashPage(two.ids[2], NOW)
    await emptyTrash()
    expect(await db.notes.get(one.noteId)).toBeUndefined()
    expect(await db.pages.get(two.ids[2])).toBeUndefined()
    expect(await orderOf(two.noteId)).toEqual(two.ids.slice(0, 2))
  })
})

describe('30日での自動削除', () => {
  it(`${TRASH_DAYS}日たったものだけを完全に削除する`, async () => {
    const old = await noteABC()
    const recent = await noteABC()
    const live = await noteABC()
    await trashNote(old.noteId, NOW - 30 * DAY)
    await trashNote(recent.noteId, NOW - 29 * DAY)
    await trashPage(live.ids[0], NOW - 31 * DAY)
    await trashPage(live.ids[1], NOW - 1 * DAY)

    const result = await purgeExpired(NOW)
    expect(result).toEqual({ notes: 1, pages: 1 })
    expect(await db.notes.get(old.noteId)).toBeUndefined()
    expect(await db.pages.where('noteId').equals(old.noteId).count()).toBe(0)
    expect(await db.notes.get(recent.noteId)).toBeTruthy()
    expect(await db.pages.get(live.ids[0])).toBeUndefined()
    expect(await db.pages.get(live.ids[1])).toBeTruthy()
    expect(await orderOf(live.noteId)).toEqual([live.ids[2]])
  })

  it('ゴミ箱でないノート・ページは、古くても消さない', async () => {
    const { noteId, ids } = await noteABC()
    await db.notes.update(noteId, { createdAt: 0, updatedAt: 0 })
    await purgeExpired(NOW + 1000 * DAY)
    expect(await orderOf(noteId)).toEqual(ids)
  })

  it('残り日数:入れた直後は30日、29日と1分後は1日、30日後は0日', () => {
    expect(daysLeft(NOW, NOW)).toBe(30)
    expect(daysLeft(NOW, NOW + 29 * DAY + 60_000)).toBe(1)
    expect(daysLeft(NOW, NOW + 30 * DAY)).toBe(0)
  })
})

describe('ノートの元に戻す/やり直し(ゴミ箱・デザイン)', () => {
  function historyFor(noteId: string) {
    return new NoteHistory({
      setPageContent: async () => {},
      removePage: async (id) => (await deletePage(id))?.page ?? null,
      trashPage: async (id) => (await trashPage(id))?.page ?? null,
      restorePage: async (page, index) => {
        await insertPage(noteId, index, page)
      },
      rename: async () => {},
      setDesign: (d) => setNoteDesign(noteId, d),
      reorderPages: async () => {},
      setStickies: async () => {},
    })
  }

  it('ページの削除:元に戻すとゴミ箱から元の位置へ、やり直すと再びゴミ箱へ', async () => {
    const { noteId, ids } = await noteABC()
    const [a, b, c] = ids
    const history = historyFor(noteId)
    const removed = (await trashPage(b))!
    history.recordDeletePage(removed.page, removed.index)

    await history.undo()
    expect(await orderOf(noteId)).toEqual([a, b, c])
    expect((await getTrash()).pages).toHaveLength(0)

    await history.redo()
    expect(await orderOf(noteId)).toEqual([a, c])
    expect((await getTrash()).pages.map((x) => x.page.id)).toEqual([b])
  })

  it('ページの追加を元に戻しても、ゴミ箱には入らない', async () => {
    const { noteId } = await noteABC()
    const history = historyFor(noteId)
    const page = await insertPage(noteId, 3)
    history.recordAddPage(page, 3)
    await history.undo()
    expect(await db.pages.get(page.id)).toBeUndefined()
    expect((await getTrash()).pages).toHaveLength(0)
  })

  it('デザインの変更を元に戻す/やり直す', async () => {
    const { noteId } = await noteABC()
    const history = historyFor(noteId)
    const before = (await db.notes.get(noteId))!.design
    const after = { ...legacyDesign(), paper: 'navy' }
    await setNoteDesign(noteId, after)
    history.recordDesign(before, after)

    await history.undo()
    expect((await db.notes.get(noteId))!.design).toEqual(before)
    await history.redo()
    expect((await db.notes.get(noteId))!.design.paper).toBe('navy')
  })

  it('同じデザインを選び直しても履歴に残さない', () => {
    const history = historyFor('x')
    history.recordDesign(legacyDesign(), legacyDesign())
    expect(history.canUndo()).toBe(false)
  })
})
