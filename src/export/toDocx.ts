import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  UnderlineType,
  WidthType,
  type ParagraphChild,
} from 'docx'
import type { LineStyleName } from '../editor/palette'
import { MARKER_HEX, TABLE_HEAD_HEX, TEXT_HEX } from './colors'
import { tableGrid, type Block, type ExportNote, type Run, type TableBlock } from './model'
import { stickyLabel } from './stickyLabel'

/**
 * Word(.docx)の出力。見出し・装飾(太字・取り消し線・文字色・マーカー・ライン)・リスト・表・画像・Webリンクを出す。
 * このファイルは docx ライブラリ(約300KB)を使うので、Word を選んだときだけ読み込む(exportNote.ts)
 */

export interface DocxImage {
  data: ArrayBuffer
  mime: string
  width: number
  height: number
}

/** 画像の最大の幅(px)。A4 の余白の内側に収まる大きさ */
const MAX_IMAGE_WIDTH = 600
/** 文字の書体(日本語も英数字も同じゴシック体に) */
const FONT = 'Yu Gothic'
/** ToDo の記号(絵文字にならない普通の文字:U+25A1・U+25A0) */
const TASK_MARK = { open: '□ ', done: '■ ' }
/** 番号付きリストの番号の設定の名前 */
const ORDERED = 'mekuri-ordered'

const LINE_TYPES: Record<LineStyleName, (typeof UnderlineType)[keyof typeof UnderlineType]> = {
  solid: UnderlineType.SINGLE,
  wavy: UnderlineType.WAVE,
  double: UnderlineType.DOUBLE,
  dotted: UnderlineType.DOTTED,
}

function textRuns(r: Run, hyperlink: boolean): TextRun[] {
  // 改行を含む文字は、行ごとに分けて改行(break)を入れる
  return r.text.split('\n').map(
    (text, i) =>
      new TextRun({
        text,
        break: i > 0 ? 1 : undefined,
        bold: r.bold,
        strike: r.strike,
        color: r.color ? TEXT_HEX[r.color] : undefined,
        shading: r.marker ? { type: ShadingType.CLEAR, fill: MARKER_HEX[r.marker], color: 'auto' } : undefined,
        underline: r.line
          ? { type: LINE_TYPES[r.line.style], color: r.line.color ? TEXT_HEX[r.line.color] : undefined }
          : hyperlink
            ? { type: UnderlineType.SINGLE }
            : undefined,
        style: hyperlink ? 'Hyperlink' : undefined,
      }),
  )
}

function runsToChildren(runs: Run[]): ParagraphChild[] {
  return runs.flatMap((r): ParagraphChild[] =>
    r.href ? [new ExternalHyperlink({ link: r.href, children: textRuns(r, true) })] : textRuns(r, false),
  )
}

const HEADINGS = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 } as const

function imageParagraph(b: Extract<Block, { kind: 'image' }>, images: Map<string, DocxImage>): Paragraph {
  const img = images.get(b.imageId)
  if (!img) return new Paragraph({ children: [new TextRun({ text: '[画像が見つかりません]', color: TEXT_HEX.gray })] })
  const w = img.width || b.width || MAX_IMAGE_WIDTH
  const h = img.height || b.height || MAX_IMAGE_WIDTH
  const scale = Math.min(1, MAX_IMAGE_WIDTH / w)
  return new Paragraph({
    children: [
      new ImageRun({
        type: img.mime === 'image/png' ? 'png' : 'jpg',
        data: img.data,
        transformation: { width: Math.round(w * scale), height: Math.round(h * scale) },
      }),
    ],
  })
}

/** 表の見出しのセルの段落スタイル(太字。文字そのものは太字にしないので、読み込むと元の文字に戻る) */
const TABLE_HEAD_STYLE = 'MekuriTableHead'
/** 本文の幅(twip)。A4(11906)から左右の余白(1440 ずつ)を引いた幅 */
const BODY_WIDTH = 11906 - 1440 * 2
/** 画面の 1px は Word の 15 twip(96dpi) */
const TWIP_PER_PX = 15

/**
 * 列の幅(twip)。幅を決めた列のある表だけ。決めていない列は、決めた列の平均の幅にする。
 * 本文の幅より広い表は、比率を保って本文の幅に収める
 */
export function docxColumnWidths(colWidths: (number | null)[] | undefined, cols: number): number[] | null {
  const ws = Array.from({ length: cols }, (_, i) => colWidths?.[i] ?? null)
  const known = ws.filter((w): w is number => typeof w === 'number' && w > 0)
  if (known.length === 0) return null
  const avg = known.reduce((a, b) => a + b, 0) / known.length
  const twips = ws.map((w) => Math.round((w ?? avg) * TWIP_PER_PX))
  const total = twips.reduce((a, b) => a + b, 0)
  if (total <= BODY_WIDTH) return twips
  return twips.map((t) => Math.floor((t * BODY_WIDTH) / total))
}

const ALIGNMENT = { center: AlignmentType.CENTER, right: AlignmentType.RIGHT } as const

/**
 * 表。結合(gridSpan・vMerge)・列の幅・セルごとの配置・見出しの行(太字+見出しの色+各ページの先頭に繰り返す)・
 * 見出しの列(太字+見出しの色)・セルの色を、Word の表の機能でそのまま出す
 */
function tableOf(b: TableBlock): Table {
  const grid = tableGrid(b.rows)
  const cols = Math.max(1, grid[0]?.length ?? 0)
  const widths = docxColumnWidths(b.colWidths, cols)
  /** セルの左上のマスの列 */
  const colOf = new Map(grid.flatMap((g) => g.filter((s) => s.origin).map((s) => [s.cell, s.col] as const)))
  return new Table({
    ...(widths
      ? { columnWidths: widths, width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, layout: TableLayoutType.FIXED }
      : { width: { size: 100, type: WidthType.PERCENTAGE } }),
    rows: b.rows.map(
      (row, r) =>
        new TableRow({
          tableHeader: !!b.headerRow && r === 0,
          children: row.map((cell) => {
            const col = colOf.get(cell) ?? 0
            const colspan = Math.max(1, cell.colspan ?? 1)
            const rowspan = Math.max(1, Math.min(cell.rowspan ?? 1, b.rows.length - r))
            const head = (!!b.headerRow && r === 0) || (!!b.headerColumn && col === 0)
            const fill = cell.bg ? MARKER_HEX[cell.bg] : head ? TABLE_HEAD_HEX : null
            const paragraphs = cell.paragraphs.length > 0 ? cell.paragraphs : [[]]
            return new TableCell({
              columnSpan: colspan > 1 ? colspan : undefined,
              rowSpan: rowspan > 1 ? rowspan : undefined,
              width: widths
                ? { size: widths.slice(col, col + colspan).reduce((a, b) => a + b, 0), type: WidthType.DXA }
                : undefined,
              shading: fill ? { type: ShadingType.CLEAR, fill, color: 'auto' } : undefined,
              children: paragraphs.map(
                (p) =>
                  new Paragraph({
                    style: head ? TABLE_HEAD_STYLE : undefined,
                    alignment: cell.align ? ALIGNMENT[cell.align] : undefined,
                    children: runsToChildren(p),
                  }),
              ),
            })
          }),
        }),
    ),
  })
}

/** Block の並びを Word の段落・表にする */
function blocksToDocx(blocks: Block[], images: Map<string, DocxImage>, listBase: { n: number }): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  // 番号付きリストは、リストごとに番号を 1 から振り直す(instance を分ける)
  const instances = new Map<number, number>()
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading':
        out.push(new Paragraph({ heading: HEADINGS[b.level], children: runsToChildren(b.runs) }))
        break
      case 'paragraph':
        out.push(new Paragraph({ children: runsToChildren(b.runs) }))
        break
      case 'listItem': {
        const level = Math.min(b.depth, 8)
        const indent = { left: 420 * (b.depth + 1), hanging: b.continued ? 0 : 300 }
        if (b.continued) {
          out.push(new Paragraph({ indent: { left: 420 * (b.depth + 1) }, children: runsToChildren(b.runs) }))
        } else if (b.list === 'bullet') {
          out.push(new Paragraph({ bullet: { level }, children: runsToChildren(b.runs) }))
        } else if (b.list === 'ordered') {
          if (!instances.has(b.listId)) instances.set(b.listId, ++listBase.n)
          out.push(
            new Paragraph({
              numbering: { reference: ORDERED, level, instance: instances.get(b.listId) },
              children: runsToChildren(b.runs),
            }),
          )
        } else {
          out.push(
            new Paragraph({
              indent,
              children: [new TextRun({ text: b.checked ? TASK_MARK.done : TASK_MARK.open }), ...runsToChildren(b.runs)],
            }),
          )
        }
        break
      }
      case 'table':
        out.push(tableOf(b))
        // 表が続くと Word ではくっついてしまうので、間に空の段落を入れる
        out.push(new Paragraph({}))
        break
      case 'image':
        out.push(imageParagraph(b, images))
        break
      case 'noteLink':
        out.push(new Paragraph({ children: [new TextRun({ text: b.text, color: TEXT_HEX.blue })] }))
        break
    }
  }
  return out
}

/** Word 文書を作る(テストでも使う) */
export function buildDocx(note: ExportNote, images: Map<string, DocxImage>): Document {
  const listBase = { n: 0 }
  const children: (Paragraph | Table)[] = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(note.title)] })]
  note.pages.forEach((page, i) => {
    // ページごとに改ページ(1ページ目はタイトルの下から)
    if (i > 0) children.push(new Paragraph({ children: [new PageBreak()] }))
    children.push(...blocksToDocx(page.blocks, images, listBase))
    // 付箋は1つずつ太字の「付箋(色)」の見出しを付ける(読み込むときに色を戻せるように)
    for (const s of page.stickies) {
      children.push(
        new Paragraph({ spacing: { before: 240 }, children: [new TextRun({ text: stickyLabel(s.color), bold: true })] }),
      )
      children.push(...blocksToDocx(s.blocks, images, listBase))
    }
  })

  return new Document({
    creator: 'めくりめくり',
    title: note.title,
    styles: {
      default: { document: { run: { font: { ascii: FONT, eastAsia: FONT, hAnsi: FONT } } } },
      paragraphStyles: [{ id: TABLE_HEAD_STYLE, name: '表の見出し', basedOn: 'Normal', run: { bold: true } }],
    },
    numbering: {
      config: [
        {
          reference: ORDERED,
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 420 * (level + 1), hanging: 300 } } },
          })),
        },
      ],
    },
    sections: [{ children }],
  })
}

export async function toDocx(note: ExportNote, images: Map<string, DocxImage>): Promise<Blob> {
  return Packer.toBlob(buildDocx(note, images))
}
