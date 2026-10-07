import type { Editor, JSONContent } from '@tiptap/core'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { Slice, type Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { CellSelection, TableMap, addColumn, addRow, cellAround } from '@tiptap/pm/tables'
import { Decoration, DecorationSet, type EditorView, type NodeView, type ViewMutationRecord } from '@tiptap/pm/view'
import { showToast } from '../components/Toast'
import { isMarkerColor, type MarkerColorName } from './palette'
import { upgradeTablesToV6 } from './tableMigrate'
import { MIN_COL_WIDTH, columnWidths, moveLine, selectCells, selectLine, setColumnWidth, tablePosOfCell, type Axis } from './tableOps'

/**
 * 表。
 * - セルの中は段落と文字の装飾だけ(表の中に表・見出し・リストは入れない)
 * - セルの背景色は、マーカーと同じ色名で保存する(bg)。文字の配置は align、列の幅は colwidth、結合は colspan・rowspan
 * - 見出しは表の設定 headerRow(1行目)・headerColumn(1列目)で持つ(v6〜。tableMigrate.ts)
 * - 表の右端と下端に常に「＋」を出し、押すと列・行が最後に増える
 * - 行の左・列の上に「つまみ」を出す。押すとメニュー(TABLE_MENU_EVENT)、ドラッグで並び替え
 * - 列の境目をドラッグすると列の幅が変わる
 * - スマホでは、選んだセルの右下の丸いつまみを引っぱって、範囲を選ぶ
 * - PC はセルの右クリックでもメニューを出す
 */

/** 表のメニューを出すときに送る合図(ノート画面の TableMenu が受け取る) */
export const TABLE_MENU_EVENT = 'mekuri:table-menu'
/** 以前の名前(ツールバーから使う) */
export const CELL_MENU_EVENT = TABLE_MENU_EVENT

export interface TableMenuDetail {
  editor: Editor
  /** row・col:つまみから(その行・列)、cell:右クリック・ツールバーの「表」ボタン・範囲選択のあと(選んだセル) */
  kind: Axis | 'cell'
  /** 表の位置 */
  tablePos: number
  /** 行・列の番号(kind が row・col のとき) */
  index: number
  /** セルの位置(kind が cell のとき。選んでいる範囲の外のセルなら、そのセルにカーソルを移す) */
  cellPos: number | null
  x: number
  y: number
}
export type CellMenuDetail = TableMenuDetail

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

/**
 * 見出しセル。このアプリでは作らない(見出しは表の設定で持つ)。
 * ほかのアプリから貼り付けた表を読むための入口で、貼り付けるときに普通のセルに変える(pastePlugin)
 */
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

/** カーソルをセルの中に置く */
export function selectCell(editor: Editor, cellPos: number) {
  const { state } = editor
  const $pos = state.doc.resolve(Math.min(cellPos + 2, state.doc.content.size))
  editor.view.dispatch(state.tr.setSelection(TextSelection.near($pos)))
}

/** 操作の前後で、入力の「元に戻す」を区切るための関数(ページのエディタからもらう) */
export interface TableHooks {
  closeGroup: () => void
}

/** 範囲選択・カーソルの「先頭側のセル」(丸いつまみを出すセル)の位置 */
function headCellPos(state: EditorState): number | null {
  const sel = state.selection
  if (sel instanceof CellSelection) return sel.$headCell.pos
  return cellAround(sel.$head)?.pos ?? null
}
function anchorCellPos(state: EditorState): number | null {
  const sel = state.selection
  if (sel instanceof CellSelection) return sel.$anchorCell.pos
  return cellAround(sel.$anchor)?.pos ?? null
}

/** つまみを押してから、ドラッグとみなすまでの動き(px) */
const DRAG_START = 6

/** エディタごとの、画面に出ている表の一覧(選択が変わったときに、つまみの位置を合わせ直すため) */
const liveViews = new WeakMap<EditorView, Set<TableBlockView>>()

/**
 * 表の見た目。
 * 左の列に行のつまみ、横スクロールする枠の中に 列のつまみ・表・列の幅を変える線・丸いつまみ を置く。
 * つまみやボタンはエディタの文章の外(contenteditable=false)に置き、押した操作をエディタに渡さない
 */
class TableBlockView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private table: HTMLTableElement
  private colgroup: HTMLElement
  private inner: HTMLElement
  private rowGrips: HTMLElement
  private colGrips: HTMLElement
  private resizers: HTMLElement
  private knob: HTMLElement
  private indicator: HTMLElement
  private controls: HTMLElement[]
  private frame = 0
  private ro: ResizeObserver | null = null
  /** 列の境目(内側の枠の左からの px)。layout() で測る */
  private colEdges: number[] = []
  /** 行の境目(行のつまみの枠の上からの px) */
  private rowEdges: number[] = []
  /** ドラッグ中(並び替え・幅・範囲)は、位置の測り直しで要素を動かさない */
  private busy = false

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private hooks: TableHooks | null,
  ) {
    const el = (tag: string, cls: string) => {
      const e = document.createElement(tag)
      e.className = cls
      return e
    }
    this.dom = el('div', 'table-block')
    this.rowGrips = el('div', 'table-rowgrips')
    this.rowGrips.contentEditable = 'false'
    const scroll = el('div', 'table-scroll')
    this.inner = el('div', 'table-inner')
    this.colGrips = el('div', 'table-colgrips')
    this.colGrips.contentEditable = 'false'
    this.table = document.createElement('table')
    this.colgroup = document.createElement('colgroup')
    this.contentDOM = document.createElement('tbody')
    this.table.append(this.colgroup, this.contentDOM)
    this.resizers = el('div', 'table-resizers')
    this.resizers.contentEditable = 'false'
    this.knob = el('div', 'table-knob')
    this.knob.contentEditable = 'false'
    this.knob.setAttribute('aria-hidden', 'true')
    this.indicator = el('div', 'table-drop')
    this.indicator.hidden = true
    this.inner.append(this.colGrips, this.table, this.resizers, this.knob, this.indicator)
    scroll.appendChild(this.inner)
    this.dom.append(this.rowGrips, scroll)

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
        const pos = this.getPos()
        if (pos === undefined || !this.view.editable) return
        const tr = this.view.state.tr
        this.hooks?.closeGroup()
        if (fn(tr, pos)) this.view.dispatch(tr)
        this.hooks?.closeGroup()
      })
      this.dom.appendChild(b)
      return b
    }
    const addCol = make('table-add--col', '列を足す', appendColumn)
    const addRowBtn = make('table-add--row', '行を足す', appendRow)
    this.controls = [this.rowGrips, this.colGrips, this.resizers, this.knob, addCol, addRowBtn]

    this.knob.addEventListener('pointerdown', (e) => this.startRangeDrag(e))

    this.syncEditable()
    // 読むだけのエディタ(印刷)は、作ったあとで「編集できない」になるので、もう一度合わせる
    queueMicrotask(() => this.syncEditable())
    let set = liveViews.get(view)
    if (!set) liveViews.set(view, (set = new Set()))
    set.add(this)
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.schedule())
      this.ro.observe(this.table)
    }
    this.schedule()
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.renderNode()
    this.schedule()
    return true
  }

  destroy() {
    cancelAnimationFrame(this.frame)
    this.ro?.disconnect()
    liveViews.get(this.view)?.delete(this)
  }

  /** つまみ・ボタンでの操作はエディタに処理させない */
  stopEvent(event: Event): boolean {
    return this.controls.some((c) => c.contains(event.target as Node))
  }

  /** 表の中身以外(つまみ・列の幅など)の変化は、エディタの文章の変化として扱わない */
  ignoreMutation(m: ViewMutationRecord): boolean {
    if (m.type === 'selection') return false
    return !this.contentDOM.contains(m.target)
  }

  /** エディタの表示が変わったとき(選択の変化など)に呼ばれる */
  viewUpdated() {
    this.syncEditable()
    this.schedule()
  }

  /** 編集できるか(読むだけの表示か)が変わったら、見た目を合わせ直す */
  private readonly: boolean | null = null
  private syncEditable() {
    const ro = !this.view.editable
    if (ro === this.readonly) return
    this.readonly = ro
    this.dom.classList.toggle('is-readonly', ro)
    this.renderNode()
  }

  // ---- 見た目 ----

  /** 表の設定(見出し・列の幅)を見た目に移す */
  private renderNode() {
    const node = this.node
    this.table.classList.toggle('has-header-row', !!node.attrs.headerRow)
    this.table.classList.toggle('has-header-col', !!node.attrs.headerColumn)
    const map = TableMap.get(node)
    const widths = columnWidths({ node, pos: 0, start: 1, map })
    this.applyWidths(widths)
  }

  /**
   * 列の幅を colgroup に書く(全部の列に幅があれば、表の幅も決める)。
   * 読むだけの表示(印刷・PDF)では、列の幅を合計に対する割合にし、表の幅を「紙の幅と合計の小さいほう」にする。
   * 紙より広い表は、比率を保って紙の幅に収まる(印刷の紙は画面に出ていない間に描くので、測らずに CSS で決める)
   */
  private applyWidths(widths: (number | null)[]) {
    while (this.colgroup.children.length > widths.length) this.colgroup.lastElementChild!.remove()
    while (this.colgroup.children.length < widths.length) this.colgroup.appendChild(document.createElement('col'))
    const fixed = widths.length > 0 && widths.every((w) => !!w)
    const total = widths.reduce<number>((s, w) => s + (w ?? 0), 0)
    const fit = fixed && !this.view.editable
    widths.forEach((w, i) => {
      const col = this.colgroup.children[i] as HTMLElement
      col.style.width = !w ? '' : fit ? `${((w / total) * 100).toFixed(4)}%` : `${w}px`
    })
    this.table.classList.toggle('is-fixed', fixed)
    this.table.style.width = fixed ? (fit ? `min(100%, ${total}px)` : `${total}px`) : ''
  }

  private schedule() {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.layout()
    })
  }

  /** 今の選択が、この表の中にあるか */
  private isActive(): boolean {
    const pos = this.getPos()
    if (pos === undefined) return false
    const { from, to } = this.view.state.selection
    return from > pos && to < pos + this.node.nodeSize
  }

  /** つまみ・幅の線・丸いつまみを、表の今の行・列に合わせて置き直す */
  private layout() {
    if (!this.dom.isConnected) return
    // 読むだけの表示(印刷・PDF)では、つまみは出さない
    if (!this.view.editable) return
    const active = this.view.editable && this.isActive()
    this.dom.classList.toggle('is-active', active)
    const pos = this.getPos()
    if (this.busy || pos === undefined) return
    const map = TableMap.get(this.node)
    const innerRect = this.inner.getBoundingClientRect()
    const gripsRect = this.rowGrips.getBoundingClientRect()
    const tableRect = this.table.getBoundingClientRect()

    // 行の境目(<tr> の位置)
    const rows = Array.from(this.contentDOM.children) as HTMLElement[]
    this.rowEdges = [0]
    rows.forEach((tr, i) => {
      const r = tr.getBoundingClientRect()
      if (i === 0) this.rowEdges[0] = r.top - gripsRect.top
      this.rowEdges.push(r.bottom - gripsRect.top)
    })

    // 列の境目:その列から始まるセル・その列で終わるセルの位置から測る
    const edges: (number | null)[] = Array(map.width + 1).fill(null)
    const seen = new Set<number>()
    for (const rel of map.map) {
      if (seen.has(rel)) continue
      seen.add(rel)
      const dom = this.view.nodeDOM(pos + 1 + rel)
      if (!(dom instanceof HTMLElement)) continue
      const rect = map.findCell(rel)
      const r = dom.getBoundingClientRect()
      if (edges[rect.left] === null) edges[rect.left] = r.left - innerRect.left
      if (edges[rect.right] === null) edges[rect.right] = r.right - innerRect.left
    }
    // 測れなかった境目は、前後から等分して埋める
    const left0 = tableRect.left - innerRect.left
    edges[0] ??= left0
    edges[map.width] ??= tableRect.right - innerRect.left
    for (let i = 1; i < map.width; i++) {
      if (edges[i] !== null) continue
      let j = i
      while (edges[j] === null) j++
      edges[i] = edges[i - 1]! + (edges[j]! - edges[i - 1]!) / (j - i + 1)
    }
    this.colEdges = edges as number[]

    this.syncList(this.rowGrips, map.height, 'table-grip table-grip--row', (b, i) => {
      b.style.top = `${this.rowEdges[i]}px`
      b.style.height = `${this.rowEdges[i + 1] - this.rowEdges[i]}px`
      b.setAttribute('aria-label', `${i + 1}行目のメニュー(ドラッグで移動)`)
    }, (b, i) => this.bindGrip(b, 'row', i))
    this.syncList(this.colGrips, map.width, 'table-grip table-grip--col', (b, i) => {
      b.style.left = `${this.colEdges[i]}px`
      b.style.width = `${this.colEdges[i + 1] - this.colEdges[i]}px`
      b.setAttribute('aria-label', `${i + 1}列目のメニュー(ドラッグで移動)`)
    }, (b, i) => this.bindGrip(b, 'col', i))
    const top = tableRect.top - innerRect.top
    this.syncList(this.resizers, map.width, 'table-resizer', (b, i) => {
      b.style.left = `${this.colEdges[i + 1]}px`
      b.style.top = `${top}px`
      b.style.height = `${tableRect.height}px`
    }, (b, i) => b.addEventListener('pointerdown', (e) => this.startResize(e, i)))

    // 選んでいる行・列(つまみで選んだとき・範囲で行や列をまるごと選んだとき)のつまみに色を付ける
    const sel = this.view.state.selection
    const picked: Record<Axis, Set<number>> = { row: new Set(), col: new Set() }
    if (active && sel instanceof CellSelection) {
      const r = map.rectBetween(sel.$anchorCell.pos - pos - 1, sel.$headCell.pos - pos - 1)
      if (sel.isRowSelection()) for (let i = r.top; i < r.bottom; i++) picked.row.add(i)
      if (sel.isColSelection()) for (let i = r.left; i < r.right; i++) picked.col.add(i)
    }
    Array.from(this.rowGrips.children).forEach((g, i) => g.classList.toggle('is-selected', picked.row.has(i)))
    Array.from(this.colGrips.children).forEach((g, i) => g.classList.toggle('is-selected', picked.col.has(i)))

    // 丸いつまみ:選んでいるセル(範囲なら先頭側)の右下
    const head = active ? headCellPos(this.view.state) : null
    const headDom = head !== null ? this.view.nodeDOM(head) : null
    if (headDom instanceof HTMLElement) {
      const r = headDom.getBoundingClientRect()
      this.knob.style.left = `${r.right - innerRect.left}px`
      this.knob.style.top = `${r.bottom - innerRect.top}px`
      this.knob.hidden = false
    } else {
      this.knob.hidden = true
    }
  }

  /** 要素の数を n にそろえ、それぞれの位置を place で決める(新しく作った要素には bind で操作を付ける) */
  private syncList(
    parent: HTMLElement,
    n: number,
    cls: string,
    place: (el: HTMLElement, i: number) => void,
    bind: (el: HTMLElement, i: number) => void,
  ) {
    while (parent.children.length > n) parent.lastElementChild!.remove()
    while (parent.children.length < n) {
      const b = document.createElement('div')
      b.className = cls
      b.setAttribute('role', 'button')
      const i = parent.children.length
      b.dataset.index = String(i)
      bind(b, i)
      parent.appendChild(b)
    }
    Array.from(parent.children).forEach((c, i) => place(c as HTMLElement, i))
  }

  // ---- 行・列のつまみ:押すとメニュー、ドラッグで並び替え ----

  private bindGrip(el: HTMLElement, axis: Axis, i: number) {
    el.addEventListener('pointerdown', (e) => this.startGrip(e, axis, i))
    // PC の右クリックでも同じメニュー
    el.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  private startGrip(e: PointerEvent, axis: Axis, index: number) {
    if (!this.view.editable || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.preventDefault()
    e.stopPropagation()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture?.(e.pointerId)
    const sx = e.clientX
    const sy = e.clientY
    let dragging = false
    let drop: number | null = null
    const gripsRect = this.rowGrips.getBoundingClientRect()
    const innerRect = this.inner.getBoundingClientRect()

    /** 指の位置に一番近い境目(0〜行・列の数) */
    const boundaryAt = (x: number, y: number) => {
      const edges = axis === 'row' ? this.rowEdges : this.colEdges
      const v = axis === 'row' ? y - gripsRect.top : x - innerRect.left
      let best = 0
      edges.forEach((ed, i) => {
        if (Math.abs(ed - v) < Math.abs(edges[best] - v)) best = i
      })
      return best
    }
    const showDrop = (b: number) => {
      const ind = this.indicator
      ind.hidden = false
      ind.className = `table-drop table-drop--${axis}`
      const tableRect = this.table.getBoundingClientRect()
      if (axis === 'row') {
        ind.style.left = `${tableRect.left - innerRect.left}px`
        ind.style.width = `${tableRect.width}px`
        ind.style.top = `${this.rowEdges[b] - (innerRect.top - gripsRect.top)}px`
        ind.style.height = ''
      } else {
        ind.style.top = `${tableRect.top - innerRect.top}px`
        ind.style.height = `${tableRect.height}px`
        ind.style.left = `${this.colEdges[b]}px`
        ind.style.width = ''
      }
    }

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_START) return
      ev.preventDefault()
      if (!dragging) {
        dragging = true
        this.busy = true
        this.dom.classList.add('is-moving')
        target.classList.add('is-dragging')
      }
      drop = boundaryAt(ev.clientX, ev.clientY)
      showDrop(drop)
    }
    const finish = (ev: PointerEvent, cancelled: boolean) => {
      if (ev.pointerId !== e.pointerId) return
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onCancel)
      this.indicator.hidden = true
      this.dom.classList.remove('is-moving')
      target.classList.remove('is-dragging')
      this.busy = false
      const pos = this.getPos()
      if (cancelled || pos === undefined) return this.schedule()
      if (dragging) {
        if (drop !== null) {
          // 境目 drop へ動かす。下(右)へ動かすときは、自分が抜けた分だけ番号が1つ減る
          const to = drop > index ? drop - 1 : drop
          if (to !== index) {
            this.hooks?.closeGroup()
            const moved = moveLine(pos, axis, index, to)(this.view.state, this.view.dispatch)
            this.hooks?.closeGroup()
            // 動かせなかった(結合したセルのまとまりの中へ動かそうとした)ときは、短く知らせる
            if (!moved) showToast('結合したセルの中には移動できません')
          }
        }
        this.schedule()
        return
      }
      // 押しただけ:その行(列)を選んで、メニューを出す
      const tr = this.view.state.tr
      if (selectLine(tr, pos, axis, index)) this.view.dispatch(tr)
      const r = target.getBoundingClientRect()
      openTableMenu({
        editor: editorOf(this.view),
        kind: axis,
        tablePos: pos,
        index,
        cellPos: null,
        x: axis === 'row' ? r.right : r.left,
        y: axis === 'row' ? r.top : r.bottom,
      })
    }
    const onUp = (ev: PointerEvent) => finish(ev, false)
    const onCancel = (ev: PointerEvent) => finish(ev, true)
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onCancel)
  }

  // ---- 列の幅 ----

  private startResize(e: PointerEvent, col: number) {
    if (!this.view.editable || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.preventDefault()
    e.stopPropagation()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture?.(e.pointerId)
    const measured = this.colEdges.slice(1).map((ed, i) => ed - this.colEdges[i])
    const start = measured[col]
    const sx = e.clientX
    let width = start
    this.busy = true
    target.classList.add('is-dragging')
    this.dom.classList.add('is-resizing')
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      ev.preventDefault()
      width = Math.max(MIN_COL_WIDTH, start + ev.clientX - sx)
      // ドラッグ中は見た目だけ変える(保存は離したときに1回だけ)
      const preview = measured.map((w, i) => (i === col ? width : w))
      this.applyWidths(preview)
      target.style.left = `${this.colEdges[col] + width}px`
    }
    const finish = (ev: PointerEvent, cancelled: boolean) => {
      if (ev.pointerId !== e.pointerId) return
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onCancel)
      target.classList.remove('is-dragging')
      this.dom.classList.remove('is-resizing')
      this.busy = false
      const pos = this.getPos()
      if (!cancelled && pos !== undefined && Math.abs(width - start) >= 1) {
        this.hooks?.closeGroup()
        setColumnWidth(pos, col, width, measured)(this.view.state, this.view.dispatch)
        this.hooks?.closeGroup()
      } else {
        this.renderNode()
      }
      this.schedule()
    }
    const onUp = (ev: PointerEvent) => finish(ev, false)
    const onCancel = (ev: PointerEvent) => finish(ev, true)
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onCancel)
  }

  // ---- 丸いつまみで範囲を選ぶ(スマホ) ----

  private startRangeDrag(e: PointerEvent) {
    if (!this.view.editable) return
    e.preventDefault()
    e.stopPropagation()
    const anchor = anchorCellPos(this.view.state)
    if (anchor === null) return
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture?.(e.pointerId)
    this.dom.classList.add('is-ranging')
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      ev.preventDefault()
      const head = this.cellAtPoint(ev.clientX, ev.clientY)
      if (head === null) return
      const tr = this.view.state.tr
      if (selectCells(tr, anchor, head)) this.view.dispatch(tr)
      // 選んだ範囲に合わせて、つまみを指の下に置き直す
      this.layout()
    }
    const finish = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', finish)
      target.removeEventListener('pointercancel', finish)
      this.dom.classList.remove('is-ranging')
      const pos = this.getPos()
      // 2つ以上のセルを選んだら、まとめて操作するメニューを出す
      const sel = this.view.state.selection
      if (pos !== undefined && sel instanceof CellSelection && sel.$anchorCell.pos !== sel.$headCell.pos) {
        const r = this.knob.getBoundingClientRect()
        openTableMenu({
          editor: editorOf(this.view),
          kind: 'cell',
          tablePos: pos,
          index: 0,
          cellPos: null,
          x: r.left,
          y: r.bottom,
        })
      }
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', finish)
    target.addEventListener('pointercancel', finish)
  }

  /** 画面上の点の下にある、この表のセルの位置 */
  private cellAtPoint(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y)?.closest('td, th')
    if (!el || !this.contentDOM.contains(el)) return null
    try {
      const $pos = this.view.state.doc.resolve(this.view.posAtDOM(el, 0))
      return cellAround($pos)?.pos ?? null
    } catch {
      return null
    }
  }
}

/** ノードビューからエディタ(TipTap)を引く */
const editors = new WeakMap<EditorView, Editor>()
const editorOf = (view: EditorView) => editors.get(view)!

function openTableMenu(detail: TableMenuDetail) {
  if (!detail.editor) return
  window.dispatchEvent(new CustomEvent<TableMenuDetail>(TABLE_MENU_EVENT, { detail }))
}

/** 見出しの行・列にあたるセルに、見出しの見た目(is-head)を付ける */
function headerDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.spec.tableRole !== 'table') return true
    const { headerRow, headerColumn } = node.attrs
    if (headerRow || headerColumn) {
      const map = TableMap.get(node)
      const seen = new Set<number>()
      map.map.forEach((rel) => {
        if (seen.has(rel)) return
        seen.add(rel)
        const rect = map.findCell(rel)
        if ((headerRow && rect.top === 0) || (headerColumn && rect.left === 0)) {
          const cell = node.nodeAt(rel)!
          decos.push(Decoration.node(pos + 1 + rel, pos + 1 + rel + cell.nodeSize, { class: 'is-head' }))
        }
      })
    }
    return false
  })
  return DecorationSet.create(doc, decos)
}

const headerKey = new PluginKey<DecorationSet>('mekuriTableHeader')

/** 表のつまみの位置合わせ・見出しの見た目・右クリックのメニュー・貼り付けた見出しセルの変換 */
function tablePlugin(editor: () => Editor) {
  return new Plugin<DecorationSet>({
    key: headerKey,
    state: {
      init: (_c, state) => headerDecorations(state.doc),
      apply: (tr, old) => (tr.docChanged ? headerDecorations(tr.doc) : old),
    },
    view: (view) => {
      editors.set(view, editor())
      return {
        update: (v) => {
          editors.set(v, editor())
          liveViews.get(v)?.forEach((tv) => tv.viewUpdated())
        },
      }
    },
    props: {
      decorations: (state) => headerKey.getState(state),
      handleDOMEvents: {
        // PC の右クリック:セルのメニュー
        contextmenu: (view, event) => {
          if (!view.editable) return false
          const el = (event.target as HTMLElement | null)?.closest?.('td, th')
          if (!el || !view.dom.contains(el)) return false
          let cellPos: number | null = null
          try {
            cellPos = cellAround(view.state.doc.resolve(view.posAtDOM(el, 0)))?.pos ?? null
          } catch {
            cellPos = null
          }
          if (cellPos === null) return false
          const tablePos = tablePosOfCell(view.state.doc, cellPos)
          if (tablePos === null) return false
          event.preventDefault()
          openTableMenu({
            editor: editor(),
            kind: 'cell',
            tablePos,
            index: 0,
            cellPos,
            x: event.clientX,
            y: event.clientY,
          })
          return true
        },
      },
      // ほかのアプリから貼り付けた表の見出しセルを、普通のセル+表の見出しの設定にする
      transformPasted: (slice, view) => normalizePastedSlice(slice, view.state.schema),
    },
  })
}

/** 貼り付けた中身の表を v6 の形にする(見出しセルは普通のセルへ) */
export function normalizePastedSlice(slice: Slice, schema: EditorState['schema']): Slice {
  let hasTable = false
  slice.content.descendants((n) => {
    if (n.type.spec.tableRole) hasTable = true
    return !hasTable
  })
  if (!hasTable) return slice
  const json = slice.toJSON() as { content?: JSONContent[]; openStart?: number; openEnd?: number } | null
  if (!json?.content) return slice
  const upgraded = upgradeTablesToV6({ content: json.content }).content ?? json.content
  // 表の外(セルだけを貼り付けたとき)の見出しセルも、普通のセルにする
  const plain = (n: JSONContent): JSONContent => ({
    ...n,
    type: n.type === 'tableHeader' ? 'tableCell' : n.type,
    ...(n.content ? { content: n.content.map(plain) } : {}),
  })
  try {
    return Slice.fromJSON(schema, { ...json, content: upgraded.map(plain) })
  } catch {
    return slice
  }
}

/** 表(本体)。hooks:操作の前後に入力の区切りを入れる */
export const MekuriTable = Table.extend<{ hooks: TableHooks | null } & Record<string, unknown>>({
  addOptions() {
    return { ...this.parent!(), resizable: false, hooks: null }
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      headerRow: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-header-row') === 'true',
        renderHTML: (attrs: { headerRow?: boolean }) => (attrs.headerRow ? { 'data-header-row': 'true' } : {}),
      },
      headerColumn: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-header-column') === 'true',
        renderHTML: (attrs: { headerColumn?: boolean }) => (attrs.headerColumn ? { 'data-header-column': 'true' } : {}),
      },
    }
  },
  addNodeView() {
    const hooks = this.options.hooks as TableHooks | null
    return ({ node, view, getPos }) => new TableBlockView(node, view, getPos as () => number | undefined, hooks)
  },
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), tablePlugin(() => this.editor)]
  },
})

/** 新しい表(3行×3列・見出しなし)を入れる */
export function insertTable(editor: Editor) {
  editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: false }).run()
}

/** カーソルが表の中にあるか */
export const isInTable = (editor: Editor) => editor.isActive('table')
