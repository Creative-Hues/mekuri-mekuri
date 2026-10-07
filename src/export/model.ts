import type { JSONContent } from '@tiptap/core'
import type { Page, StickyColor } from '../db/db'
import {
  isLineStyle,
  isMarkerColor,
  isTextColor,
  type LineColorName,
  type LineStyleName,
  type MarkerColorName,
  type TextColorName,
} from '../editor/palette'

/**
 * 出力(Word・Markdown・テキスト)用の、ページ内容の簡単な形。
 * TipTap の JSON を一度この形にしてから、それぞれの形式に書き出す
 */

/** 文字のまとまり(同じ装飾が続く部分) */
export interface Run {
  /** 改行(hardBreak)は '\n' */
  text: string
  bold?: boolean
  strike?: boolean
  color?: TextColorName
  marker?: MarkerColorName
  line?: { style: LineStyleName; color: LineColorName }
  /** Webリンクの URL */
  href?: string
}

export type ListKind = 'bullet' | 'ordered' | 'task'

/** セルの文字の配置(ないとき・null は左) */
export type CellAlign = 'center' | 'right'

export interface TableCellBlock {
  /** セルの中の段落。1つの要素が1段落 */
  paragraphs: Run[][]
  bg: MarkerColorName | null
  /** 結合(何列・何行ぶんか。ないときは 1) */
  colspan?: number
  rowspan?: number
  /** 文字の配置(ないとき・null は左) */
  align?: CellAlign | null
}

/**
 * 表。rows は HTML の表と同じ形(結合したセルは左上の行にだけ入り、またがれた所にはセルがない)。
 * 1マスずつの並びが要るときは tableGrid を使う
 */
export interface TableBlock {
  kind: 'table'
  rows: TableCellBlock[][]
  /** 1行目・1列目を見出しにする(v6〜) */
  headerRow?: boolean
  headerColumn?: boolean
  /** 列ごとの幅(px)。決めていない列は null。ないときは全部 null */
  colWidths?: (number | null)[]
}

/** 表の1マス:そこにあるセルと、それがセルの左上のマスか(結合したセルのほかのマスは false) */
export interface GridSlot {
  cell: TableCellBlock
  origin: boolean
  /** そのセルの左上のマスの位置 */
  row: number
  col: number
}

/** 表を1マスずつの並び(行×列)にする。足りないマスは空のセルで埋める */
export function tableGrid(rows: TableCellBlock[][]): GridSlot[][] {
  const grid: (GridSlot | undefined)[][] = rows.map(() => [])
  rows.forEach((row, r) => {
    let c = 0
    for (const cell of row) {
      while (grid[r][c]) c++
      const cs = Math.max(1, cell.colspan ?? 1)
      const rs = Math.max(1, Math.min(cell.rowspan ?? 1, rows.length - r))
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          grid[r + dr][c + dc] = { cell, origin: dr === 0 && dc === 0, row: r, col: c }
        }
      }
      c += cs
    }
  })
  const width = Math.max(0, ...grid.map((g) => g.length))
  return grid.map((g, r) =>
    Array.from({ length: width }, (_, c) => g[c] ?? { cell: { paragraphs: [[]], bg: null }, origin: true, row: r, col: c }),
  )
}

/**
 * 列ごとの文字の配置(Markdown の表は列ごとにしか配置を決められないため)。
 * 列のセル(結合したセルは左上のマスの列だけ)がすべて同じならその配置、ばらばらなら 'mixed'
 */
export function columnAligns(grid: GridSlot[][]): (CellAlign | null | 'mixed')[] {
  const width = grid[0]?.length ?? 0
  return Array.from({ length: width }, (_, c) => {
    const values = new Set(grid.map((g) => g[c]).filter((s) => s.origin).map((s) => s.cell.align ?? null))
    if (values.size === 0) return null
    return values.size === 1 ? [...values][0] : 'mixed'
  })
}

/** 結合したセルのある表か */
export const hasMergedCells = (b: TableBlock) =>
  b.rows.some((row) => row.some((c) => (c.colspan ?? 1) > 1 || (c.rowspan ?? 1) > 1))

const isAlign = (v: unknown): v is CellAlign => v === 'center' || v === 'right'

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; runs: Run[] }
  | { kind: 'paragraph'; runs: Run[] }
  /**
   * リストの1項目。depth:入れ子の深さ(0から)。listId:同じリストの項目は同じ番号(番号の振り直しに使う)。
   * continued:項目の2段落目以降(記号・番号を付けない)
   */
  | {
      kind: 'listItem'
      list: ListKind
      depth: number
      listId: number
      number: number
      checked: boolean
      continued: boolean
      runs: Run[]
    }
  | TableBlock
  | { kind: 'image'; imageId: string; width: number; height: number }
  /** 別ノート・別ページへのリンク(表示用の文字にしたもの) */
  | { kind: 'noteLink'; text: string }

/** 付箋(色は書き出したファイルに書いておき、読み込むときに戻す) */
export interface ExportSticky {
  color: StickyColor
  blocks: Block[]
}

export interface ExportPage {
  blocks: Block[]
  /** 付箋(1つの付箋が1つの要素)。中身が空の付箋は入れない */
  stickies: ExportSticky[]
}

export interface ExportNote {
  title: string
  pages: ExportPage[]
}

/** 別ノート・別ページへのリンクを文字にする関数(load.ts で、その時点のノート名から作る) */
export type LinkText = (noteId: string | null, pageId: string | null) => string

/** 空のタイトルのときに使う名前 */
export const UNTITLED = '無題のノート'

function runsOf(node: JSONContent | undefined): Run[] {
  const runs: Run[] = []
  for (const child of node?.content ?? []) {
    if (child.type === 'hardBreak') {
      runs.push({ text: '\n' })
      continue
    }
    if (child.type !== 'text' || !child.text) continue
    const run: Run = { text: child.text }
    for (const mark of child.marks ?? []) {
      const a = mark.attrs ?? {}
      if (mark.type === 'bold') run.bold = true
      else if (mark.type === 'strike') run.strike = true
      else if (mark.type === 'textColor' && isTextColor(a.color)) run.color = a.color
      else if (mark.type === 'marker' && isMarkerColor(a.color)) run.marker = a.color
      else if (mark.type === 'underline') {
        run.line = { style: isLineStyle(a.style) ? a.style : 'solid', color: isTextColor(a.color) ? a.color : null }
      } else if (mark.type === 'link' && typeof a.href === 'string') run.href = a.href
    }
    runs.push(run)
  }
  return runs
}

const LIST_KINDS: Record<string, ListKind> = { bulletList: 'bullet', orderedList: 'ordered', taskList: 'task' }

/** ページ内容(または付箋の中身)を Block の並びにする */
export function contentToBlocks(doc: JSONContent | undefined, linkText: LinkText): Block[] {
  const blocks: Block[] = []
  let nextListId = 1

  const walkList = (list: JSONContent, depth: number) => {
    const kind = LIST_KINDS[list.type ?? '']
    const listId = nextListId++
    const start = typeof list.attrs?.start === 'number' ? list.attrs.start : 1
    ;(list.content ?? []).forEach((item, i) => {
      let first = true
      for (const child of item.content ?? []) {
        if (child.type && LIST_KINDS[child.type]) {
          walkList(child, depth + 1)
          continue
        }
        if (child.type === 'paragraph' || child.type === 'heading') {
          blocks.push({
            kind: 'listItem',
            list: kind,
            depth,
            listId,
            number: start + i,
            checked: !!item.attrs?.checked,
            continued: !first,
            runs: runsOf(child),
          })
          first = false
          continue
        }
        walk(child, depth + 1)
      }
      // 中身のない項目も、記号だけの行として残す
      if (first) {
        blocks.push({
          kind: 'listItem',
          list: kind,
          depth,
          listId,
          number: start + i,
          checked: !!item.attrs?.checked,
          continued: false,
          runs: [],
        })
      }
    })
  }

  const walk = (node: JSONContent, depth = 0) => {
    switch (node.type) {
      case 'doc':
        node.content?.forEach((c) => walk(c, depth))
        return
      case 'paragraph':
        blocks.push({ kind: 'paragraph', runs: runsOf(node) })
        return
      case 'heading': {
        const level = Math.min(3, Math.max(1, Number(node.attrs?.level) || 1)) as 1 | 2 | 3
        blocks.push({ kind: 'heading', level, runs: runsOf(node) })
        return
      }
      case 'toggleHeading': {
        // トグル見出しは、閉じていても中身を含めて「見出し+中身」として出す
        const level = Math.min(3, Math.max(1, Number(node.attrs?.level) || 1)) as 1 | 2 | 3
        const [title, ...rest] = node.content ?? []
        blocks.push({ kind: 'heading', level, runs: runsOf(title) })
        rest.forEach((c) => walk(c, depth))
        return
      }
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        walkList(node, depth)
        return
      case 'table':
        blocks.push(tableOf(node, runsOf))
        return
      case 'image':
        if (typeof node.attrs?.imageId === 'string') {
          blocks.push({
            kind: 'image',
            imageId: node.attrs.imageId,
            width: Number(node.attrs.width) || 0,
            height: Number(node.attrs.height) || 0,
          })
        }
        return
      case 'noteLink':
        blocks.push({ kind: 'noteLink', text: linkText(node.attrs?.noteId ?? null, node.attrs?.pageId ?? null) })
        return
      default:
        // 知らないノード(ほかのアプリから貼り付けたものなど)は、中身だけたどる
        node.content?.forEach((c) => walk(c, depth))
    }
  }

  walk(doc ?? { type: 'doc' })
  return blocks
}

/** 文字のない Block だけか(空の付箋・空のページの判定) */
export function isEmptyBlocks(blocks: Block[]): boolean {
  return blocks.every((b) => {
    if (b.kind === 'paragraph' || b.kind === 'heading') return b.runs.every((r) => !r.text.trim())
    if (b.kind === 'listItem') return b.runs.every((r) => !r.text.trim())
    return false
  })
}

/** ノートを出力用の形にする(pages はゴミ箱を除き、並び順どおりのもの) */
export function buildExportNote(title: string, pages: Page[], linkText: LinkText): ExportNote {
  return {
    title: title.trim() || UNTITLED,
    pages: pages.map((p) => ({
      blocks: contentToBlocks(p.content, linkText),
      stickies: [...(p.stickies ?? [])]
        // 上にある付箋から順に(同じ高さなら左から)
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((s) => ({ color: s.color, blocks: contentToBlocks(s.content, linkText) }))
        .filter((s) => !isEmptyBlocks(s.blocks)),
    })),
  }
}

/** Run の並びを文字だけにする */
export const plainText = (runs: Run[]) => runs.map((r) => r.text).join('')

/** ファイル名に使えない文字を置き換える(Windows・Mac・iPhone・Android で使えるように) */
export function safeFileName(title: string, ext: string): string {
  const base =
    title
      .replace(/\s+/g, ' ')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .trim()
      .replace(/^\.+|\.+$/g, '')
      .slice(0, 80)
      .trim() || UNTITLED
  return `${base}.${ext}`
}

/** 表のノード(TipTap の JSON)を出力用の形にする */
function tableOf(node: JSONContent, runsOf: (n: JSONContent) => Run[]): TableBlock {
  const span = (v: unknown) => (typeof v === 'number' && v > 1 ? Math.floor(v) : 1)
  const widthsByCell = new Map<TableCellBlock, unknown>()
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell): TableCellBlock => {
      const colspan = span(cell.attrs?.colspan)
      const rowspan = span(cell.attrs?.rowspan)
      const out: TableCellBlock = {
        paragraphs: (cell.content ?? []).map(runsOf),
        bg: isMarkerColor(cell.attrs?.bg) ? cell.attrs.bg : null,
      }
      if (colspan > 1) out.colspan = colspan
      if (rowspan > 1) out.rowspan = rowspan
      if (isAlign(cell.attrs?.align)) out.align = cell.attrs.align
      widthsByCell.set(out, cell.attrs?.colwidth)
      return out
    }),
  )
  // 列の幅:セルの colwidth(結合したセルは、またぐ列の数だけ)から、列ごとに集める
  const grid = tableGrid(rows)
  const colWidths: (number | null)[] = Array(grid[0]?.length ?? 0).fill(null)
  grid.forEach((g) =>
    g.forEach((slot, c) => {
      const cw = widthsByCell.get(slot.cell)
      const w = Array.isArray(cw) ? cw[c - slot.col] : null
      if (colWidths[c] === null && typeof w === 'number' && w > 0) colWidths[c] = w
    }),
  )
  return {
    kind: 'table',
    rows,
    headerRow: node.attrs?.headerRow === true,
    headerColumn: node.attrs?.headerColumn === true,
    colWidths,
  }
}
