import { afterEach, describe, expect, it } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import { buildExtensions, buildStickyExtensions } from '../src/editor/extensions'
import { appendColumn, appendRow, insertTable, isInTable, selectCell, setCellBackground } from '../src/editor/table'
import { movableAt, movableBlocks, planMoveAdjacent } from '../src/editor/blockMove'
import { applyWebLink, currentLink, normalizeUrl, removeWebLink } from '../src/editor/webLink'
import { linkTargetState } from '../src/editor/noteLink'
import { href, parseHash } from '../src/router'
import { legacyDesign } from '../src/design/defaults'
import type { Note, Page } from '../src/db/db'

// 表・画像・ノートへのリンク・Webリンク(本物のエディタで確かめる)

let editors: Editor[] = []
afterEach(() => {
  editors.forEach((e) => e.destroy())
  editors = []
})

const hooks = { undo: () => {}, redo: () => {}, closeGroup: () => {} }
function pageEditor(content: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }) {
  const e = new Editor({ extensions: buildExtensions(hooks), content })
  editors.push(e)
  return e
}
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const cell = (text = '', bg: string | null = null) => ({
  type: 'tableCell',
  attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null, bg },
  content: [text ? para(text) : { type: 'paragraph' }],
})
const table = (rows: string[][]) => ({
  type: 'table',
  content: rows.map((r) => ({ type: 'tableRow', content: r.map((t) => cell(t)) })),
})
/** 表の大きさ [行, 列] */
const sizeOf = (e: Editor, tablePos = 0) => {
  const t = e.state.doc.nodeAt(tablePos)!
  return [t.childCount, t.child(0).childCount]
}

describe('表', () => {
  it('3行×3列の表を入れられる(見出し行なし)', () => {
    const e = pageEditor()
    insertTable(e)
    const t = e.state.doc.firstChild!
    expect(t.type.name).toBe('table')
    expect(sizeOf(e)).toEqual([3, 3])
    expect(t.child(0).child(0).type.name).toBe('tableCell')
    expect(isInTable(e)).toBe(true)
  })

  it('「＋」で最後に列・行が増える(中身はそのまま)', () => {
    const e = pageEditor({ type: 'doc', content: [table([['A', 'B'], ['C', 'D']])] })
    let tr = e.state.tr
    expect(appendColumn(tr, 0)).toBe(true)
    e.view.dispatch(tr)
    expect(sizeOf(e)).toEqual([2, 3])
    tr = e.state.tr
    expect(appendRow(tr, 0)).toBe(true)
    e.view.dispatch(tr)
    expect(sizeOf(e)).toEqual([3, 3])
    const t = e.state.doc.firstChild!
    expect(t.child(0).child(0).textContent).toBe('A')
    expect(t.child(1).child(1).textContent).toBe('D')
    expect(t.child(2).child(2).textContent).toBe('')
  })

  it('表でない所では「＋」は何もしない', () => {
    const e = pageEditor({ type: 'doc', content: [para('ふつうの行')] })
    expect(appendRow(e.state.tr, 0)).toBe(false)
  })

  it('セルの背景色は色名で保存され、JSON で行き来できる', () => {
    const e = pageEditor({ type: 'doc', content: [table([['A', 'B']])] })
    const tr = e.state.tr
    // 1つ目のセルの位置は、表の中の行の中(0 + 1 + 1)
    expect(setCellBackground(tr, 2, 'yellow')).toBe(true)
    e.view.dispatch(tr)
    const json = e.getJSON()
    expect(json.content![0].content![0].content![0].attrs!.bg).toBe('yellow')
    const again = pageEditor(json)
    expect(again.state.doc.firstChild!.child(0).child(0).attrs.bg).toBe('yellow')
    expect(again.getHTML()).toContain('data-bg="yellow"')
  })

  it('長押しメニューの行・列の挿入と削除(カーソルを置いたセルが基準)', () => {
    const e = pageEditor({ type: 'doc', content: [table([['A', 'B'], ['C', 'D']])] })
    selectCell(e, 2) // A のセル
    e.commands.addRowBefore()
    expect(sizeOf(e)).toEqual([3, 2])
    e.commands.addColumnAfter()
    expect(sizeOf(e)).toEqual([3, 3])
    e.commands.deleteRow()
    expect(sizeOf(e)).toEqual([2, 3])
    e.commands.deleteColumn()
    expect(sizeOf(e)).toEqual([2, 2])
    e.commands.deleteTable()
    expect(e.state.doc.firstChild?.type.name).not.toBe('table')
  })

  it('セルの中は段落だけ(見出し・リストは入らない)', () => {
    const e = pageEditor({ type: 'doc', content: [table([['A']])] })
    selectCell(e, 2)
    e.commands.toggleHeading({ level: 1 })
    e.commands.toggleBulletList()
    const c = e.state.doc.firstChild!.child(0).child(0)
    expect(c.childCount).toBe(1)
    expect(c.child(0).type.name).toBe('paragraph')
  })

  it('付箋のエディタには表・画像・ノートへのリンクがない(Webリンクはある)', () => {
    const e = new Editor({ extensions: buildStickyExtensions(hooks) })
    editors.push(e)
    expect(e.schema.nodes.table).toBeUndefined()
    expect(e.schema.nodes.image).toBeUndefined()
    expect(e.schema.nodes.noteLink).toBeUndefined()
    expect(e.schema.marks.link).toBeDefined()
  })
})

describe('行の移動(表・画像・ノートへのリンク)', () => {
  const doc = {
    type: 'doc',
    content: [
      para('1行目'),
      table([['A', 'B']]),
      { type: 'image', attrs: { imageId: 'i1', width: 10, height: 10 } },
      { type: 'noteLink', attrs: { noteId: 'n1', pageId: null } },
      para('最後'),
    ],
  }

  it('表・画像・リンクは1行として動かせる。セルの中の段落は単独では動かさない', () => {
    const e = pageEditor(doc)
    const names = movableBlocks(e.state.doc).map((b) => b.node.type.name)
    expect(names).toEqual(['paragraph', 'table', 'image', 'noteLink', 'paragraph'])
  })

  it('セルの中にカーソルがあるときは、表ごと動かす', () => {
    const e = pageEditor(doc)
    const tablePos = e.state.doc.child(0).nodeSize
    expect(movableAt(e.state.doc, tablePos + 4)?.node.type.name).toBe('table')
  })

  it('Alt+↑ で表が1行上へ、画像が下へ', () => {
    const e = pageEditor(doc)
    const tablePos = e.state.doc.child(0).nodeSize
    const up = planMoveAdjacent(e.state.doc, tablePos + 4, 'up')!
    expect(up.doc.child(0).type.name).toBe('table')
    expect(up.doc.child(1).textContent).toBe('1行目')

    const imagePos = tablePos + e.state.doc.child(1).nodeSize
    const down = planMoveAdjacent(e.state.doc, imagePos, 'down')!
    expect(down.doc.child(2).type.name).toBe('noteLink')
    expect(down.doc.child(3).type.name).toBe('image')
  })
})

describe('画像・ノートへのリンクのノード', () => {
  it('JSON で行き来できる(本文には id だけを保存する)', () => {
    const json = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { imageId: 'i1', width: 400, height: 300 } },
        { type: 'noteLink', attrs: { noteId: 'n1', pageId: 'p1' } },
        { type: 'noteLink', attrs: { noteId: 'n2', pageId: null } },
      ],
    }
    expect(pageEditor(json).getJSON()).toEqual(json)
  })

  it('画像・リンクを入れるコマンド', () => {
    const e = pageEditor()
    e.commands.insertImage({ imageId: 'i9', width: 2, height: 1 })
    e.commands.insertNoteLink({ noteId: 'n9', pageId: null })
    const types = e.getJSON().content!.map((n) => n.type)
    expect(types).toContain('image')
    expect(types).toContain('noteLink')
  })
})

describe('ノートへのリンクの行き先', () => {
  const n = (over: Partial<Note> = {}): Note => ({
    id: 'n1', title: 'A', order: 0, favorite: false, deletedAt: null, design: legacyDesign(), createdAt: 0, updatedAt: 0, ...over,
  })
  const p = (over: Partial<Page> = {}): Page => ({
    id: 'p2', noteId: 'n1', order: 1, content: { type: 'doc' }, stickies: [], deletedAt: null, deletedIndex: null,
    createdAt: 0, updatedAt: 0, ...over,
  })

  it('ページ番号は今の並びから求める', () => {
    expect(linkTargetState(n(), p(), ['p1', 'p2'], 'p2')).toEqual({ kind: 'ok', note: n(), pageNumber: 2 })
    expect(linkTargetState(n(), undefined, [], null)).toEqual({ kind: 'ok', note: n(), pageNumber: null })
  })

  it('ゴミ箱・見つからないとき', () => {
    expect(linkTargetState(n({ deletedAt: 5 }), p(), ['p2'], 'p2').kind).toBe('trash')
    expect(linkTargetState(n(), p({ deletedAt: 5 }), ['p1'], 'p2').kind).toBe('trash')
    expect(linkTargetState(undefined, undefined, [], null).kind).toBe('missing')
    expect(linkTargetState(n(), undefined, ['p1'], 'p2').kind).toBe('missing')
    expect(linkTargetState(n(), p({ noteId: 'ほか' }), ['p2'], 'p2').kind).toBe('missing')
  })

  it('ページを指定した URL を作り・読める', () => {
    expect(parseHash(href.note('n 1', 'p/2'))).toEqual({ name: 'note', id: 'n 1', pageId: 'p/2' })
    expect(parseHash(href.note('n1'))).toEqual({ name: 'note', id: 'n1' })
    expect(parseHash('#/trash')).toEqual({ name: 'trash' })
    expect(parseHash('#/なにか')).toEqual({ name: 'shelf' })
  })
})

describe('Webリンク', () => {
  it('URL を整える', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/')
    expect(normalizeUrl(' https://example.com/a?b=1 ')).toBe('https://example.com/a?b=1')
    expect(normalizeUrl('http://localhost:3000')).toBe('http://localhost:3000/')
    expect(normalizeUrl('mailto:a@example.com')).toBe('mailto:a@example.com')
  })

  it('使えない URL は null', () => {
    expect(normalizeUrl('')).toBeNull()
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('こんにちは')).toBeNull()
    expect(normalizeUrl('a b.com')).toBeNull()
    expect(normalizeUrl('https://abc')).toBeNull()
  })

  it('選んだ文字にリンクを付け、外せる', () => {
    const e = pageEditor({ type: 'doc', content: [para('公式サイトはこちら')] })
    e.commands.setTextSelection({ from: 1, to: 6 })
    applyWebLink(e, 'https://example.com/')
    e.commands.setTextSelection(3)
    expect(currentLink(e)).toEqual({ href: 'https://example.com/', from: 1, to: 6 })
    removeWebLink(e, 1, 6)
    e.commands.setTextSelection(3)
    expect(currentLink(e)).toBeNull()
  })

  it('文字を選んでいなければ、URL をそのまま入れる', () => {
    const e = pageEditor()
    applyWebLink(e, 'https://example.com/')
    expect(e.state.doc.textContent).toBe('https://example.com/')
    expect(e.getJSON().content![0].content![0].marks![0]).toMatchObject({ type: 'link', attrs: { href: 'https://example.com/' } })
  })
})
