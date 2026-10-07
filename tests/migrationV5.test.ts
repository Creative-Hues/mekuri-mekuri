import { describe, expect, it } from 'vitest'
import Dexie from 'dexie'

// v4(アプリ 0.5.0〜1.0.0)で保存されたデータが、1.1.0 で開いたときに消えずに v5 の形へ移るかのテスト

const v4Design = (cover: object, paper: string | null = null) => ({
  paper,
  border: { color: 'gold', width: 'medium' },
  cover: { color: 'wine', layout: 'band', font: 'minchoBold', ...cover },
})

describe('データ移行 v4 → v5', () => {
  it('ノート・ページ・付箋・画像を残したまま、デザインに新しい項目を足し、なくした柄を無地にする', async () => {
    // 1.0.0 のアプリと同じ形の DB を作る
    const old = new Dexie('mekuri-mekuri')
    old.version(4).stores({
      notes: 'id, order',
      pages: 'id, noteId, [noteId+order]',
      images: 'id',
      meta: 'key',
    })
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '本文' }] }] }
    const sticky = {
      id: 's1', x: 0.1, y: 0.2, w: 0.3, h: 0.3, color: 'pink',
      content: { type: 'doc', content: [{ type: 'paragraph' }] }, createdAt: 1, updatedAt: 1,
    }
    const note = (id: string, design: object, extra: object = {}) => ({
      id, title: id, order: 0, favorite: false, deletedAt: null, design, createdAt: 1, updatedAt: 2, ...extra,
    })
    await old.table('notes').bulkAdd([
      note('青海波', v4Design({ pattern: 'seigaiha' }, 'cream')),
      note('鱗', v4Design({ pattern: 'uroko' })),
      note('市松', v4Design({ pattern: 'ichimatsu' }), { favorite: true }),
      note('ドット', v4Design({ pattern: 'dots', font: 'maru' })),
      note('ゴミ箱', v4Design({ pattern: 'wave' }), { deletedAt: 500 }),
    ])
    await old.table('pages').bulkAdd([
      { id: 'p1', noteId: 'ドット', order: 0, content, stickies: [sticky], deletedAt: null, deletedIndex: null, createdAt: 1, updatedAt: 2 },
    ])
    await old.table('images').add({
      id: 'img1', mime: 'image/png', data: new Uint8Array([1, 2, 3]).buffer, width: 1, height: 1, createdAt: 1, unusedSince: null,
    })
    await old.table('meta').add({ key: 'firstLaunchAt', value: 123 })
    old.close()

    const { db } = await import('../src/db/db')
    const { getPages } = await import('../src/db/repo')

    const notes = Object.fromEntries((await db.notes.toArray()).map((n) => [n.id, n]))
    expect(Object.keys(notes).sort()).toEqual(['ゴミ箱', 'ドット', '市松', '青海波', '鱗'].sort())

    // なくした柄は無地。ほかのデザインの項目は変わらない
    for (const id of ['青海波', '鱗', '市松']) {
      expect(notes[id].design.cover.pattern).toBe('plain')
      expect(notes[id].design.cover).toMatchObject({ color: 'wine', layout: 'band', font: 'minchoBold' })
      expect(notes[id].design.border).toEqual({ color: 'gold', width: 'medium' })
    }
    expect(notes['青海波'].design.paper).toBe('cream')
    expect(notes['ドット'].design.cover.pattern).toBe('dots')
    expect(notes['ゴミ箱'].design.cover.pattern).toBe('wave')

    // 新しい項目:本文は表紙と同じ、サブ色は なじむ色、柄の大きさは 中
    for (const n of Object.values(notes)) {
      expect(n.design.bodyFont).toBe('cover')
      expect(n.design.cover.subColor).toBe('auto')
      expect(n.design.cover.patternScale).toBe('medium')
      expect(n.design.cover.textColor).toBe('auto') // タイトルの文字色は自動(今までと同じ)
      expect(n.updatedAt).toBe(2) // 更新日時は変えない
    }

    // お気に入り・ゴミ箱はそのまま
    expect(notes['市松'].favorite).toBe(true)
    expect(notes['ゴミ箱'].deletedAt).toBe(500)

    // ページ・付箋・画像・meta は変わらない
    const pages = await getPages('ドット')
    expect(pages[0].content).toEqual(content)
    expect(pages[0].stickies).toEqual([sticky])
    expect(await db.images.count()).toBe(1)
    expect((await db.meta.get('firstLaunchAt'))?.value).toBe(123)

    expect(db.verno).toBe(5)
    db.close()
  })
})
