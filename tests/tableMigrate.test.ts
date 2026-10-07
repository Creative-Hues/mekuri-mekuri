import { describe, expect, it } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import { Slice } from '@tiptap/pm/model'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { upgradeTablesToV6 } from '../src/editor/tableMigrate'
import { buildExtensions } from '../src/editor/extensions'
import { normalizePastedSlice } from '../src/editor/table'
import { parseBackup } from '../src/backup/format'
import { legacyDesign } from '../src/design/defaults'

// 表の見出しの持ち方の移し替え(v5 → v6):見出しセル(tableHeader)→ 表の設定(headerRow・headerColumn)

const para = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const cell = (text: string, type = 'tableCell', attrs: object = {}): JSONContent => ({
  type,
  attrs: { colspan: 1, rowspan: 1, colwidth: null, bg: null, ...attrs },
  content: [para(text)],
})
const th = (text: string, attrs: object = {}) => cell(text, 'tableHeader', attrs)
const row = (...cells: JSONContent[]): JSONContent => ({ type: 'tableRow', content: cells })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const types = (table: JSONContent) => table.content!.map((r) => r.content!.map((c) => c.type))

describe('表の移し替え(upgradeTablesToV6)', () => {
  it('1行目がすべて見出しセルなら headerRow にし、セルは普通のセルにする(色は残す)', () => {
    const before = doc({ type: 'table', content: [row(th('名前', { bg: 'blue' }), th('値')), row(cell('a'), cell('1'))] })
    const t = upgradeTablesToV6(before).content![0]
    expect(t.attrs).toMatchObject({ headerRow: true, headerColumn: false })
    expect(types(t)).toEqual([['tableCell', 'tableCell'], ['tableCell', 'tableCell']])
    expect(t.content![0].content![0].attrs!.bg).toBe('blue')
    expect(t.content![0].content![0].content).toEqual([para('名前')])
  })

  it('各行の最初のセルが見出しセルなら headerColumn(1行だけの表は列にしない)', () => {
    const t = upgradeTablesToV6(doc({ type: 'table', content: [row(th('A'), cell('1')), row(th('B'), cell('2'))] })).content![0]
    expect(t.attrs).toMatchObject({ headerRow: false, headerColumn: true })
    const one = upgradeTablesToV6(doc({ type: 'table', content: [row(th('A'), th('B'))] })).content![0]
    expect(one.attrs).toMatchObject({ headerRow: true, headerColumn: false })
  })

  it('1行目・1列目以外にある見出しセルも普通のセルになる', () => {
    const t = upgradeTablesToV6(doc({ type: 'table', content: [row(cell('A'), cell('B')), row(cell('C'), th('D'))] })).content![0]
    expect(t.attrs).toMatchObject({ headerRow: false, headerColumn: false })
    expect(types(t).flat()).toEqual(['tableCell', 'tableCell', 'tableCell', 'tableCell'])
  })

  it('トグル見出しの中の表も移す', () => {
    const before = doc({
      type: 'toggleHeading',
      attrs: { level: 1, open: true },
      content: [{ type: 'toggleTitle', content: [{ type: 'text', text: 'T' }] }, { type: 'table', content: [row(th('A'))] }],
    })
    const t = upgradeTablesToV6(before).content![0].content![1]
    expect(t.attrs!.headerRow).toBe(true)
    expect(t.content![0].content![0].type).toBe('tableCell')
  })

  it('表のない内容は同じオブジェクトのまま(書き換えない)', () => {
    const d = doc(para('あ'), { type: 'bulletList', content: [{ type: 'listItem', content: [para('い')] }] })
    expect(upgradeTablesToV6(d)).toBe(d)
  })

  it('何度通しても同じ結果。すでに設定のある表は、見出しセルがなければそのまま', () => {
    const once = upgradeTablesToV6(doc({ type: 'table', content: [row(th('A'), th('B')), row(cell('1'), cell('2'))] }))
    const twice = upgradeTablesToV6(once)
    expect(twice).toBe(once)
    // 見出しをやめた表(headerRow: false)が、2回目で見出しに戻らない
    const off = doc({ type: 'table', attrs: { headerRow: false, headerColumn: false }, content: [row(cell('A'))] })
    expect(upgradeTablesToV6(off)).toBe(off)
  })

  it('移した内容は今のエディタでそのまま開ける', () => {
    const content = upgradeTablesToV6(doc({ type: 'table', content: [row(th('A'), th('B')), row(cell('1'), cell('2'))] }))
    const e = new Editor({ extensions: buildExtensions({ undo: () => {}, redo: () => {}, closeGroup: () => {} }), content })
    const t = e.state.doc.firstChild!
    expect(t.attrs.headerRow).toBe(true)
    expect(t.child(0).child(0).type.name).toBe('tableCell')
    e.destroy()
  })
})

describe('v5 のバックアップファイル', () => {
  it('ページの表(ゴミ箱のページも)を v6 の形にして読む。表のないページ・付箋はそのまま', () => {
    const page = (id: string, content: JSONContent, deletedAt: number | null = null) => ({
      id, noteId: 'n1', order: 0, content, stickies: [], deletedAt, deletedIndex: deletedAt ? 0 : null, createdAt: 1, updatedAt: 2,
    })
    const plain = doc(para('本文'))
    const file = JSON.stringify({
      app: 'mekuri-mekuri', schemaVersion: 5, appVersion: '1.2.0', exportedAt: 1,
      notes: [{ id: 'n1', title: 'a', order: 0, favorite: false, deletedAt: null, design: legacyDesign(), createdAt: 1, updatedAt: 2 }],
      pages: [
        page('p1', doc({ type: 'table', content: [row(th('A')), row(cell('1'))] })),
        page('p2', doc({ type: 'table', content: [row(th('B')), row(cell('2'))] }), 100),
        page('p3', plain),
      ],
      images: [],
    })
    const b = parseBackup(file)
    expect(b.schemaVersion).toBe(6)
    for (const id of ['p1', 'p2']) {
      const t = b.pages.find((p) => p.id === id)!.content.content![0]
      expect(t.attrs!.headerRow).toBe(true)
      expect(t.content![0].content![0].type).toBe('tableCell')
    }
    const p2 = b.pages.find((p) => p.id === 'p2')!
    expect(p2.deletedAt).toBe(100)
    expect(p2.updatedAt).toBe(2)
    expect(b.pages.find((p) => p.id === 'p3')!.content).toEqual(plain)
  })
})

describe('貼り付けた表', () => {
  it('ほかのアプリの <th> の見出し行は、普通のセル+見出しの設定になる', () => {
    const e = new Editor({ extensions: buildExtensions({ undo: () => {}, redo: () => {}, closeGroup: () => {} }) })
    const el = document.createElement('div')
    el.innerHTML = '<table><tr><th>名前</th><th>値</th></tr><tr><td>a</td><td>1</td></tr></table>'
    const slice = PMDOMParser.fromSchema(e.schema).parseSlice(el)
    const out = normalizePastedSlice(slice, e.schema)
    expect(out).toBeInstanceOf(Slice)
    const t = out.content.firstChild!
    expect(t.type.name).toBe('table')
    expect(t.attrs.headerRow).toBe(true)
    t.descendants((n) => {
      expect(n.type.name).not.toBe('tableHeader')
      return true
    })
    // 表のない貼り付けはそのまま
    const p = document.createElement('div')
    p.innerHTML = '<p>文字</p>'
    const s2 = PMDOMParser.fromSchema(e.schema).parseSlice(p)
    expect(normalizePastedSlice(s2, e.schema)).toBe(s2)
    e.destroy()
  })
})
