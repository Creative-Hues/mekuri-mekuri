import { Lexer, type Token, type Tokens } from 'marked'
import type { ListKind, Run, TableCellBlock } from '../export/model'
import { parseStickyLabel } from '../export/stickyLabel'
import { decodeEntities, htmlToText, SKIP_CONTENT_TAGS, tagName } from './html'
import {
  addIssue,
  emptyPage,
  safeHref,
  type ImportBlock,
  type ImportedDoc,
  type ImportedPage,
  type Issues,
  type PendingImage,
} from './model'

/**
 * Markdown(.md)の読み込み。marked で分解した結果(トークン)から読み込みの形を作る。
 * marked で HTML は作らない(HTML の文字列をアプリに入れることはしない)。
 * - 「---」(区切り線)でページを分ける。先頭の front matter(--- で囲んだ設定)は読み飛ばす
 * - 見出し(4〜6 は小見出しに)・箇条書き・番号付き・ToDo・太字・取り消し線・リンク・表・改行を戻す
 * - 「**付箋(色)**」(古い書き出しは「**付箋**」)のあとの引用(>)を付箋に戻す
 * - 書かれた HTML のタグは読み飛ばして文字だけ残す(<script> などは中身ごと捨てる)。
 *   リンクは http・https・mailto だけ戻し、javascript: などは文字だけにする
 * - 斜体・コードは普通の文字に、ほかの引用は普通の段落にする
 * - 画像:ファイルの中に入っている画像(data:image/…;base64)は読み込み、外にある画像は「[画像]」の文字にする
 */

/** 文字の装飾(内側へ引き継ぐもの) */
interface Style {
  bold?: boolean
  strike?: boolean
  href?: string
}

interface Ctx {
  issues: Issues
  images: Map<string, PendingImage>
  nextListId: number
}

/** 先頭の front matter(「---」で囲んだ設定)を取り除く */
export function stripFrontMatter(src: string): string {
  return src.replace(/^---[ \t]*\n(?:[^\n]*\n)*?(?:---|\.\.\.)[ \t]*(?:\n|$)/, (block) =>
    // 「キー: 値」の形の行があるときだけ front matter とみなす
    /^[\w-]+\s*:/m.test(block) ? '' : block,
  )
}

const DATA_IMAGE = /^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z0-9+/=\s]+)$/i

function decodeDataImage(href: string): PendingImage | null {
  const m = DATA_IMAGE.exec(href.trim())
  if (!m) return null
  try {
    const bin = atob(m[2].replace(/\s+/g, ''))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return { data: bytes.buffer, mime: m[1].toLowerCase() }
  } catch {
    return null
  }
}

/** 文字の中のトークンを Run の並びにする。段落の中の画像は images に集める(段落のあとに置く) */
function inlineRuns(tokens: Token[] | undefined, ctx: Ctx, style: Style, images: string[]): Run[] {
  const runs: Run[] = []
  const push = (text: string) => {
    if (text) runs.push({ text, ...(style.bold && { bold: true }), ...(style.strike && { strike: true }), ...(style.href && { href: style.href }) })
  }
  // <script> などの中を読み飛ばしているときの、そのタグの名前
  let skipping: string | null = null

  for (const token of tokens ?? []) {
    if (skipping) {
      if (token.type === 'html') {
        const t = tagName(token.text)
        if (t?.closing && t.name === skipping) skipping = null
      }
      continue
    }
    switch (token.type) {
      case 'text':
      case 'escape':
        if ('tokens' in token && token.tokens?.length) runs.push(...inlineRuns(token.tokens, ctx, style, images))
        else push(decodeEntities(token.text))
        break
      case 'strong':
        runs.push(...inlineRuns(token.tokens, ctx, { ...style, bold: true }, images))
        break
      case 'del':
        runs.push(...inlineRuns(token.tokens, ctx, { ...style, strike: true }, images))
        break
      case 'em':
        addIssue(ctx.issues, 'italic')
        runs.push(...inlineRuns(token.tokens, ctx, style, images))
        break
      case 'codespan':
        addIssue(ctx.issues, 'code')
        push(decodeEntities(token.text))
        break
      case 'br':
        push('\n')
        break
      case 'link': {
        const href = safeHref(decodeEntities((token as Tokens.Link).href))
        if (!href) addIssue(ctx.issues, 'unsafeLink')
        runs.push(...inlineRuns(token.tokens, ctx, href ? { ...style, href } : style, images))
        break
      }
      case 'image': {
        const img = decodeDataImage((token as Tokens.Image).href)
        if (img) {
          const key = `md-${ctx.images.size + 1}`
          ctx.images.set(key, img)
          images.push(key)
        } else {
          addIssue(ctx.issues, 'externalImage')
          push('[画像]')
        }
        break
      }
      case 'html': {
        // HTML のタグは読み飛ばす(<br> は改行)。<script> などは閉じタグまで中身ごと読み飛ばす
        const t = tagName(token.text)
        if (t?.name === 'br') {
          push('\n')
          break
        }
        addIssue(ctx.issues, 'html')
        if (t && !t.closing && SKIP_CONTENT_TAGS.includes(t.name) && !/\/\s*>\s*$/.test(token.text)) skipping = t.name
        else if (!t) push(htmlToText(token.text).text)
        break
      }
      default:
        if ('tokens' in token && token.tokens) runs.push(...inlineRuns(token.tokens, ctx, style, images))
        else if ('text' in token && typeof token.text === 'string') push(decodeEntities(token.text))
    }
  }
  return runs
}

/** Run の並びを改行で分ける(表のセルの中の <br> は段落の区切りにする) */
function splitLines(runs: Run[]): Run[][] {
  const lines: Run[][] = [[]]
  for (const r of runs) {
    r.text.split('\n').forEach((text, i) => {
      if (i > 0) lines.push([])
      if (text) lines[lines.length - 1].push({ ...r, text })
    })
  }
  return lines
}

/** 段落など(文字のトークン)をブロックにする。中の画像は段落のあとに置く */
function pushText(out: ImportBlock[], tokens: Token[] | undefined, ctx: Ctx, make: (runs: Run[]) => ImportBlock) {
  const images: string[] = []
  const runs = inlineRuns(tokens, ctx, {}, images)
  if (images.length === 0 || runs.some((r) => r.text.trim())) out.push(make(runs))
  for (const key of images) out.push({ kind: 'image', key })
}

function listBlocks(out: ImportBlock[], list: Tokens.List, depth: number, ctx: Ctx) {
  const kind: ListKind = list.items.some((it) => it.task) ? 'task' : list.ordered ? 'ordered' : 'bullet'
  const listId = ctx.nextListId++
  const start = typeof list.start === 'number' ? list.start : Number(list.start) || 1
  list.items.forEach((item, i) => {
    let first = true
    const base = { kind: 'listItem' as const, list: kind, depth, listId, number: start + i, checked: !!item.checked }
    for (const child of item.tokens) {
      if (child.type === 'checkbox' || child.type === 'space') continue
      if (child.type === 'list') {
        if (first) {
          out.push({ ...base, continued: false, runs: [] })
          first = false
        }
        listBlocks(out, child as Tokens.List, depth + 1, ctx)
        continue
      }
      if (child.type === 'text' || child.type === 'paragraph') {
        const continued = !first
        pushText(out, (child as Tokens.Text).tokens ?? [{ type: 'text', raw: child.raw, text: (child as Tokens.Text).text }], ctx, (runs) => ({
          ...base,
          continued,
          runs,
        }))
        first = false
        continue
      }
      // 項目の中の表・見出しなどは、リストの外に出す
      blockTokens(out, [child], ctx)
    }
    if (first) out.push({ ...base, continued: false, runs: [] })
  })
}

function tableBlock(token: Tokens.Table, ctx: Ctx): ImportBlock {
  const cell = (c: Tokens.TableCell): TableCellBlock => {
    const images: string[] = []
    const paragraphs = splitLines(inlineRuns(c.tokens, ctx, {}, images))
    // 表の中には画像を入れられないので、文字にする
    if (images.length) paragraphs.push(images.map(() => ({ text: '[画像]' })))
    return { paragraphs, bg: null }
  }
  return { kind: 'table', rows: [token.header.map(cell), ...token.rows.map((r) => r.map(cell))] }
}

/** ブロックのトークンを、読み込みのブロックにする */
function blockTokens(out: ImportBlock[], tokens: Token[], ctx: Ctx) {
  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const depth = (token as Tokens.Heading).depth
        if (depth > 3) addIssue(ctx.issues, 'deepHeading')
        const level = Math.min(3, depth) as 1 | 2 | 3
        pushText(out, token.tokens, ctx, (runs) => ({ kind: 'heading', level, runs: runs.map((r) => ({ ...r, text: r.text.replace(/\n/g, ' ') })) }))
        break
      }
      case 'paragraph':
      case 'text':
        pushText(out, (token as Tokens.Paragraph).tokens, ctx, (runs) => ({ kind: 'paragraph', runs }))
        break
      case 'list':
        listBlocks(out, token as Tokens.List, 0, ctx)
        break
      case 'table':
        out.push(tableBlock(token as Tokens.Table, ctx))
        break
      case 'blockquote':
        // 付箋ではない引用は、中身を普通の段落にする
        addIssue(ctx.issues, 'quote')
        blockTokens(out, (token as Tokens.Blockquote).tokens, ctx)
        break
      case 'code':
        // コードは、1行を1つの段落にする(普通の文字)
        addIssue(ctx.issues, 'code')
        for (const line of (token as Tokens.Code).text.split('\n')) out.push({ kind: 'paragraph', runs: line ? [{ text: line }] : [] })
        break
      case 'html': {
        // HTML のまとまりは、タグを読み飛ばして文字だけ残す
        const { text } = htmlToText(token.text)
        addIssue(ctx.issues, 'html')
        for (const line of text.split('\n')) if (line.trim()) out.push({ kind: 'paragraph', runs: [{ text: line.trim() }] })
        break
      }
      case 'space':
      case 'def':
      case 'hr':
        break
      default:
        if ('tokens' in token && token.tokens) blockTokens(out, token.tokens, ctx)
        else if ('text' in token && typeof token.text === 'string' && token.text.trim())
          out.push({ kind: 'paragraph', runs: [{ text: decodeEntities(token.text) }] })
    }
  }
}

/** 付箋の見出し(「**付箋(色)**」だけの段落)なら、その色 */
function stickyHead(token: Token | undefined) {
  if (token?.type !== 'paragraph') return null
  const inner = (token as Tokens.Paragraph).tokens
  if (inner.length !== 1 || inner[0].type !== 'strong') return null
  return parseStickyLabel((inner[0] as Tokens.Strong).text)
}

/** 1ページ分のトークンを、本文と付箋に分ける */
function parsePage(tokens: Token[], ctx: Ctx): ImportedPage {
  const page = emptyPage()
  const rest = tokens.filter((t) => t.type !== 'space')
  const body: Token[] = []
  for (let i = 0; i < rest.length; i++) {
    const color = stickyHead(rest[i])
    // 付箋の見出しのすぐあとに引用があるときだけ、付箋として読む
    if (color && rest[i + 1]?.type === 'blockquote') {
      let j = i + 1
      // 古い書き出し(色なし)は、見出し1つのあとに付箋の数だけ引用が続く。色は黄色
      do {
        const blocks: ImportBlock[] = []
        blockTokens(blocks, (rest[j] as Tokens.Blockquote).tokens, ctx)
        page.stickies.push({ color: color === 'legacy' ? 'yellow' : color, blocks })
        j++
      } while (color === 'legacy' && rest[j]?.type === 'blockquote')
      i = j - 1
      continue
    }
    body.push(rest[i])
  }
  blockTokens(page.blocks, body, ctx)
  return page
}

export function parseMarkdown(src: string): ImportedDoc {
  const ctx: Ctx = { issues: new Map(), images: new Map(), nextListId: 1 }
  const text = stripFrontMatter(src.replace(/^﻿/, '').replace(/\r\n?/g, '\n'))
  const tokens = new Lexer({ gfm: true }).lex(text)

  // 区切り線(---)でページを分ける
  const chunks: Token[][] = [[]]
  for (const t of tokens) {
    if (t.type === 'hr') chunks.push([])
    else chunks[chunks.length - 1].push(t)
  }
  const pages = chunks.map((c) => parsePage(c, ctx))

  // 先頭が大見出し(# )なら、それをノート名にして本文から外す
  let title: string | null = null
  const head = pages[0].blocks[0]
  const firstToken = chunks[0].find((t) => t.type !== 'space')
  if (head?.kind === 'heading' && head.level === 1 && firstToken?.type === 'heading' && (firstToken as Tokens.Heading).depth === 1) {
    title = head.runs.map((r) => r.text).join('').trim() || null
    pages[0].blocks.shift()
  }
  return { title, pages, images: ctx.images, issues: ctx.issues }
}
