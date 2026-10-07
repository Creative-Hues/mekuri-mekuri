import { describe, expect, it } from 'vitest'
import Dexie from 'dexie'

// v5(アプリ 1.1.0〜1.2.0)で保存されたデータが、1.3.0 で開いたときに消えずに v6 の形へ移るかのテスト

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const cell = (type: string, text: string, bg: string | null = null) => ({
  type,
  attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null, bg },
  content: [para(text)],
})
const tableWithHeader = {
  type: 'table',
  content: [
    { type: 'tableRow', content: [cell('tableHeader', '見出し', 'yellow'), cell('tableHeader', '値')] },
    { type: 'tableRow', content: [cell('tableCell', 'a'), cell('tableCell', '1')] },
  ],
}
const plainTable = {
  type: 'table',
  content: [{ type: 'tableRow', content: [cell('tableCell', 'x', 'pink'), cell('tableCell', 'y')] }],
}

describe('データ移行 v5 → v6', () => {
  it('ページ(ゴミ箱のページ・ゴミ箱のノートのページも)の表を新しい形にし、ほかは変えない', async () => {
    const old = new Dexie('mekuri-mekuri')
    old.version(5).stores({
      notes: 'id, order',
      pages: 'id, noteId, [noteId+order]',
      images: 'id',
      meta: 'key',
    })
    const design = {
      paper: null,
      border: { color: 'brown', width: 'none' },
      cover: { pattern: 'plain', color: 'slate', subColor: 'auto', patternScale: 'medium', textColor: 'auto', layout: 'topLeft', font: 'gothicBold' },
      bodyFont: 'cover',
    }
    const note = (id: string, deletedAt: number | null = null) => ({
      id, title: id, order: 0, favorite: false, deletedAt, design, createdAt: 1, updatedAt: 2,
    })
    const page = (id: string, noteId: string, content: object, deletedAt: number | null = null) => ({
      id, noteId, order: 0, content, stickies: [], deletedAt, deletedIndex: deletedAt ? 0 : null, createdAt: 1, updatedAt: 3,
    })
    const textOnly = { type: 'doc', content: [para('本文')] }
    await old.table('notes').bulkAdd([note('n1'), note('n2', 900)])
    await old.table('pages').bulkAdd([
      page('p1', 'n1', { type: 'doc', content: [para('前'), tableWithHeader, plainTable] }),
      page('p2', 'n1', { type: 'doc', content: [tableWithHeader] }, 800),
      page('p3', 'n2', { type: 'doc', content: [tableWithHeader] }),
      page('p4', 'n1', textOnly),
    ])
    await old.table('meta').add({ key: 'firstLaunchAt', value: 123 })
    old.close()

    const { db } = await import('../src/db/db')
    const pages = Object.fromEntries((await db.pages.toArray()).map((p) => [p.id, p]))
    expect(Object.keys(pages).sort()).toEqual(['p1', 'p2', 'p3', 'p4'])

    // 見出しセルのあった表:見出しの設定にし、セルは普通のセル(色・文字は残る)
    for (const [id, i] of [['p1', 1], ['p2', 0], ['p3', 0]] as const) {
      const t = pages[id].content.content![i]
      expect(t.attrs).toMatchObject({ headerRow: true, headerColumn: false })
      expect(t.content![0].content!.map((c) => c.type)).toEqual(['tableCell', 'tableCell'])
      expect(t.content![0].content![0].attrs!.bg).toBe('yellow')
      expect(t.content![0].content![0].content).toEqual([para('見出し')])
    }
    // 見出しのない表:見出しなしの設定が付くだけ
    const plain = pages.p1.content.content![2]
    expect(plain.attrs).toMatchObject({ headerRow: false, headerColumn: false })
    expect(plain.content).toEqual(plainTable.content)
    expect(pages.p1.content.content![0]).toEqual(para('前'))

    // 表のないページは変わらない。ゴミ箱の状態・更新日時も変えない
    expect(pages.p4.content).toEqual(textOnly)
    expect(pages.p2.deletedAt).toBe(800)
    for (const p of Object.values(pages)) expect(p.updatedAt).toBe(3)
    expect((await db.notes.get('n2'))!.deletedAt).toBe(900)
    expect((await db.meta.get('firstLaunchAt'))?.value).toBe(123)
    expect(db.verno).toBe(6)
    db.close()
  })
})
