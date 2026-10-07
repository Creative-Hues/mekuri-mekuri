import type { Node as PMNode } from '@tiptap/pm/model'
import { Selection, TextSelection, type Command, type EditorState, type Transaction } from '@tiptap/pm/state'
import {
  CellSelection,
  TableMap,
  addColumn,
  addRow,
  cellAround,
  mergeCells,
  moveTableColumn,
  moveTableRow,
  removeColumn,
  removeRow,
  splitCell,
  type Rect,
  type TableRect,
} from '@tiptap/pm/tables'
import type { MarkerColorName } from './palette'

/**
 * 表の操作(行・列のつまみのメニュー・セルのメニュー・列の幅など)。
 * どれも ProseMirror のコマンドの形 (state, dispatch) => できたか にしてあり、
 * 1回の操作が1回の変更(=1回の「元に戻す」)になる。画面のない所でもテストできるよう、ここにまとめる。
 *
 * tablePos は表のノードの位置(表の直前)。行・列の番号は 0 から(結合したセルも1マスずつ数える)。
 */

export type Axis = 'row' | 'col'
export type CellAlign = 'left' | 'center' | 'right'

/** 列の幅の最小(px) */
export const MIN_COL_WIDTH = 48

interface TableAt {
  node: PMNode
  pos: number
  /** 表の中身の始まり(最初の行の直前) */
  start: number
  map: TableMap
}

export function tableAt(doc: PMNode, tablePos: number): TableAt | null {
  const node = doc.nodeAt(tablePos)
  if (!node || node.type.spec.tableRole !== 'table') return null
  return { node, pos: tablePos, start: tablePos + 1, map: TableMap.get(node) }
}

const rectOf = (t: TableAt, r: Partial<Rect> = {}): TableRect => ({
  map: t.map,
  table: t.node,
  tableStart: t.start,
  left: 0,
  top: 0,
  right: t.map.width,
  bottom: t.map.height,
  ...r,
})

/** 行・列の数 */
export const lineCount = (t: TableAt, axis: Axis) => (axis === 'row' ? t.map.height : t.map.width)

/** カーソルや選択のある表(なければ null) */
export function tableOfSelection(state: EditorState): TableAt | null {
  const $from = state.selection.$from
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.spec.tableRole === 'table') return tableAt(state.doc, $from.before(d))
  }
  return null
}

/** セルの位置(セルのノードの直前)から、そのセルのある表の位置 */
export function tablePosOfCell(doc: PMNode, cellPos: number): number | null {
  const $cell = doc.resolve(cellPos)
  for (let d = $cell.depth; d > 0; d--) {
    if ($cell.node(d).type.spec.tableRole === 'table') return $cell.before(d)
  }
  return null
}

// ---- 選ぶ ----

/** 行・列をまるごと選んだ状態にする(つまみを押したとき) */
export function selectLine(tr: Transaction, tablePos: number, axis: Axis, index: number): boolean {
  const t = tableAt(tr.doc, tablePos)
  if (!t || index < 0 || index >= lineCount(t, axis)) return false
  const first = axis === 'row' ? t.map.positionAt(index, 0, t.node) : t.map.positionAt(0, index, t.node)
  const last =
    axis === 'row'
      ? t.map.positionAt(index, t.map.width - 1, t.node)
      : t.map.positionAt(t.map.height - 1, index, t.node)
  const $a = tr.doc.resolve(t.start + first)
  const $b = tr.doc.resolve(t.start + last)
  tr.setSelection(axis === 'row' ? CellSelection.rowSelection($a, $b) : CellSelection.colSelection($a, $b))
  return true
}

/** 2つのセルの間を範囲で選ぶ(丸いつまみ・なぞり) */
export function selectCells(tr: Transaction, anchorCellPos: number, headCellPos: number): boolean {
  try {
    tr.setSelection(CellSelection.create(tr.doc, anchorCellPos, headCellPos))
    return true
  } catch {
    return false
  }
}

/** 選んでいるセル(範囲選択ならその中のすべて、カーソルならそのセル)の位置 */
export function selectedCellPositions(state: EditorState): number[] {
  const sel = state.selection
  if (sel instanceof CellSelection) {
    const out: number[] = []
    sel.forEachCell((_n, pos) => out.push(pos))
    return out
  }
  const $cell = cellAround(sel.$from)
  return $cell ? [$cell.pos] : []
}

/** 範囲選択で、選んでいる行・列の範囲(表の中の番号) */
export function selectedRectIn(state: EditorState): (Rect & { tablePos: number }) | null {
  const sel = state.selection
  const cells = selectedCellPositions(state)
  if (cells.length === 0) return null
  const tablePos = tablePosOfCell(state.doc, cells[0])
  if (tablePos === null) return null
  const t = tableAt(state.doc, tablePos)!
  if (sel instanceof CellSelection) {
    return { tablePos, ...t.map.rectBetween(sel.$anchorCell.pos - t.start, sel.$headCell.pos - t.start) }
  }
  return { tablePos, ...t.map.findCell(cells[0] - t.start) }
}

// ---- 行・列の挿入・複製・削除・並び替え ----

/** index の行(列)の前か後ろに、空の行(列)を入れる */
export function insertLine(tablePos: number, axis: Axis, index: number, side: 'before' | 'after'): Command {
  return (state, dispatch) => {
    const t = tableAt(state.doc, tablePos)
    if (!t || index < 0 || index >= lineCount(t, axis)) return false
    if (dispatch) {
      const tr = state.tr
      const at = side === 'before' ? index : index + 1
      if (axis === 'row') addRow(tr, rectOf(t), at)
      else addColumn(tr, rectOf(t), at)
      // 入れた行(列)の最初のセルにカーソルを置く
      const nt = tableAt(tr.doc, tablePos)
      if (nt) placeCursorIn(tr, nt, axis === 'row' ? at : 0, axis === 'row' ? 0 : at)
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/** 行(列)が、結合したセルにまたがっていないか(複製できるか) */
export function lineIsSimple(t: TableAt, axis: Axis, index: number): boolean {
  const n = axis === 'row' ? t.map.width : t.map.height
  for (let i = 0; i < n; i++) {
    const at = axis === 'row' ? index * t.map.width + i : i * t.map.width + index
    const rect = t.map.findCell(t.map.map[at])
    if (axis === 'row' ? rect.top !== index || rect.bottom !== index + 1 : rect.left !== index || rect.right !== index + 1) {
      return false
    }
  }
  return true
}

/** index の行(列)を、中身ごとすぐ後ろに複製する(結合したセルにまたがる行・列はできない) */
export function duplicateLine(tablePos: number, axis: Axis, index: number): Command {
  return (state, dispatch) => {
    const t = tableAt(state.doc, tablePos)
    if (!t || index < 0 || index >= lineCount(t, axis) || !lineIsSimple(t, axis, index)) return false
    if (dispatch) {
      const tr = state.tr
      if (axis === 'row') {
        let rowPos = t.start
        for (let i = 0; i < index; i++) rowPos += t.node.child(i).nodeSize
        const row = t.node.child(index)
        tr.insert(rowPos + row.nodeSize, row.copy(row.content))
      } else {
        // 列のセルを1つずつ、そのすぐ後ろに複製する(後ろから入れて位置がずれないようにする)
        const cells = new Set<number>()
        for (let r = 0; r < t.map.height; r++) cells.add(t.map.map[r * t.map.width + index])
        for (const rel of [...cells].sort((a, b) => b - a)) {
          const cell = t.node.nodeAt(rel)!
          tr.insert(t.start + rel + cell.nodeSize, cell.copy(cell.content))
        }
      }
      const nt = tableAt(tr.doc, tablePos)
      if (nt) selectLine(tr, tablePos, axis, index + 1)
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/** index の行(列)を消す。最後の1行(1列)は消さない(表ごと消すのは「表を削除」) */
export function deleteLine(tablePos: number, axis: Axis, index: number): Command {
  return (state, dispatch) => {
    const t = tableAt(state.doc, tablePos)
    if (!t || index < 0 || index >= lineCount(t, axis) || lineCount(t, axis) <= 1) return false
    if (dispatch) {
      const tr = state.tr
      if (axis === 'row') removeRow(tr, rectOf(t), index)
      else removeColumn(tr, rectOf(t), index)
      const nt = tableAt(tr.doc, tablePos)
      if (nt) {
        const last = lineCount(nt, axis) - 1
        const i = Math.min(index, last)
        placeCursorIn(tr, nt, axis === 'row' ? i : 0, axis === 'row' ? 0 : i)
      }
      dispatch(tr)
    }
    return true
  }
}

/**
 * from の行(列)を to の位置へ動かす(つまみのドラッグ)。
 * 結合したセルにまたがる行(列)は、結合したまとまりごと動く。動かせないときは false
 */
export function moveLine(tablePos: number, axis: Axis, from: number, to: number): Command {
  return (state, dispatch) => {
    const t = tableAt(state.doc, tablePos)
    if (!t || from === to) return false
    if (from < 0 || to < 0 || from >= lineCount(t, axis) || to >= lineCount(t, axis)) return false
    // prosemirror-tables の移動は「今の選択のある表」を見るので、表の中を選んだ状態で試す
    const withSel = state.tr
    selectLine(withSel, tablePos, axis, from)
    const cmd = axis === 'row' ? moveTableRow({ from, to, pos: tablePos + 1 }) : moveTableColumn({ from, to, pos: tablePos + 1 })
    let moved: Transaction | null = null
    if (!cmd(state.apply(withSel), (tr) => (moved = tr))) return false
    if (dispatch && moved) {
      // 選択を置いただけでは文章は変わらないので、移動の変更をそのまま今の文章にあてて、1回の変更にする
      const m: Transaction = moved
      const tr = state.tr
      for (const step of m.steps) tr.step(step)
      tr.setSelection(Selection.fromJSON(tr.doc, m.selection.toJSON()))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

// ---- 見出し ----

/** 1行目(axis=row)・1列目(axis=col)を見出しにする/やめる */
export function setHeader(tablePos: number, axis: Axis, on: boolean): Command {
  return (state, dispatch) => {
    const t = tableAt(state.doc, tablePos)
    if (!t) return false
    const key = axis === 'row' ? 'headerRow' : 'headerColumn'
    if (!!t.node.attrs[key] === on) return false
    if (dispatch) dispatch(state.tr.setNodeMarkup(tablePos, undefined, { ...t.node.attrs, [key]: on }))
    return true
  }
}

// ---- 列の幅 ----

/** 列ごとの今の幅(指定がなければ null) */
export function columnWidths(t: TableAt): (number | null)[] {
  const out: (number | null)[] = Array(t.map.width).fill(null)
  const seen = new Set<number>()
  for (const rel of t.map.map) {
    if (seen.has(rel)) continue
    seen.add(rel)
    const cell = t.node.nodeAt(rel)!
    const rect = t.map.findCell(rel)
    const cw = cell.attrs.colwidth as number[] | null
    for (let i = rect.left; i < rect.right; i++) {
      const w = cw?.[i - rect.left]
      if (out[i] === null && typeof w === 'number' && w > 0) out[i] = w
    }
  }
  return out
}

/** 列 col の幅を width(px)にする。ほかの列は今の幅のまま(未指定の列は measured の幅で固定する) */
export function setColumnWidth(tablePos: number, col: number, width: number, measured: number[] = []): Command {
  return (state, dispatch) => {
    const t = tableAt(state.doc, tablePos)
    if (!t || col < 0 || col >= t.map.width) return false
    const widths = columnWidths(t).map((w, i) => w ?? (measured[i] ? Math.round(measured[i]) : null))
    widths[col] = Math.max(MIN_COL_WIDTH, Math.round(width))
    if (dispatch) dispatch(applyColumnWidths(state.tr, t, widths))
    return true
  }
}

/** 列ごとの幅を、それぞれのセルの colwidth に書く */
function applyColumnWidths(tr: Transaction, t: TableAt, widths: (number | null)[]): Transaction {
  const seen = new Set<number>()
  for (const rel of t.map.map) {
    if (seen.has(rel)) continue
    seen.add(rel)
    const cell = t.node.nodeAt(rel)!
    const rect = t.map.findCell(rel)
    const cw = widths.slice(rect.left, rect.right)
    const next = cw.every((w) => w === null) ? null : cw.map((w) => w ?? 0)
    const prev = cell.attrs.colwidth as number[] | null
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      tr.setNodeMarkup(t.start + rel, undefined, { ...cell.attrs, colwidth: next })
    }
  }
  return tr
}

// ---- 選んだセルへの操作 ----

/** 選んだセル(範囲選択ならすべて)の属性を変える */
function setCellsAttr(name: string, value: unknown): Command {
  return (state, dispatch) => {
    const cells = selectedCellPositions(state)
    if (cells.length === 0) return false
    if (dispatch) {
      const tr = state.tr
      for (const pos of cells) {
        const cell = tr.doc.nodeAt(pos)
        if (cell && cell.attrs[name] !== value) tr.setNodeMarkup(pos, undefined, { ...cell.attrs, [name]: value })
      }
      dispatch(tr)
    }
    return true
  }
}

/** セルの背景色(null で色なし) */
export const setCellsBackground = (color: MarkerColorName | null): Command => setCellsAttr('bg', color)

/** セルの文字の配置(null は左=指定なし) */
export const setCellsAlign = (align: CellAlign | null): Command => setCellsAttr('align', align === 'left' ? null : align)

/** 選んだセルの中身を消す(セルは残す) */
export const clearCells: Command = (state, dispatch) => {
  const cells = selectedCellPositions(state)
  if (cells.length === 0) return false
  if (dispatch) {
    const tr = state.tr
    // 後ろのセルから消して、位置がずれないようにする
    for (const pos of [...cells].sort((a, b) => b - a)) {
      const cell = tr.doc.nodeAt(pos)!
      const empty = cell.type.contentMatch.defaultType?.createAndFill()
      if (!empty) continue
      tr.replaceWith(pos + 1, pos + cell.nodeSize - 1, empty)
    }
    dispatch(tr)
  }
  return true
}

/** 範囲選択したセルを1つに結合する */
export const mergeSelectedCells: Command = mergeCells

/** 結合したセルを分ける */
export const splitSelectedCell: Command = splitCell

/** 選んだセルを結合できるか・分けられるか */
export const canMerge = (state: EditorState) => mergeCells(state)
export const canSplit = (state: EditorState) => splitCell(state)

// ---- そのほか ----

/** 表の (row, col) のセルの中にカーソルを置く */
function placeCursorIn(tr: Transaction, t: TableAt, row: number, col: number) {
  const rel = t.map.map[Math.min(row, t.map.height - 1) * t.map.width + Math.min(col, t.map.width - 1)]
  tr.setSelection(TextSelection.near(tr.doc.resolve(t.start + rel + 1)))
}
