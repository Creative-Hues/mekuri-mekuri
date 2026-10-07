import { beforeEach, describe, expect, it } from 'vitest'
import { db, type Note } from '../src/db/db'
import { createNote, getShelfNotes, setFavorite, setNoteOrder, trashNote } from '../src/db/repo'
import { fullOrder, moveInSection, shelfSections } from '../src/shelf/order'
import { ShelfHistory } from '../src/history/shelfHistory'
import { legacyDesign } from '../src/design/defaults'

// 本棚:お気に入りの段・段の中での並び替え・本棚の元に戻す/やり直し

const note = (id: string, order: number, favorite = false, deletedAt: number | null = null): Note => ({
  id, title: id, order, favorite, deletedAt, design: legacyDesign(), createdAt: 0, updatedAt: 0,
})

describe('本棚の段分け(shelfSections)', () => {
  it('お気に入りを上の段に、どちらの段も order の順に並べる', () => {
    const s = shelfSections([note('a', 3), note('b', 1, true), note('c', 0), note('d', 2, true)])
    expect(s).toEqual({ favorites: ['b', 'd'], others: ['c', 'a'] })
    expect(fullOrder(s)).toEqual(['b', 'd', 'c', 'a'])
  })

  it('ゴミ箱のノートは並べない', () => {
    const s = shelfSections([note('a', 0), note('b', 1, false, 123), note('c', 2, true, 5)])
    expect(s).toEqual({ favorites: [], others: ['a'] })
  })
})

describe('段の中での並び替え(moveInSection)', () => {
  const s = { favorites: ['f1', 'f2', 'f3'], others: ['o1', 'o2'] }

  it('後ろへ・前へ動かせる', () => {
    expect(moveInSection(s, 'f1', 'f3')?.favorites).toEqual(['f2', 'f3', 'f1'])
    expect(moveInSection(s, 'o2', 'o1')?.others).toEqual(['o2', 'o1'])
  })

  it('動かしていない段は変わらない', () => {
    expect(moveInSection(s, 'f1', 'f2')?.others).toEqual(['o1', 'o2'])
  })

  it('別の段へは動かさない・同じ場所なら何もしない', () => {
    expect(moveInSection(s, 'f1', 'o1')).toBeNull()
    expect(moveInSection(s, 'f1', 'f1')).toBeNull()
    expect(moveInSection(s, 'x', 'f1')).toBeNull()
  })
})

describe('本棚(データベース)', () => {
  beforeEach(async () => {
    await db.notes.clear()
    await db.pages.clear()
  })

  const shelf = async () => fullOrder(shelfSections(await getShelfNotes()))

  it('新しいノートは通常の段の先頭に、新しいノートには表紙の色が入る', async () => {
    const a = await createNote('a')
    const b = await createNote('b')
    expect(await shelf()).toEqual([b.id, a.id])
    expect(b.design.cover.pattern).toBe('plain')
    expect(b.favorite).toBe(false)
    expect(b.deletedAt).toBeNull()
  })

  it('お気に入りにすると上の段へ、外すと元の段の元の位置へ', async () => {
    const a = await createNote('a')
    const b = await createNote('b')
    const c = await createNote('c') // 並び:c b a
    await setFavorite(a.id, true)
    expect(await shelf()).toEqual([a.id, c.id, b.id])
    await setFavorite(a.id, false)
    expect(await shelf()).toEqual([c.id, b.id, a.id])
  })

  it('並び替えた順で保存される(ゴミ箱のノートの位置は変えない)', async () => {
    const a = await createNote('a')
    const b = await createNote('b')
    const t = await createNote('t')
    await trashNote(t.id)
    const tOrder = (await db.notes.get(t.id))!.order
    await setNoteOrder([a.id, b.id])
    expect(await shelf()).toEqual([a.id, b.id])
    expect((await db.notes.get(t.id))!.order).toBe(tOrder)
  })

  it('本棚の元に戻す/やり直し:並び替えとお気に入り', async () => {
    const history = new ShelfHistory({ setOrder: setNoteOrder, setFavorite })
    const a = await createNote('a')
    const b = await createNote('b') // 並び:b a
    const before = await shelf()

    await setNoteOrder([a.id, b.id])
    history.record({ kind: 'order', before, after: [a.id, b.id] })
    await setFavorite(b.id, true)
    history.record({ kind: 'favorite', noteId: b.id, before: false, after: true })
    expect(await shelf()).toEqual([b.id, a.id]) // b はお気に入りの段

    await history.undo()
    expect((await db.notes.get(b.id))!.favorite).toBe(false)
    expect(await shelf()).toEqual([a.id, b.id])
    await history.undo()
    expect(await shelf()).toEqual([b.id, a.id])
    expect(history.canUndo()).toBe(false)

    await history.redo()
    await history.redo()
    expect((await db.notes.get(b.id))!.favorite).toBe(true)
    expect(history.canRedo()).toBe(false)
  })

  it('変わっていない操作は履歴に残さない', () => {
    const history = new ShelfHistory({ setOrder: async () => {}, setFavorite: async () => {} })
    history.record({ kind: 'order', before: ['a', 'b'], after: ['a', 'b'] })
    history.record({ kind: 'favorite', noteId: 'a', before: true, after: true })
    expect(history.canUndo()).toBe(false)
  })
})

describe('新しいノートの表紙の色(データベース)', () => {
  beforeEach(async () => {
    await db.notes.clear()
    await db.pages.clear()
  })

  it('続けて作っても、直前に作ったノートと同じ色にならない', async () => {
    let prev = (await createNote('0')).design.cover.color
    for (let i = 1; i < 40; i++) {
      const color = (await createNote(String(i))).design.cover.color
      expect(color).not.toBe(prev)
      prev = color
    }
  })
})
