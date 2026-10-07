import type { ListKind, TableCellBlock } from '../export/model'
import { parseStickyLabel } from '../export/stickyLabel'
import { emptyPage, type ImportBlock, type ImportedDoc, type ImportedPage, type ImportedSticky } from './model'

/**
 * テキスト(.txt)の読み込み。書き出し(src/export/toText.ts)の形を元に戻す:
 * - 「── 2ページ ──」の行でページを分ける。1行目+空行+「── 1ページ ──」なら、1行目がノート名
 * - 行の頭の「・」「1.」「□」「■」と2つずつの字下げを、箇条書き・番号付き・ToDo に戻す
 * - タブ区切りの行を表に戻す
 * - 「【付箋(色)】」(古い書き出しは「【付箋】」)から下を付箋に戻す
 * それ以外の行は、1行を1つの段落にする(空の行は空の段落)
 */

const PAGE_SEP = /^──\s*(\d+)\s*ページ\s*──$/
const STICKY_HEAD = /^【(.+)】$/
const LIST_LINE = /^( *)(・|□|■|(\d+)\.)(?: (.*))?$/

/** 前後の空行を取る */
function trimBlankLines(lines: string[]): string[] {
  let a = 0
  let b = lines.length
  while (a < b && !lines[a].trim()) a++
  while (b > a && !lines[b - 1].trim()) b--
  return lines.slice(a, b)
}

/** 付箋の見出しの行か(色。見出しでなければ null) */
function stickyHead(line: string) {
  const m = STICKY_HEAD.exec(line.trim())
  return m ? parseStickyLabel(m[1]) : null
}

/** 表の行か:タブを含み、どこかで「文字+タブ」になっている(行の頭のタブだけの字下げは表にしない) */
const hasTab = (line: string) => line.includes('\t')
const isTableStart = (line: string) => /\S\t/.test(line)

/** 行の並びをブロックにする */
export function linesToBlocks(lines: string[]): ImportBlock[] {
  const blocks: ImportBlock[] = []
  // 深さごとの今のリスト(種類と番号)。リスト以外の行が来たら空にする
  let lists: { kind: ListKind; id: number }[] = []
  let nextListId = 1
  // 直前のリストの項目と、その中身の字下げ(2行目以降の判定用)
  let lastItem: { block: Extract<ImportBlock, { kind: 'listItem' }>; contentIndent: number } | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // 表:タブ区切りの行が続くところ
    if (hasTab(line)) {
      let end = i
      while (end < lines.length && hasTab(lines[end])) end++
      const rowsText = lines.slice(i, end)
      if (rowsText.some(isTableStart)) {
        const rows: TableCellBlock[][] = rowsText.map((r) =>
          r.split('\t').map((cell) => ({ paragraphs: [[{ text: cell.trim() }]], bg: null })),
        )
        blocks.push({ kind: 'table', rows })
        lists = []
        lastItem = null
        i = end - 1
        continue
      }
    }

    const m = LIST_LINE.exec(line)

    // リストの項目の2行目以降(項目の中身と同じ字下げ)
    if (!m && lastItem && line.trim() && /^ +/.test(line)) {
      const indent = /^ */.exec(line)![0].length
      if (indent === lastItem.contentIndent) {
        lastItem.block.runs.push({ text: '\n' }, { text: line.slice(indent) })
        continue
      }
    }

    if (m) {
      const depth = Math.floor(m[1].length / 2)
      const mark = m[2]
      const kind: ListKind = m[3] ? 'ordered' : mark === '・' ? 'bullet' : 'task'
      // 同じ深さで同じ種類のリストが続いていれば、同じリストの項目にする(深さが飛んでいるときは間を詰める)
      const d = Math.min(depth, lists.length)
      if (!lists[d] || lists[d].kind !== kind) lists[d] = { kind, id: nextListId++ }
      lists.length = d + 1
      const block: Extract<ImportBlock, { kind: 'listItem' }> = {
        kind: 'listItem',
        list: kind,
        depth: d,
        listId: lists[d].id,
        number: m[3] ? Number(m[3]) : 1,
        checked: mark === '■',
        continued: false,
        runs: m[4] ? [{ text: m[4] }] : [],
      }
      blocks.push(block)
      lastItem = { block, contentIndent: m[1].length + mark.length + 1 }
      continue
    }

    lists = []
    lastItem = null
    blocks.push({ kind: 'paragraph', runs: line ? [{ text: line }] : [] })
  }
  return blocks
}

/** 1ページ分の行を、本文と付箋に分ける */
function parsePage(lines: string[]): ImportedPage {
  const page = emptyPage()
  const body = trimBlankLines(lines)
  // 付箋の始まり:空行のあと(またはページの頭)にある「【付箋…】」
  const start = body.findIndex((l, i) => stickyHead(l) !== null && (i === 0 || !body[i - 1].trim()))
  const bodyLines = start < 0 ? body : body.slice(0, start)
  page.blocks = linesToBlocks(trimBlankLines(bodyLines))
  if (start < 0) return page

  const rest = body.slice(start)
  const stickies: ImportedSticky[] = []
  let i = 0
  while (i < rest.length) {
    const color = stickyHead(rest[i])
    let end = i + 1
    while (end < rest.length && !(stickyHead(rest[end]) !== null && !rest[end - 1].trim())) end++
    const content = trimBlankLines(rest.slice(i + 1, end))
    if (color === 'legacy') {
      // 古い書き出し(色なし):付箋どうしは空行で区切られている。色は黄色
      let chunk: string[] = []
      for (const l of [...content, '']) {
        if (l.trim()) chunk.push(l)
        else if (chunk.length) {
          stickies.push({ color: 'yellow', blocks: linesToBlocks(chunk) })
          chunk = []
        }
      }
    } else if (color) {
      stickies.push({ color, blocks: linesToBlocks(content) })
    }
    i = end
  }
  page.stickies = stickies
  return page
}

export function parseText(text: string): ImportedDoc {
  let lines = text.split('\n')
  let title: string | null = null
  // 書き出した形:1行目がノート名、空行、「── 1ページ ──」
  const first = lines.findIndex((l) => l.trim())
  if (first >= 0 && lines[first + 1]?.trim() === '' && PAGE_SEP.exec(lines[first + 2]?.trim() ?? '')?.[1] === '1') {
    title = lines[first].trim()
    lines = lines.slice(first + 2)
  }

  // ページに分ける(最初の区切りより前に何も書かれていなければ、そこはページにしない)
  const chunks: string[][] = [[]]
  for (const line of lines) {
    if (PAGE_SEP.test(line.trim())) {
      if (chunks.length > 1 || chunks[0].some((l) => l.trim())) chunks.push([])
      else chunks[0] = []
      continue
    }
    chunks[chunks.length - 1].push(line)
  }
  return { title, pages: chunks.map(parsePage), images: new Map(), issues: new Map() }
}
