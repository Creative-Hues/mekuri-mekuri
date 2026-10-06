import { describe, expect, it } from 'vitest'
import Dexie from 'dexie'

// v1(アプリ 0.1.0)で保存されたデータが、v2 のアプリで開いたときに消えずに移るかのテスト

describe('データ移行 v1 → v2', () => {
  it('既存のノート・ページを残したまま、ページに空の付箋リストを足す', async () => {
    // 0.1.0 のアプリと同じ形の DB を作る
    const old = new Dexie('mekuri-mekuri')
    old.version(1).stores({
      notes: 'id, order',
      pages: 'id, noteId, [noteId+order]',
      meta: 'key',
    })
    const content = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '前から書いていたノート', marks: [{ type: 'bold' }] }] }],
    }
    await old.table('notes').add({ id: 'n1', title: '日記', order: 0, createdAt: 1, updatedAt: 2 })
    await old.table('pages').bulkAdd([
      { id: 'p1', noteId: 'n1', order: 0, content, createdAt: 1, updatedAt: 2 },
      { id: 'p2', noteId: 'n1', order: 1, content, createdAt: 1, updatedAt: 2 },
    ])
    await old.table('meta').put({ key: 'lastBackupAt', value: 123 })
    old.close()

    // 新しいアプリの DB(v2)で開く
    const { db, SCHEMA_VERSION } = await import('../src/db/db')
    const { getPages } = await import('../src/db/repo')
    expect(SCHEMA_VERSION).toBe(2)

    const note = await db.notes.get('n1')
    expect(note).toEqual({ id: 'n1', title: '日記', order: 0, createdAt: 1, updatedAt: 2 })

    const pages = await getPages('n1')
    expect(pages.map((p) => p.id)).toEqual(['p1', 'p2'])
    for (const p of pages) {
      expect(p.stickies).toEqual([])
      expect(p.content).toEqual(content) // 本文はそのまま
      expect(p.updatedAt).toBe(2)
    }
    expect((await db.meta.get('lastBackupAt'))?.value).toBe(123)
    expect(db.verno).toBe(2)
    db.close()
  })
})
