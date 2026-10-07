import type { JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Note, Page } from '../db/db'

/**
 * 全ノート検索(画面に関係しない計算部分)。
 * - タイトル・本文(見出し・表のセルを含む)・付箋の文字から探す
 * - 全角/半角・大文字/小文字・濁点の付け方(ｶﾞ と ガ など)の違いは区別しない
 * - ゴミ箱のノート・ページは探さない
 * 本文の何番目に見つかった文字か(occurrence)で場所を指す。
 * JSON とエディタの文書は同じ順にたどるので、番号が一致する
 */

/** 文字のまとまり(段落・見出し・トグル見出しの見出し)。この中だけで探す(まとまりをまたがない) */
const TEXTBLOCKS = new Set(['paragraph', 'heading', 'toggleTitle'])

/**
 * 比べやすい形にそろえる。1文字ずつ NFKD(全角英数→半角、半角カナ→全角、濁点を分ける)+ 小文字にする。
 * map[i] は、そろえた文字 i が元の文字列の何文字目から来たか(最後に元の長さを足しておく)
 */
export function normalizeWithMap(s: string): { text: string; map: number[] } {
  let text = ''
  const map: number[] = []
  let i = 0
  for (const ch of s) {
    const n = ch.normalize('NFKD').toLowerCase()
    for (let k = 0; k < n.length; k++) map.push(i)
    text += n
    i += ch.length
  }
  map.push(s.length)
  return { text, map }
}

export const normalize = (s: string) => normalizeWithMap(s).text

/** text の中の query の場所(元の文字列での位置)をすべて */
export function findAll(text: string, query: string): { start: number; end: number }[] {
  const q = normalize(query.trim())
  if (!q) return []
  const { text: t, map } = normalizeWithMap(text)
  const found: { start: number; end: number }[] = []
  let at = t.indexOf(q)
  while (at >= 0) {
    found.push({ start: map[at], end: map[at + q.length] })
    at = t.indexOf(q, at + q.length)
  }
  return found
}

const textOf = (n: JSONContent): string =>
  n.type === 'text' ? (n.text ?? '') : (n.content ?? []).map(textOf).join('')

/** ページ内容の文字のまとまり(文書の順) */
export function textBlocks(doc: JSONContent | undefined): string[] {
  const blocks: string[] = []
  const walk = (n: JSONContent) => {
    if (n.type && TEXTBLOCKS.has(n.type)) {
      blocks.push(textOf(n))
      return
    }
    n.content?.forEach(walk)
  }
  if (doc) walk(doc)
  return blocks
}

export interface Snippet {
  before: string
  match: string
  after: string
}

const BEFORE = 16
const AFTER = 40

function snippet(text: string, start: number, end: number): Snippet {
  return {
    before: (start > BEFORE ? '…' : '') + text.slice(Math.max(0, start - BEFORE), start),
    match: text.slice(start, end),
    after: text.slice(end, end + AFTER) + (end + AFTER < text.length ? '…' : ''),
  }
}

export interface SearchHit {
  pageId: string
  /** 1から */
  pageNumber: number
  /** 付箋の中で見つかったときはその付箋 */
  stickyId: string | null
  /** 本文の何番目の一致か(0から。付箋のときは付箋の中で何番目か) */
  occurrence: number
  snippet: Snippet
}

export interface NoteResult {
  note: Note
  titleMatch: boolean
  hits: SearchHit[]
}

/** すべてのノートから探す。ノートは本棚の並び(notes の順)のまま返す */
export function searchNotes(notes: Note[], pages: Page[], query: string): NoteResult[] {
  if (!normalize(query.trim())) return []
  const byNote = new Map<string, Page[]>()
  for (const p of pages) {
    if (p.deletedAt != null) continue
    const list = byNote.get(p.noteId) ?? []
    list.push(p)
    byNote.set(p.noteId, list)
  }
  const results: NoteResult[] = []
  for (const note of notes) {
    if (note.deletedAt != null) continue
    const titleMatch = findAll(note.title, query).length > 0
    const hits: SearchHit[] = []
    const list = (byNote.get(note.id) ?? []).sort((a, b) => a.order - b.order)
    list.forEach((page, i) => {
      let occurrence = 0
      for (const block of textBlocks(page.content)) {
        for (const m of findAll(block, query)) {
          hits.push({
            pageId: page.id,
            pageNumber: i + 1,
            stickyId: null,
            occurrence: occurrence++,
            snippet: snippet(block, m.start, m.end),
          })
        }
      }
      for (const sticky of page.stickies ?? []) {
        let n = 0
        for (const block of textBlocks(sticky.content)) {
          for (const m of findAll(block, query)) {
            hits.push({
              pageId: page.id,
              pageNumber: i + 1,
              stickyId: sticky.id,
              occurrence: n++,
              snippet: snippet(block, m.start, m.end),
            })
          }
        }
      }
    })
    if (titleMatch || hits.length) results.push({ note, titleMatch, hits })
  }
  return results
}

/**
 * エディタの文書の中で、occurrence 番目に見つかった query の位置(from〜to)。なければ null。
 * textBlocks と同じ順・同じ数え方で探す
 */
export function findOccurrence(doc: PMNode, query: string, occurrence: number): { from: number; to: number } | null {
  let count = 0
  let found: { from: number; to: number } | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (!TEXTBLOCKS.has(node.type.name)) return true
    // 文字ごとの文書上の位置(改行などの文字でない部分は飛ばす)
    let text = ''
    const at: number[] = []
    node.forEach((child, offset) => {
      if (!child.isText) return
      const start = pos + 1 + offset
      for (let k = 0; k < child.text!.length; k++) at.push(start + k)
      text += child.text
    })
    for (const m of findAll(text, query)) {
      if (count++ === occurrence) {
        found = { from: at[m.start], to: at[m.end - 1] + 1 }
        break
      }
    }
    return false
  })
  return found
}
