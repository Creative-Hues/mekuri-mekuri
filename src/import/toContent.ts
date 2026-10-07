import type { JSONContent } from '@tiptap/core'
import { emptyDoc } from '../db/db'
import type { ListKind, Run, TableCellBlock } from '../export/model'
import type { ImportBlock, ImportedPage } from './model'

/**
 * 読み込んだ内容(ImportBlock の並び)を、TipTap の JSON(ページの content)にする。
 * 書き出しの contentToBlocks(src/export/model.ts)の逆の変換
 */

/** 保存した画像(読み込み中の key → images テーブルの id と大きさ) */
export type SavedImages = Map<string, { id: string; width: number; height: number }>

type ListItemBlock = Extract<ImportBlock, { kind: 'listItem' }>

const LIST_TYPES: Record<ListKind, { list: string; item: string }> = {
  bullet: { list: 'bulletList', item: 'listItem' },
  ordered: { list: 'orderedList', item: 'listItem' },
  task: { list: 'taskList', item: 'taskItem' },
}

/** 装飾が同じ Run か */
const sameStyle = (a: Run, b: Run) =>
  !!a.bold === !!b.bold &&
  !!a.strike === !!b.strike &&
  a.color === b.color &&
  a.marker === b.marker &&
  a.line?.style === b.line?.style &&
  a.line?.color === b.line?.color &&
  a.href === b.href

/** Run の並びを、文字(装飾つき)と改行のノードにする。同じ装飾が続く文字は1つにまとめる */
export function runsToInline(input: Run[]): JSONContent[] {
  const runs: Run[] = []
  for (const r of input) {
    const last = runs[runs.length - 1]
    if (last && sameStyle(last, r)) last.text += r.text
    else runs.push({ ...r })
  }
  const out: JSONContent[] = []
  for (const r of runs) {
    const marks: NonNullable<JSONContent['marks']> = []
    if (r.bold) marks.push({ type: 'bold' })
    if (r.strike) marks.push({ type: 'strike' })
    if (r.color) marks.push({ type: 'textColor', attrs: { color: r.color } })
    if (r.marker) marks.push({ type: 'marker', attrs: { color: r.marker } })
    if (r.line) marks.push({ type: 'underline', attrs: { style: r.line.style, color: r.line.color } })
    if (r.href) marks.push({ type: 'link', attrs: { href: r.href } })
    r.text.split('\n').forEach((text, i) => {
      if (i > 0) out.push({ type: 'hardBreak' })
      if (text) out.push(marks.length ? { type: 'text', text, marks: marks.map((m) => ({ ...m })) } : { type: 'text', text })
    })
  }
  return out
}

function paragraph(runs: Run[]): JSONContent {
  const content = runsToInline(runs)
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
}

function tableNode(rows: TableCellBlock[][]): JSONContent {
  const cols = Math.max(1, ...rows.map((r) => r.length))
  return {
    type: 'table',
    content: rows.map((row) => ({
      type: 'tableRow',
      // 列の数がそろっていない表は、足りないところに空のセルを足す
      content: Array.from({ length: cols }, (_, i) => {
        const cell = row[i]
        const paragraphs = cell && cell.paragraphs.length > 0 ? cell.paragraphs : [[]]
        return {
          type: 'tableCell',
          attrs: { colspan: 1, rowspan: 1, colwidth: null, bg: cell?.bg ?? null },
          content: paragraphs.map(paragraph),
        }
      }),
    })),
  }
}

/**
 * 平らに並んだリストの項目(深さ・リストの番号つき)から、入れ子のリストを組み立てる。
 * blocks[start] から、同じリストと、その中に入れ子になった項目を読み、[リストのノード, 次の位置] を返す
 */
function buildList(blocks: ImportBlock[], start: number): [JSONContent, number] {
  const first = blocks[start] as ListItemBlock
  const { depth, listId, list } = first
  const types = LIST_TYPES[list]
  const items: JSONContent[] = []
  let current: JSONContent | null = null
  const newItem = (b: ListItemBlock | null): JSONContent => {
    const item: JSONContent = { type: types.item, content: [paragraph(b && !b.continued ? b.runs : [])] }
    if (list === 'task') item.attrs = { checked: !!b?.checked }
    items.push(item)
    return item
  }

  let i = start
  while (i < blocks.length) {
    const b = blocks[i]
    if (b.kind !== 'listItem' || b.depth < depth) break
    if (b.depth > depth) {
      // 入れ子のリスト(項目がまだなければ、空の項目に入れる)
      const [child, next] = buildList(blocks, i)
      ;(current ??= newItem(null)).content!.push(child)
      i = next
      continue
    }
    if (b.listId !== listId) break
    if (b.continued && current) current.content!.push(paragraph(b.runs))
    else current = newItem(b)
    i++
  }

  const node: JSONContent = { type: types.list, content: items }
  if (list === 'ordered' && first.number !== 1) node.attrs = { start: first.number }
  return [node, i]
}

/** ブロックの並びを、ページ(または付箋)の中身にする */
export function blocksToDoc(blocks: ImportBlock[], images: SavedImages = new Map()): JSONContent {
  const content: JSONContent[] = []
  let i = 0
  while (i < blocks.length) {
    const b = blocks[i]
    switch (b.kind) {
      case 'listItem': {
        const [node, next] = buildList(blocks, i)
        content.push(node)
        i = next
        continue
      }
      case 'heading': {
        const inline = runsToInline(b.runs)
        content.push(inline.length ? { type: 'heading', attrs: { level: b.level }, content: inline } : { type: 'heading', attrs: { level: b.level } })
        break
      }
      case 'paragraph':
        content.push(paragraph(b.runs))
        break
      case 'table':
        if (b.rows.length > 0) content.push(tableNode(b.rows))
        break
      case 'image': {
        const img = images.get(b.key)
        content.push(
          img
            ? { type: 'image', attrs: { imageId: img.id, width: img.width, height: img.height } }
            : paragraph([{ text: '[画像]' }]),
        )
        break
      }
    }
    i++
  }
  return content.length ? { type: 'doc', content } : emptyDoc()
}

/** 中身のないページか(文字・表・画像がない) */
export function isBlankPage(page: ImportedPage): boolean {
  return (
    page.stickies.length === 0 &&
    page.blocks.every((b) => (b.kind === 'paragraph' || b.kind === 'heading' ? b.runs.every((r) => !r.text.trim()) : false))
  )
}
