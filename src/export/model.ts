import type { JSONContent } from '@tiptap/core'
import type { Page } from '../db/db'
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

export interface TableCellBlock {
  /** セルの中の段落。1つの要素が1段落 */
  paragraphs: Run[][]
  bg: MarkerColorName | null
}

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
  | { kind: 'table'; rows: TableCellBlock[][] }
  | { kind: 'image'; imageId: string; width: number; height: number }
  /** 別ノート・別ページへのリンク(表示用の文字にしたもの) */
  | { kind: 'noteLink'; text: string }

export interface ExportPage {
  blocks: Block[]
  /** 付箋(1つの付箋が1つの要素)。中身が空の付箋は入れない */
  stickies: Block[][]
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
        blocks.push({
          kind: 'table',
          rows: (node.content ?? []).map((row) =>
            (row.content ?? []).map((cell) => ({
              paragraphs: (cell.content ?? []).map(runsOf),
              bg: isMarkerColor(cell.attrs?.bg) ? cell.attrs.bg : null,
            })),
          ),
        })
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
        .map((s) => contentToBlocks(s.content, linkText))
        .filter((b) => !isEmptyBlocks(b)),
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
