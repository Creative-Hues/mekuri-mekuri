import type { Editor } from '@tiptap/core'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, TextSelection, type Transaction } from '@tiptap/pm/state'
import { TableMap, addColumn, addRow } from '@tiptap/pm/tables'
import type { EditorView, NodeView, ViewMutationRecord } from '@tiptap/pm/view'
import { isMarkerColor, type MarkerColorName } from './palette'

/**
 * 表。
 * - セルの中は段落と文字の装飾だけ(表の中に表・見出し・リストは入れない)
 * - セルの背景色は、マーカーと同じ色名で保存する(bg)
 * - 表の右端と下端に常に「＋」を出し、押すと列・行が最後に増える
 * - セルを長押し(PCは右クリック)すると、色・挿入・削除のメニューを出す(CELL_MENU_EVENT)
 */

/** セルのメニューを出すときに送る合図(ノート画面の TableMenu が受け取る) */
export const CELL_MENU_EVENT = 'mekuri:cell-menu'
export interface CellMenuDetail {
  editor: Editor
  /** セルの位置 */
  cellPos: number
  x: number
  y: number
}

/** セルの背景色の属性(セル・見出しセル共通) */
const bgAttribute = {
  bg: {
    default: null,
    parseHTML: (el: HTMLElement) => {
      const v = el.getAttribute('data-bg')
      return isMarkerColor(v) ? v : null
    },
    renderHTML: (attrs: { bg?: string | null }) => (attrs.bg ? { 'data-bg': attrs.bg } : {}),
  },
}

export const MekuriTableCell = TableCell.extend({
  content: 'paragraph+',
  addAttributes() {
    return { ...this.parent?.(), ...bgAttribute }
  },
})

/** 見出しセル(このアプリでは作らないが、ほかのアプリから貼り付けた表を読めるように入れておく) */
export const MekuriTableHeader = TableHeader.extend({
  content: 'paragraph+',
  addAttributes() {
    return { ...this.parent?.(), ...bgAttribute }
  },
})

export { TableRow as MekuriTableRow }

// ---- 列・行を最後に足す(「＋」ボタン) ----

/** tablePos の表の最後に列を足す */
export function appendColumn(tr: Transaction, tablePos: number): boolean {
  const table = tr.doc.nodeAt(tablePos)
  if (!table || table.type.name !== 'table') return false
  const map = TableMap.get(table)
  addColumn(tr, { map, tableStart: tablePos + 1, table, left: 0, top: 0, right: map.width, bottom: map.height }, map.width)
  return true
}

/** tablePos の表の最後に行を足す */
export function appendRow(tr: Transaction, tablePos: number): boolean {
  const table = tr.doc.nodeAt(tablePos)
  if (!table || table.type.name !== 'table') return false
  const map = TableMap.get(table)
  addRow(tr, { map, tableStart: tablePos + 1, table, left: 0, top: 0, right: map.width, bottom: map.height }, map.height)
  return true
}

/** セルの背景色を変える(null で色なし) */
export function setCellBackground(tr: Transaction, cellPos: number, color: MarkerColorName | null): boolean {
  const cell = tr.doc.nodeAt(cellPos)
  if (!cell || !['tableCell', 'tableHeader'].includes(cell.type.name)) return false
  tr.setNodeMarkup(cellPos, undefined, { ...cell.attrs, bg: color })
  return true
}

/** カーソルをセルの中に置く(メニューの挿入・削除は、カーソルのあるセルを基準にするため) */
export function selectCell(editor: Editor, cellPos: number) {
  const { state } = editor
  const $pos = state.doc.resolve(Math.min(cellPos + 2, state.doc.content.size))
  editor.view.dispatch(state.tr.setSelection(TextSelection.near($pos)))
}

/** 「＋」を押したときの前後で、入力の「元に戻す」を区切るための関数(ページのエディタからもらう) */
export interface TableHooks {
  closeGroup: () => void
}

/**
 * 表の見た目:横にはみ出す表は横スクロール。右と下に「＋」。
 * ボタンはエディタの文章の外(contenteditable=false)に置き、エディタに押した操作を渡さない
 */
class TableBlockView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private buttons: HTMLElement[]

  constructor(
    private node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
    hooks: TableHooks | null,
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'table-block'
    const scroll = document.createElement('div')
    scroll.className = 'table-scroll'
    const table = document.createElement('table')
    this.contentDOM = document.createElement('tbody')
    table.appendChild(this.contentDOM)
    scroll.appendChild(table)
    this.dom.appendChild(scroll)

    const make = (cls: string, label: string, fn: (tr: Transaction, pos: number) => boolean) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = `table-add ${cls}`
      b.contentEditable = 'false'
      b.setAttribute('aria-label', label)
      b.title = label
      b.textContent = '+'
      // 押してもカーソルが外れない(スマホでキーボードが閉じない)ようにする
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', (e) => {
        e.preventDefault()
        const pos = getPos()
        if (pos === undefined || !view.editable) return
        const tr = view.state.tr
        hooks?.closeGroup()
        if (fn(tr, pos)) view.dispatch(tr)
        hooks?.closeGroup()
      })
      this.dom.appendChild(b)
      return b
    }
    this.buttons = [
      make('table-add--col', '列を足す', appendColumn),
      make('table-add--row', '行を足す', appendRow),
    ]
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    return true
  }

  /** ボタンでの操作はエディタに処理させない */
  stopEvent(event: Event): boolean {
    return this.buttons.some((b) => b.contains(event.target as Node))
  }

  /** 表の中身以外(ボタン)の変化は、エディタの文章の変化として扱わない */
  ignoreMutation(m: ViewMutationRecord): boolean {
    if (m.type === 'selection') return false
    return !this.contentDOM.contains(m.target)
  }
}

/** 長押しとみなす時間(ミリ秒)・指がこれ以上動いたら長押しにしない(px) */
const LONG_PRESS_MS = 500
const MOVE_TOLERANCE = 10

/** セルの長押し・右クリックでメニューの合図を送る */
function cellMenuPlugin(editor: () => Editor) {
  const cellPosAt = (view: EditorView, target: EventTarget | null): number | null => {
    const el = (target as HTMLElement | null)?.closest?.('td, th')
    if (!el || !view.dom.contains(el)) return null
    try {
      const pos = view.posAtDOM(el, 0)
      const $pos = view.state.doc.resolve(pos)
      for (let d = $pos.depth; d > 0; d--) {
        const n = $pos.node(d)
        if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') return $pos.before(d)
      }
    } catch {
      // 位置が分からない所は無視する
    }
    return null
  }
  const open = (view: EditorView, cellPos: number, x: number, y: number) => {
    if (!view.editable) return
    window.dispatchEvent(
      new CustomEvent<CellMenuDetail>(CELL_MENU_EVENT, { detail: { editor: editor(), cellPos, x, y } }),
    )
  }
  let timer: ReturnType<typeof setTimeout> | null = null
  let start: { x: number; y: number } | null = null
  /** 長押しでメニューを出した(指を離したときのタップを、メニューに届かせない) */
  let fired = false
  const cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    start = null
  }
  return new Plugin({
    props: {
      handleDOMEvents: {
        contextmenu: (view, event) => {
          const pos = cellPosAt(view, event.target)
          if (pos === null) return false
          event.preventDefault()
          cancel()
          open(view, pos, event.clientX, event.clientY)
          return true
        },
        touchstart: (view, event) => {
          cancel()
          fired = false
          const t = event.touches[0]
          const pos = cellPosAt(view, event.target)
          if (pos === null || !t || event.touches.length > 1) return false
          start = { x: t.clientX, y: t.clientY }
          timer = setTimeout(() => {
            const p = start
            cancel()
            if (p) {
              fired = true
              open(view, pos, p.x, p.y)
            }
          }, LONG_PRESS_MS)
          return false
        },
        touchmove: (_view, event) => {
          const t = event.touches[0]
          if (start && t && Math.hypot(t.clientX - start.x, t.clientY - start.y) > MOVE_TOLERANCE) cancel()
          return false
        },
        touchend: (_view, event) => {
          cancel()
          if (fired) {
            // 指を離したときのタップで、出したメニューがすぐ閉じないようにする
            fired = false
            event.preventDefault()
            return true
          }
          return false
        },
        touchcancel: () => {
          cancel()
          return false
        },
      },
    },
  })
}

/** 表(本体)。hooks:「＋」を押したときに入力の区切りを入れる */
export const MekuriTable = Table.extend<{ hooks: TableHooks | null } & Record<string, unknown>>({
  addOptions() {
    return { ...this.parent!(), resizable: false, hooks: null }
  },
  addNodeView() {
    const hooks = this.options.hooks as TableHooks | null
    return ({ node, view, getPos }) => new TableBlockView(node, view, getPos as () => number | undefined, hooks)
  },
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), cellMenuPlugin(() => this.editor)]
  },
})

/** 新しい表(3行×3列・見出し行なし)を入れる */
export function insertTable(editor: Editor) {
  editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: false }).run()
}

/** カーソルが表の中にあるか */
export const isInTable = (editor: Editor) => editor.isActive('table')
