import { afterEach, describe, expect, it } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import { CellSelection } from '@tiptap/pm/tables'
import type { Command } from '@tiptap/pm/state'
import { buildExtensions } from '../src/editor/extensions'
import {
  clearCells,
  columnWidths,
  deleteLine,
  duplicateLine,
  insertLine,
  lineIsSimple,
  mergeSelectedCells,
  moveLine,
  selectCells,
  selectLine,
  selectedCellPositions,
  setCellsAlign,
  setCellsBackground,
  setColumnWidth,
  setHeader,
  splitSelectedCell,
  tableAt,
  MIN_COL_WIDTH,
} from '../src/editor/tableOps'
import { NoteHistory } from '../src/history/noteHistory'

// 表の操作(つまみのメニュー・並び替え・列の幅・結合・配置・範囲選択・Tab・元に戻す)

let editors: Editor[] = []
afterEach(() => {
  editors.forEach((e) => e.destroy())
  editors = []
})

const hooks = { undo: () => {}, redo: () => {}, closeGroup: () => {} }
const para = (text: string): JSONContent => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })
const cell = (text: string, attrs: object = {}): JSONContent => ({ type: 'tableCell', attrs, content: [para(text)] })
const table = (rows: (string | JSONContent)[][], attrs: object = {}): JSONContent => ({
  type: 'table',
  attrs,
  content: rows.map((r) => ({ type: 'tableRow', content: r.map((c) => (typeof c === 'string' ? cell(c) : c)) })),
})

/** 表を1つだけ置いたエディタ(表の位置は 0) */
function editorWith(t: JSONContent, onTransaction?: (e: Editor, before: Editor['state']['doc']) => void) {
  const e: Editor = new Editor({
    extensions: buildExtensions(hooks),
    // 表のあとに段落(エディタは文書の最後に空の段落を足すので、初めからそろえておく)
    content: { type: 'doc', content: [t, { type: 'paragraph' }] },
    onTransaction: ({ editor, transaction }) => {
      if (transaction.docChanged) onTransaction?.(editor, transaction.before)
    },
  })
  editors.push(e)
  return e
}
const run = (e: Editor, cmd: Command) => cmd(e.state, e.view.dispatch)
/** 表の文字を、行ごとの配列で(結合したセルは1つ) */
const texts = (e: Editor) => {
  const t = e.state.doc.firstChild!
  const out: string[][] = []
  t.forEach((r) => {
    const row: string[] = []
    r.forEach((c) => row.push(c.textContent))
    out.push(row)
  })
  return out
}
/** 表の (row, col) のセルの位置 */
const cellPos = (e: Editor, row: number, col: number) => {
  const t = tableAt(e.state.doc, 0)!
  return t.start + t.map.map[row * t.map.width + col]
}
const select = (e: Editor, a: [number, number], b: [number, number]) => {
  const tr = e.state.tr
  selectCells(tr, cellPos(e, ...a), cellPos(e, ...b))
  e.view.dispatch(tr)
}
/** キーを押す(エディタのキーの処理に直接渡す) */
const press = (e: Editor, key: string, shiftKey = false) =>
  e.view.someProp('handleKeyDown', (f) => f(e.view, new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })))
const cursorIn = (e: Editor, row: number, col: number) => e.commands.setTextSelection(cellPos(e, row, col) + 2)

const grid = () =>
  table([
    ['A', 'B', 'C'],
    ['D', 'E', 'F'],
    ['G', 'H', 'I'],
  ])

describe('行・列のつまみのメニュー', () => {
  it('上・下(左・右)に空の行(列)を入れ、入れた所にカーソルを置く', () => {
    const e = editorWith(grid())
    run(e, insertLine(0, 'row', 0, 'before'))
    expect(texts(e).map((r) => r.join(''))).toEqual(['', 'ABC', 'DEF', 'GHI'])
    run(e, insertLine(0, 'col', 2, 'after'))
    expect(texts(e)[1]).toEqual(['A', 'B', 'C', ''])
    expect(selectedCellPositions(e.state)).toEqual([cellPos(e, 0, 3)])
  })

  it('複製:中身ごとすぐ後ろに入る(色などの設定も)', () => {
    const e = editorWith(table([['A', cell('B', { bg: 'pink' })], ['C', 'D']]))
    run(e, duplicateLine(0, 'row', 0))
    expect(texts(e)).toEqual([['A', 'B'], ['A', 'B'], ['C', 'D']])
    expect(e.state.doc.firstChild!.child(1).child(1).attrs.bg).toBe('pink')
    run(e, duplicateLine(0, 'col', 1))
    expect(texts(e)).toEqual([['A', 'B', 'B'], ['A', 'B', 'B'], ['C', 'D', 'D']])
    // 複製した行(列)が選ばれている
    expect(e.state.selection).toBeInstanceOf(CellSelection)
  })

  it('結合したセルにまたがる行・列は複製できない', () => {
    const e = editorWith(table([[cell('AB', { colspan: 2 }), 'C'], ['D', 'E', 'F']]))
    const t = tableAt(e.state.doc, 0)!
    expect(lineIsSimple(t, 'row', 0)).toBe(true)
    expect(lineIsSimple(t, 'col', 0)).toBe(false)
    expect(lineIsSimple(t, 'col', 2)).toBe(true)
    expect(run(e, duplicateLine(0, 'col', 0))).toBe(false)
  })

  it('削除:その行(列)を消す。最後の1行(1列)は消さない', () => {
    const e = editorWith(grid())
    run(e, deleteLine(0, 'row', 1))
    expect(texts(e)).toEqual([['A', 'B', 'C'], ['G', 'H', 'I']])
    run(e, deleteLine(0, 'col', 0))
    expect(texts(e)).toEqual([['B', 'C'], ['H', 'I']])
    const one = editorWith(table([['A']]))
    expect(run(one, deleteLine(0, 'row', 0))).toBe(false)
    expect(run(one, deleteLine(0, 'col', 0))).toBe(false)
  })

  it('つまみを押すと、その行(列)がまるごと選ばれる', () => {
    const e = editorWith(grid())
    const tr = e.state.tr
    selectLine(tr, 0, 'col', 1)
    e.view.dispatch(tr)
    expect(selectedCellPositions(e.state).length).toBe(3)
    expect((e.state.selection as CellSelection).isColSelection()).toBe(true)
  })
})

describe('つまみのドラッグで並び替え', () => {
  it('行・列を動かす(中身・色ごと)', () => {
    const e = editorWith(table([['A', 'B'], ['C', cell('D', { bg: 'blue' })], ['E', 'F']]))
    expect(run(e, moveLine(0, 'row', 0, 2))).toBe(true)
    expect(texts(e)).toEqual([['C', 'D'], ['E', 'F'], ['A', 'B']])
    expect(run(e, moveLine(0, 'col', 1, 0))).toBe(true)
    expect(texts(e)).toEqual([['D', 'C'], ['F', 'E'], ['B', 'A']])
    expect(e.state.doc.firstChild!.child(0).child(0).attrs.bg).toBe('blue')
  })

  it('並び替えても「1行目が見出し」のまま(見出しは表の設定)', () => {
    const e = editorWith(table([['見出し'], ['a'], ['b']], { headerRow: true }))
    run(e, moveLine(0, 'row', 0, 2))
    expect(texts(e)).toEqual([['a'], ['b'], ['見出し']])
    expect(e.state.doc.firstChild!.attrs.headerRow).toBe(true)
  })

  it('縦に結合したセルのある行は、結合したまとまりごと動く', () => {
    const e = editorWith(table([[cell('A', { rowspan: 2 }), 'B'], ['C'], ['D', 'E']]))
    expect(run(e, moveLine(0, 'row', 2, 0))).toBe(true)
    expect(texts(e)).toEqual([['D', 'E'], ['A', 'B'], ['C']])
    // まとまりの中への移動はできない
    expect(run(e, moveLine(0, 'row', 1, 2))).toBe(false)
  })
})

describe('列の幅', () => {
  it('動かした列だけ指定の幅、ほかの列は今の幅(測った幅)で固定する', () => {
    const e = editorWith(grid())
    expect(columnWidths(tableAt(e.state.doc, 0)!)).toEqual([null, null, null])
    run(e, setColumnWidth(0, 1, 200, [90, 100, 110]))
    expect(columnWidths(tableAt(e.state.doc, 0)!)).toEqual([90, 200, 110])
    expect(e.state.doc.firstChild!.child(2).child(1).attrs.colwidth).toEqual([200])
  })

  it('最小の幅より狭くはならない。結合したセルは、またぐ列の幅をそれぞれ持つ', () => {
    const e = editorWith(table([[cell('AB', { colspan: 2 }), 'C'], ['D', 'E', 'F']]))
    run(e, setColumnWidth(0, 0, 5, [80, 90, 100]))
    expect(columnWidths(tableAt(e.state.doc, 0)!)).toEqual([MIN_COL_WIDTH, 90, 100])
    expect(e.state.doc.firstChild!.child(0).child(0).attrs.colwidth).toEqual([MIN_COL_WIDTH, 90])
  })

  it('列を動かすと幅もいっしょに動く', () => {
    const e = editorWith(grid())
    run(e, setColumnWidth(0, 0, 150, [80, 90, 100]))
    run(e, moveLine(0, 'col', 0, 2))
    expect(columnWidths(tableAt(e.state.doc, 0)!)).toEqual([90, 100, 150])
  })
})

describe('見出し', () => {
  it('1行目・1列目を見出しにする/やめる。同じなら何もしない', () => {
    const e = editorWith(grid())
    expect(run(e, setHeader(0, 'row', true))).toBe(true)
    expect(run(e, setHeader(0, 'row', true))).toBe(false)
    run(e, setHeader(0, 'col', true))
    expect(e.state.doc.firstChild!.attrs).toMatchObject({ headerRow: true, headerColumn: true })
    run(e, setHeader(0, 'row', false))
    expect(e.state.doc.firstChild!.attrs.headerRow).toBe(false)
  })

  it('見出しのセルに is-head の見た目が付く(結合したセルも)', () => {
    const e = editorWith(table([[cell('A', { rowspan: 2 }), 'B'], ['C'], ['D', 'E']], { headerColumn: true }))
    const heads = Array.from(e.view.dom.querySelectorAll('td.is-head')).map((td) => td.textContent)
    expect(heads).toEqual(['A', 'D'])
    run(e, setHeader(0, 'row', true))
    const heads2 = Array.from(e.view.dom.querySelectorAll('td.is-head')).map((td) => td.textContent)
    expect(heads2).toEqual(['A', 'B', 'D'])
  })

  it('見出しの設定は HTML に書き出され、読み直せる', () => {
    const e = editorWith(table([['A']], { headerRow: true, headerColumn: true }))
    const html = e.getHTML()
    expect(html).toContain('data-header-row="true"')
    const again = new Editor({ extensions: buildExtensions(hooks), content: html })
    editors.push(again)
    expect(again.state.doc.firstChild!.attrs).toMatchObject({ headerRow: true, headerColumn: true })
  })
})

describe('選んだセルへの操作', () => {
  it('範囲を選んで、色・配置をまとめて変える', () => {
    const e = editorWith(grid())
    select(e, [0, 0], [1, 1])
    expect(selectedCellPositions(e.state).length).toBe(4)
    run(e, setCellsBackground('green'))
    run(e, setCellsAlign('center'))
    const t = e.state.doc.firstChild!
    expect([t.child(0).child(0), t.child(0).child(1), t.child(1).child(0), t.child(1).child(1)].map((c) => [c.attrs.bg, c.attrs.align])).toEqual(
      Array(4).fill(['green', 'center']),
    )
    expect(t.child(2).child(2).attrs.bg).toBeNull()
    // 左は「指定なし」に戻す
    run(e, setCellsAlign('left'))
    expect(e.state.doc.firstChild!.child(0).child(0).attrs.align).toBeNull()
  })

  it('配置は HTML に書き出される', () => {
    const e = editorWith(table([[cell('A', { align: 'right' })]]))
    expect(e.getHTML()).toContain('text-align: right')
  })

  it('カーソルだけのときは、そのセルだけ', () => {
    const e = editorWith(grid())
    cursorIn(e, 1, 2)
    run(e, setCellsBackground('red'))
    expect(e.state.doc.firstChild!.child(1).child(2).attrs.bg).toBe('red')
    expect(e.state.doc.firstChild!.child(1).child(1).attrs.bg).toBeNull()
  })

  it('選んだセルの中身を消す(セルは残る)', () => {
    const e = editorWith(grid())
    select(e, [0, 1], [1, 2])
    run(e, clearCells)
    expect(texts(e)).toEqual([['A', '', ''], ['D', '', ''], ['G', 'H', 'I']])
  })

  it('結合して、分割で戻す', () => {
    const e = editorWith(grid())
    select(e, [0, 0], [1, 1])
    expect(run(e, mergeSelectedCells)).toBe(true)
    const t = e.state.doc.firstChild!
    expect(t.child(0).child(0).attrs).toMatchObject({ colspan: 2, rowspan: 2 })
    expect(t.child(0).child(0).textContent).toBe('ABDE')
    cursorIn(e, 0, 0)
    expect(run(e, splitSelectedCell)).toBe(true)
    expect(tableAt(e.state.doc, 0)!.map.map.length).toBe(9)
    expect(e.state.doc.firstChild!.child(0).child(0).attrs).toMatchObject({ colspan: 1, rowspan: 1 })
  })

  it('1つのセルだけでは結合できない', () => {
    const e = editorWith(grid())
    cursorIn(e, 0, 0)
    expect(run(e, mergeSelectedCells)).toBe(false)
  })
})

describe('Tab(PC)', () => {
  it('Tab で次のセル、Shift+Tab で前のセル、最後のセルの Tab で行が増える', () => {
    const e = editorWith(table([['A', 'B'], ['C', 'D']]))
    cursorIn(e, 0, 0)
    press(e, 'Tab')
    expect(selectedCellPositions(e.state)).toEqual([cellPos(e, 0, 1)])
    press(e, 'Tab', true)
    expect(selectedCellPositions(e.state)).toEqual([cellPos(e, 0, 0)])
    cursorIn(e, 1, 1)
    press(e, 'Tab')
    expect(texts(e)).toEqual([['A', 'B'], ['C', 'D'], ['', '']])
    expect(selectedCellPositions(e.state)).toEqual([cellPos(e, 2, 0)])
  })
})

describe('元に戻す/やり直し', () => {
  it('表の操作は、それぞれ1回の「元に戻す」で戻り、やり直せる', async () => {
    let editor!: Editor
    const history = new NoteHistory({
      setPageContent: async (_id, doc) => {
        editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content))
      },
      removePage: async () => null,
      trashPage: async () => null,
      restorePage: async () => {},
      rename: async () => {},
      setDesign: async () => {},
      reorderPages: async () => {},
      setStickies: async () => {},
    })
    editor = editorWith(grid(), (e, before) => {
      if (!history.isApplying) history.recordText('p', before, e.state.doc)
    })
    const ops: Command[] = [
      moveLine(0, 'row', 0, 2),
      setColumnWidth(0, 0, 160, [80, 80, 80]),
      setHeader(0, 'col', true),
      duplicateLine(0, 'col', 1),
      deleteLine(0, 'row', 0),
    ]
    const snapshots = [editor.getJSON()]
    for (const op of ops) {
      history.closeGroup()
      expect(run(editor, op)).toBe(true)
      history.closeGroup()
      snapshots.push(editor.getJSON())
    }
    select(editor, [0, 0], [1, 1])
    history.closeGroup()
    run(editor, mergeSelectedCells)
    history.closeGroup()
    snapshots.push(editor.getJSON())

    for (let i = snapshots.length - 2; i >= 0; i--) {
      await history.undo()
      expect(JSON.stringify(editor.getJSON()), `元に戻す ${i}`).toEqual(JSON.stringify(snapshots[i]))
    }
    for (let i = 1; i < snapshots.length; i++) {
      await history.redo()
      expect(editor.getJSON()).toEqual(snapshots[i])
    }
  })
})
