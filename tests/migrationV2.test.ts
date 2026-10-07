import { describe, expect, it } from 'vitest'
import Dexie from 'dexie'

// v2(アプリ 0.2.0〜0.3.0)で保存されたデータが、今のアプリで開いたときに消えずに移るかのテスト

describe('データ移行 v2 → 最新', () => {
  it('ノート・ページ・付箋を残したまま、お気に入り・ゴミ箱・デザインの項目を足す', async () => {
    // 0.3.0 のアプリと同じ形の DB を作る
    const old = new Dexie('mekuri-mekuri')
    old.version(2).stores({
      notes: 'id, order',
      pages: 'id, noteId, [noteId+order]',
      meta: 'key',
    })
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '本文' }] }] }
    const sticky = {
      id: 's1', x: 0.1, y: 0.2, w: 0.3, h: 0.3, color: 'pink',
      content: { type: 'doc', content: [{ type: 'paragraph' }] }, createdAt: 1, updatedAt: 1,
    }
    await old.table('notes').bulkAdd([
      { id: 'n1', title: '日記', order: 0, createdAt: 1, updatedAt: 2 },
      { id: 'n2', title: '買い物', order: 1, createdAt: 1, updatedAt: 2 },
    ])
    await old.table('pages').bulkAdd([
      { id: 'p1', noteId: 'n1', order: 0, content, stickies: [sticky], createdAt: 1, updatedAt: 2 },
      { id: 'p2', noteId: 'n1', order: 1, content, stickies: [], createdAt: 1, updatedAt: 2 },
      { id: 'p3', noteId: 'n2', order: 0, content, stickies: [], createdAt: 1, updatedAt: 2 },
    ])
    old.close()

    const { db } = await import('../src/db/db')
    const { getPages, getShelfNotes } = await import('../src/db/repo')
    const { legacyDesign } = await import('../src/design/defaults')

    const notes = await getShelfNotes()
    expect(notes.map((n) => n.title)).toEqual(['日記', '買い物'])
    for (const n of notes) {
      expect(n.favorite).toBe(false)
      expect(n.deletedAt).toBeNull()
      expect(n.design).toEqual(legacyDesign())
      expect(n.updatedAt).toBe(2) // 更新日時は変えない
    }
    const pages = await getPages('n1')
    expect(pages.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(pages[0].stickies).toEqual([sticky])
    expect(pages[0].content).toEqual(content)
    expect(pages.every((p) => p.deletedAt === null && p.deletedIndex === null)).toBe(true)
    expect(db.verno).toBe(4)
    db.close()
  })
})
