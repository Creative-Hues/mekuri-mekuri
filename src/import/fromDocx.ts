import JSZip from 'jszip'
import type { CellAlign, ListKind, Run, TableCellBlock } from '../export/model'
import { TABLE_HEAD_HEX } from '../export/colors'
import type { LineStyleName } from '../editor/palette'
import { parseStickyLabel } from '../export/stickyLabel'
import { highlightColor, nearestMarkerColor, nearestTextColor } from './colors'
import {
  addIssue,
  emptyPage,
  ImportError,
  safeHref,
  type ImportBlock,
  type ImportedDoc,
  type ImportedPage,
  type ImportedSticky,
  type Issues,
  type PendingImage,
} from './model'

/**
 * Word(.docx)の読み込み。.docx は zip なので jszip で開き、中の XML をブラウザの DOMParser で読む。
 * XML は「文字と属性を読むだけ」で、HTML として画面に入れたり、中の何かを動かしたりはしない。
 * このファイルは jszip を使うので、Word を読み込むときだけ読み込む(importFiles.ts)
 *
 * - 改ページ(改ページの記号・「段落の前で改ページ」・次のページから始まるセクション区切り)でページを分ける。
 *   Word が表示のために入れる区切り(lastRenderedPageBreak)は使わない
 * - 見出し(見出し1〜3・アウトラインレベル)・箇条書き・番号付き・ToDo(「□」「■」「☐」「☒」で始まる段落)
 * - 太字・取り消し線・下線(実線・波線・二重線・点線と色)・文字色・マーカー → めくりめくりの近い色
 * - 表(セルの背景色・結合・列の幅(幅を固定した表だけ)・セルの文字の配置・見出しの行と列)・画像(PNG・JPEG・GIF・WebP・BMP)・Webリンク(http・https・mailto だけ)
 * - 「表題」か、先頭の「見出し1」をノート名にする
 * - 太字の「付箋(色)」(古い書き出しは「付箋」)から下を、そのページの付箋に戻す
 */

/** 読み込めないとき(画面にそのまま出す文) */
const DocxError = ImportError

/** zip の中のファイル1つの大きさの上限(展開すると巨大になるファイル対策) */
const MAX_ENTRY_BYTES = 200 * 1024 * 1024

// ---- XML を読むための小さな道具(名前空間の接頭辞に左右されないよう、localName で比べる) ----

const elementsOf = (el: Element | null | undefined): Element[] => (el ? Array.from(el.children) : [])
const kids = (el: Element | null | undefined, name: string) => elementsOf(el).filter((c) => c.localName === name)
const kid = (el: Element | null | undefined, name: string) => elementsOf(el).find((c) => c.localName === name) ?? null
const descendants = (el: Element | Document, name: string) => Array.from(el.getElementsByTagNameNS('*', name))

/** 属性(「w:val」の「val」のように、接頭辞を除いた名前で探す) */
function attr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null
  for (const a of Array.from(el.attributes)) if (a.localName === name) return a.value
  return null
}

/** オン/オフの設定(<w:b/> はオン、<w:b w:val="0"/> はオフ) */
function isOn(el: Element | null | undefined): boolean {
  if (!el) return false
  const v = attr(el, 'val')
  return v === null || !['0', 'false', 'off', 'none'].includes(v)
}

function parseXml(xml: string): Document {
  // DOCTYPE(実体の定義など)は .docx には使われないので、含むものは読まない
  if (/<!DOCTYPE/i.test(xml)) throw new DocxError('Word のファイルの中に読み込めない内容がありました')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) throw new DocxError('Word のファイルが壊れている可能性があります')
  return doc
}

async function readText(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path)
  if (!file) return null
  checkSize(file)
  return file.async('string')
}

function checkSize(file: JSZip.JSZipObject) {
  // jszip が読み取った「展開後の大きさ」(公開されていない項目なので、なければ確かめない)
  const size = (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
  if (typeof size === 'number' && size > MAX_ENTRY_BYTES) throw new DocxError('Word のファイルの中身が大きすぎます')
}

/** 関係(rels)の参照先を zip の中の場所にする(「media/a.png」→「word/media/a.png」) */
function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = base.split('/').filter(Boolean)
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

interface Rel {
  type: string
  target: string
  external: boolean
}

async function readRels(zip: JSZip, path: string): Promise<Map<string, Rel>> {
  const rels = new Map<string, Rel>()
  const xml = await readText(zip, path)
  if (!xml) return rels
  for (const r of descendants(parseXml(xml), 'Relationship')) {
    const id = attr(r, 'Id')
    if (!id) continue
    rels.set(id, { type: attr(r, 'Type') ?? '', target: attr(r, 'Target') ?? '', external: attr(r, 'TargetMode') === 'External' })
  }
  return rels
}

// ---- スタイル・段落番号 ----

interface StyleInfo {
  name: string
  basedOn: string | null
  pPr: Element | null
  rPr: Element | null
}

function readStyles(doc: Document | null): Map<string, StyleInfo> {
  const styles = new Map<string, StyleInfo>()
  if (!doc) return styles
  for (const s of descendants(doc, 'style')) {
    const id = attr(s, 'styleId')
    if (!id) continue
    styles.set(id, {
      name: (attr(kid(s, 'name'), 'val') ?? '').toLowerCase(),
      basedOn: attr(kid(s, 'basedOn'), 'val'),
      pPr: kid(s, 'pPr'),
      rPr: kid(s, 'rPr'),
    })
  }
  return styles
}

interface Level {
  bullet: boolean
  start: number
}

interface Numbering {
  /** numId → 段ごとの設定 */
  levels: Map<string, Map<number, Level>>
}

function readNumbering(doc: Document | null): Numbering {
  const levels = new Map<string, Map<number, Level>>()
  if (!doc) return { levels }
  const abstracts = new Map<string, Map<number, Level>>()
  for (const a of descendants(doc, 'abstractNum')) {
    const map = new Map<number, Level>()
    for (const lvl of kids(a, 'lvl')) {
      map.set(Number(attr(lvl, 'ilvl')) || 0, {
        bullet: attr(kid(lvl, 'numFmt'), 'val') === 'bullet',
        start: Number(attr(kid(lvl, 'start'), 'val') ?? 1) || 1,
      })
    }
    abstracts.set(attr(a, 'abstractNumId') ?? '', map)
  }
  for (const n of descendants(doc, 'num')) {
    const base = abstracts.get(attr(kid(n, 'abstractNumId'), 'val') ?? '') ?? new Map<number, Level>()
    const map = new Map(base)
    for (const o of kids(n, 'lvlOverride')) {
      const ilvl = Number(attr(o, 'ilvl')) || 0
      const start = attr(kid(o, 'startOverride'), 'val')
      if (start !== null) map.set(ilvl, { bullet: map.get(ilvl)?.bullet ?? false, start: Number(start) || 1 })
    }
    levels.set(attr(n, 'numId') ?? '', map)
  }
  return { levels }
}

// ---- 読み取りの途中の状態 ----

interface Ctx {
  zip: JSZip
  rels: Map<string, Rel>
  styles: Map<string, StyleInfo>
  numbering: Numbering
  issues: Issues
  /** 読み込む画像(key → zip の中の場所) */
  imagePaths: Map<string, { path: string; mime: string }>
  /** 複合フィールド(HYPERLINK など)の入れ子。href はリンク先(リンクでなければ null)、result は結果の部分を読んでいるか */
  fields: { href: string | null; instr: string; result: boolean }[]
}

/** 段落の中身(文字・画像・改ページ) */
type Item = { run: Run } | { image: string } | { pageBreak: true }

interface RunStyle {
  bold?: boolean
  strike?: boolean
  color?: Run['color']
  marker?: Run['marker']
  line?: Run['line']
  italic?: boolean
}

const LINE_STYLES: Record<string, LineStyleName | null> = {
  single: 'solid',
  words: 'solid',
  thick: 'solid',
  double: 'double',
  wave: 'wavy',
  wavyHeavy: 'wavy',
  wavyDouble: 'wavy',
  dotted: 'dotted',
  dottedHeavy: 'dotted',
  dash: 'dotted',
  dashedHeavy: 'dotted',
  dashLong: 'dotted',
  dashLongHeavy: 'dotted',
  dotDash: 'dotted',
  dashDotHeavy: 'dotted',
  dotDotDash: 'dotted',
  dashDotDotHeavy: 'dotted',
  none: null,
}

/** 文字の設定(rPr)を読む。前の設定(文字スタイル)に重ねる */
function applyRPr(rPr: Element | null, base: RunStyle, ctx: Ctx): RunStyle {
  if (!rPr) return base
  const s: RunStyle = { ...base }
  for (const p of elementsOf(rPr)) {
    switch (p.localName) {
      case 'b':
        s.bold = isOn(p)
        break
      case 'strike':
      case 'dstrike':
        s.strike = isOn(p)
        break
      case 'i':
        s.italic = isOn(p)
        break
      case 'color': {
        const c = nearestTextColor(attr(p, 'val'))
        if (c) s.color = c
        else delete s.color
        break
      }
      case 'highlight': {
        const m = highlightColor(attr(p, 'val'))
        if (m) s.marker = m
        else delete s.marker
        break
      }
      case 'shd': {
        const m = nearestMarkerColor(attr(p, 'fill'))
        if (m) s.marker = m
        break
      }
      case 'u': {
        const style = LINE_STYLES[attr(p, 'val') ?? 'single'] ?? null
        if (style) s.line = { style, color: nearestTextColor(attr(p, 'color')) }
        else delete s.line
        break
      }
      case 'sz':
        ctx.issues.set('layout', 1)
        break
      case 'rFonts':
        // 書体の指定があるとき(「hint」だけのものは書体の指定ではない)
        if (['ascii', 'eastAsia', 'hAnsi', 'asciiTheme', 'eastAsiaTheme'].some((a) => attr(p, a))) ctx.issues.set('layout', 1)
        break
    }
  }
  return s
}

/** 文字スタイル(rStyle)をたどって、文字の設定を作る(Hyperlink のスタイルは使わない) */
function styleRun(styleId: string | null, ctx: Ctx, seen = new Set<string>()): RunStyle {
  if (!styleId || seen.has(styleId)) return {}
  seen.add(styleId)
  const st = ctx.styles.get(styleId)
  if (!st || st.name === 'hyperlink') return {}
  return applyRPr(st.rPr, styleRun(st.basedOn, ctx, seen), ctx)
}

function makeRun(text: string, s: RunStyle, href: string | null): Run {
  const run: Run = { text }
  if (s.bold) run.bold = true
  if (s.strike) run.strike = true
  if (s.color) run.color = s.color
  if (s.marker) run.marker = s.marker
  if (s.line) run.line = s.line
  if (href) run.href = href
  return run
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
}

/** 画像(<w:drawing> の中の a:blip)を読み込む予定に入れる。読めない形式なら null */
function imageItem(el: Element, ctx: Ctx): Item | null {
  const blip = descendants(el, 'blip')[0] ?? descendants(el, 'imagedata')[0]
  if (!blip) return null
  const embed = attr(blip, 'embed') ?? attr(blip, 'id')
  const link = attr(blip, 'link')
  const rel = embed ? ctx.rels.get(embed) : link ? ctx.rels.get(link) : undefined
  if (!rel) {
    addIssue(ctx.issues, 'brokenImage')
    return { run: { text: '[画像]' } }
  }
  if (rel.external || !embed) {
    addIssue(ctx.issues, 'externalImage')
    return { run: { text: '[画像]' } }
  }
  const path = resolvePath('', rel.target)
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? ''
  const mime = IMAGE_MIME[ext]
  if (!mime) {
    addIssue(ctx.issues, 'unsupportedImage')
    return { run: { text: '[画像]' } }
  }
  const key = `docx-${ctx.imagePaths.size + 1}`
  ctx.imagePaths.set(key, { path, mime })
  return { image: key }
}

/** 図形・グラフなど(画像でない描画)か */
function isShapeDrawing(el: Element): boolean {
  const data = descendants(el, 'graphicData')[0]
  const uri = attr(data, 'uri') ?? ''
  return !uri.endsWith('/picture')
}

/** 今のフィールドのリンク先(HYPERLINK の結果の部分を読んでいるとき) */
const fieldHref = (ctx: Ctx) => {
  for (let i = ctx.fields.length - 1; i >= 0; i--) if (ctx.fields[i].result && ctx.fields[i].href) return ctx.fields[i].href
  return null
}
/** フィールドの命令の部分(結果ではない部分)を読んでいるか */
const inFieldInstr = (ctx: Ctx) => ctx.fields.some((f) => !f.result)

/** フィールドの命令(HYPERLINK "https://…")からリンク先を取り出す */
function hyperlinkOfField(instr: string, ctx: Ctx): string | null {
  const m = /^\s*HYPERLINK\s+(?:"([^"]*)"|(\S+))(.*)$/i.exec(instr)
  if (!m) return null
  // 「\l」は文書の中の場所へのリンク(開けないので文字だけ)
  if (/\\l\b/.test(m[3])) return null
  const href = safeHref(m[1] ?? m[2] ?? '')
  if (!href) addIssue(ctx.issues, 'unsafeLink')
  return href
}

/** 1つの文字のまとまり(<w:r>)を読む */
function readRun(r: Element, base: RunStyle, href: string | null, ctx: Ctx, out: Item[]) {
  const rPr = kid(r, 'rPr')
  let style = applyRPr(rPr, { ...base, ...styleRun(attr(kid(rPr, 'rStyle'), 'val'), ctx) }, ctx)
  // リンクの文字の「普通の下線」は、リンクの見た目なので線にしない
  if ((href || fieldHref(ctx)) && style.line?.style === 'solid' && !style.line.color) {
    style = { ...style }
    delete style.line
  }
  if (style.italic) addIssue(ctx.issues, 'italic')
  const push = (text: string) => {
    if (inFieldInstr(ctx)) return
    out.push({ run: makeRun(text, style, href ?? fieldHref(ctx)) })
  }

  for (const c of elementsOf(r)) {
    switch (c.localName) {
      case 't':
        push(c.textContent ?? '')
        break
      case 'tab':
        push(' ')
        break
      case 'br':
        if (attr(c, 'type') === 'page') out.push({ pageBreak: true })
        else push('\n')
        break
      case 'cr':
        push('\n')
        break
      case 'noBreakHyphen':
        push('-')
        break
      case 'sym': {
        // Wingdings のチェックボックス
        const ch = (attr(c, 'char') ?? '').toUpperCase()
        if (ch === 'F06F' || ch === 'F0A8') push('☐')
        else if (ch === 'F0FE' || ch === 'F078') push('☒')
        break
      }
      case 'fldChar': {
        const type = attr(c, 'fldCharType')
        if (type === 'begin') ctx.fields.push({ href: null, instr: '', result: false })
        else if (type === 'separate') {
          const f = ctx.fields[ctx.fields.length - 1]
          if (f) {
            f.href = hyperlinkOfField(f.instr, ctx)
            f.result = true
          }
        } else if (type === 'end') ctx.fields.pop()
        break
      }
      case 'instrText': {
        const f = ctx.fields[ctx.fields.length - 1]
        if (f && !f.result) f.instr += c.textContent ?? ''
        break
      }
      case 'drawing':
      case 'pict':
      case 'object': {
        if (inFieldInstr(ctx)) break
        if (c.localName === 'object' || (c.localName === 'drawing' && isShapeDrawing(c)) || descendants(c, 'txbxContent').length) {
          addIssue(ctx.issues, 'shape')
          break
        }
        const item = imageItem(c, ctx)
        if (item) out.push(item)
        else addIssue(ctx.issues, 'shape')
        break
      }
      case 'AlternateContent': {
        // 新しい形(Choice)と古い形(Fallback)の両方がある。中身は図形・テキストボックスのことが多いが、画像なら読む
        const drawing = descendants(kid(c, 'Choice') ?? c, 'drawing')[0]
        const item = drawing && !isShapeDrawing(drawing) && !descendants(drawing, 'txbxContent').length ? imageItem(drawing, ctx) : null
        if (item && !inFieldInstr(ctx)) out.push(item)
        else addIssue(ctx.issues, 'shape')
        break
      }
      case 'footnoteReference':
      case 'endnoteReference':
        addIssue(ctx.issues, 'footnote')
        break
      case 'commentReference':
        addIssue(ctx.issues, 'comment')
        break
    }
  }
}

/** 段落の中(<w:p>・<w:hyperlink>・<w:ins> など)を読む */
function readInline(parent: Element, base: RunStyle, href: string | null, ctx: Ctx, out: Item[]) {
  for (const c of elementsOf(parent)) {
    switch (c.localName) {
      case 'r':
        readRun(c, base, href, ctx, out)
        break
      case 'hyperlink': {
        const id = attr(c, 'id')
        const rel = id ? ctx.rels.get(id) : undefined
        let link: string | null = null
        if (rel) {
          link = rel.external ? safeHref(rel.target) : null
          if (!link) addIssue(ctx.issues, 'unsafeLink')
        }
        // 文書の中の場所へのリンク(w:anchor。目次など)は、開けないので文字だけにする
        readInline(c, base, link ?? href, ctx, out)
        break
      }
      case 'ins':
      case 'moveTo':
        ctx.issues.set('revision', 1)
        readInline(c, base, href, ctx, out)
        break
      case 'del':
      case 'moveFrom':
        // 変更履歴で消された文字は入れない
        ctx.issues.set('revision', 1)
        break
      case 'smartTag':
      case 'customXml':
      case 'fldSimple':
      case 'dir':
      case 'bdo':
        if (c.localName === 'fldSimple') {
          const link = hyperlinkOfField(attr(c, 'instr') ?? '', ctx)
          readInline(c, base, link ?? href, ctx, out)
        } else readInline(c, base, href, ctx, out)
        break
      case 'sdt':
        readInline(kid(c, 'sdtContent') ?? c, base, href, ctx, out)
        break
      case 'oMath':
      case 'oMathPara':
        addIssue(ctx.issues, 'shape')
        break
      case 'AlternateContent':
        addIssue(ctx.issues, 'shape')
        break
    }
  }
}

// ---- 段落の設定 ----

interface ParaInfo {
  /** 見出しの段(1〜)。表題は 0。見出しでなければ null */
  heading: number | null
  numId: string | null
  ilvl: number
  indentLeft: number
  pageBreakBefore: boolean
  /** 段落のあとで新しいページが始まる(次のページから始まるセクション区切り) */
  sectionBreakAfter: boolean
}

/** 段落スタイルをたどって、見出し・段落番号・改ページの設定を集める */
function paraInfo(p: Element, ctx: Ctx): ParaInfo {
  const pPr = kid(p, 'pPr')
  const info: ParaInfo = { heading: null, numId: null, ilvl: 0, indentLeft: 0, pageBreakBefore: false, sectionBreakAfter: false }
  // スタイルの設定 → 段落の設定 の順に重ねる(あとのものが優先)
  const chain: Element[] = []
  const seen = new Set<string>()
  let styleId = attr(kid(pPr, 'pStyle'), 'val')
  while (styleId && !seen.has(styleId)) {
    seen.add(styleId)
    const st = ctx.styles.get(styleId)
    if (!st) break
    if (info.heading === null) {
      if (st.name === 'title') info.heading = 0
      const m = /^heading\s*(\d)$/.exec(st.name)
      if (m) info.heading = Number(m[1])
    }
    if (st.pPr) chain.unshift(st.pPr)
    styleId = st.basedOn
  }
  if (pPr) chain.push(pPr)
  let outline: number | null = null
  for (const pp of chain) {
    const lvl = attr(kid(pp, 'outlineLvl'), 'val')
    if (lvl !== null) outline = Number(lvl)
    const numPr = kid(pp, 'numPr')
    if (numPr) {
      const numId = attr(kid(numPr, 'numId'), 'val')
      if (numId !== null) info.numId = numId === '0' ? null : numId
      const ilvl = attr(kid(numPr, 'ilvl'), 'val')
      if (ilvl !== null) info.ilvl = Number(ilvl) || 0
    }
    const ind = kid(pp, 'ind')
    const left = attr(ind, 'left') ?? attr(ind, 'start')
    if (left !== null) info.indentLeft = Number(left) || 0
    const pbb = kid(pp, 'pageBreakBefore')
    if (pbb) info.pageBreakBefore = isOn(pbb)
  }
  if (info.heading === null && outline !== null && outline >= 0 && outline < 9) info.heading = outline + 1
  const jc = attr(kid(pPr, 'jc'), 'val')
  if (jc && ['center', 'right', 'end', 'distribute'].includes(jc)) ctx.issues.set('layout', 1)
  const sect = kid(pPr, 'sectPr')
  if (sect) {
    const type = attr(kid(sect, 'type'), 'val') ?? 'nextPage'
    info.sectionBreakAfter = type !== 'continuous'
    if (Number(attr(kid(sect, 'cols'), 'num') ?? 1) > 1) ctx.issues.set('layout', 1)
  }
  return info
}

// ---- 本文を組み立てる ----

const TASK_MARK = /^([□■☐☑☒])[ 　]?/
const plain = (runs: Run[]) => runs.map((r) => r.text).join('')
const hasText = (runs: Run[]) => runs.some((r) => r.text.trim())

/** 段落の頭の ToDo の記号を外す。ToDo でなければ null */
function takeTaskMark(runs: Run[]): { checked: boolean; runs: Run[] } | null {
  const first = runs.find((r) => r.text)
  const m = first ? TASK_MARK.exec(first.text) : null
  if (!first || !m) return null
  const rest = runs.slice(runs.indexOf(first))
  rest[0] = { ...first, text: first.text.slice(m[0].length) }
  // 記号と空白が別のまとまりのときは、次のまとまりの頭の空白も外す
  if (!rest[0].text && m[0].length === 1 && rest[1]) rest[1] = { ...rest[1], text: rest[1].text.replace(/^[ 　]/, '') }
  return { checked: m[1] !== '□' && m[1] !== '☐', runs: rest.filter((r) => r.text) }
}

class Builder {
  pages: ImportedPage[] = [emptyPage()]
  title: string | null = null
  private lists: { key: string; kind: ListKind; id: number }[] = []
  private counters = new Map<string, number[]>()
  private nextListId = 1
  private lastWasTable = false
  private lastList: { depth: number } | null = null

  constructor(readonly ctx: Ctx) {}

  get page() {
    return this.pages[this.pages.length - 1]
  }

  /** 今のページに、まだ何も入っていないか */
  private pageIsEmpty() {
    return this.page.blocks.length === 0 && this.page.stickies.length === 0
  }

  /**
   * 新しいページを始める。ファイルの頭(表題もまだないとき)の改ページは無視する。
   * soft:「段落の前で改ページ」のように、今のページが空なら新しいページにしないもの
   */
  newPage(soft = false) {
    if (this.pageIsEmpty() && (soft || (this.pages.length === 1 && this.title === null))) return
    this.pages.push(emptyPage())
    this.resetList()
    this.lastWasTable = false
  }

  private resetList() {
    this.lists = []
    this.lastList = null
  }

  private push(block: ImportBlock) {
    this.page.blocks.push(block)
    this.lastWasTable = block.kind === 'table'
  }

  /** 段落を1つ入れる */
  paragraph(p: Element) {
    const info = paraInfo(p, this.ctx)
    if (info.pageBreakBefore) this.newPage(true)
    const items: Item[] = []
    readInline(p, {}, null, this.ctx, items)

    // 改ページで区切られた部分ごとに分ける
    const parts: { runs: Run[]; images: string[] }[] = [{ runs: [], images: [] }]
    for (const item of items) {
      const part = parts[parts.length - 1]
      if ('run' in item) part.runs.push(item.run)
      else if ('image' in item) part.images.push(item.image)
      else parts.push({ runs: [], images: [] })
    }

    parts.forEach((part, i) => {
      if (i > 0) this.newPage()
      if (hasText(part.runs)) this.block(info, part.runs, i === 0)
      else if (parts.length === 1 && part.images.length === 0) {
        // 文字のない段落は空の段落として残す。ただし表のすぐ後ろの空の段落(Word で表どうしを離すためのもの)は入れない
        if (this.lastWasTable) this.lastWasTable = false
        else this.block(info, [], true)
      }
      for (const key of part.images) this.push({ kind: 'image', key })
    })
    if (info.sectionBreakAfter) this.newPage()
  }

  /** 段落の中身を、見出し・リスト・段落にして入れる */
  private block(info: ParaInfo, runs: Run[], firstPart: boolean) {
    const ctx = this.ctx
    // 先頭(空の段落の前置きは除く)の表題か見出し1は、ノート名にする
    if ((info.heading === 0 || info.heading === 1) && firstPart && hasText(runs) && this.title === null && this.pages.length === 1) {
      const blocks = this.page.blocks
      if (this.page.stickies.length === 0 && blocks.every((blk) => blk.kind === 'paragraph' && !hasText(blk.runs))) {
        this.title = plain(runs).replace(/\s+/g, ' ').trim()
        blocks.length = 0
        return
      }
    }
    if (info.heading !== null && hasText(runs)) {
      if (info.heading > 3) addIssue(ctx.issues, 'deepHeading')
      const level = Math.min(3, Math.max(1, info.heading)) as 1 | 2 | 3
      this.resetList()
      this.push({ kind: 'heading', level, runs: runs.map((r) => ({ ...r, text: r.text.replace(/\n/g, ' ') })) })
      return
    }

    // 段落番号の付いた段落
    const levels = info.numId ? ctx.numbering.levels.get(info.numId) : undefined
    if (info.numId && levels) {
      const lvl = levels.get(info.ilvl) ?? { bullet: true, start: 1 }
      const task = lvl.bullet ? takeTaskMark(runs) : null
      const kind: ListKind = task ? 'task' : lvl.bullet ? 'bullet' : 'ordered'
      // 番号:同じ番号の設定の中で数える(上の段の項目が来たら、下の段は数え直す)
      const counts = this.counters.get(info.numId) ?? []
      counts[info.ilvl] = (counts[info.ilvl] ?? lvl.start - 1) + 1
      counts.length = info.ilvl + 1
      this.counters.set(info.numId, counts)
      this.listItem(kind, info.ilvl, info.numId, counts[info.ilvl], task?.checked ?? false, task?.runs ?? runs)
      return
    }

    // 「□」「■」で始まる段落は ToDo(めくりめくりの書き出し・手で書いたもの)
    const task = takeTaskMark(runs)
    if (task) {
      const depth = Math.max(0, Math.round(info.indentLeft / 420) - 1)
      this.listItem('task', depth, 'task', 1, task.checked, task.runs)
      return
    }

    // 字下げした段落がリストのすぐ後ろにあれば、その項目の2段落目
    if (this.lastList && info.indentLeft >= 300 && hasText(runs)) {
      const depth = Math.min(this.lastList.depth, Math.max(0, Math.round(info.indentLeft / 420) - 1))
      const list = this.lists[depth]
      if (list) {
        this.push({ kind: 'listItem', list: list.kind, depth, listId: list.id, number: 1, checked: false, continued: true, runs })
        return
      }
    }

    this.resetList()
    this.push({ kind: 'paragraph', runs })
  }

  private listItem(kind: ListKind, depth: number, key: string, number: number, checked: boolean, runs: Run[]) {
    const d = Math.min(depth, this.lists.length)
    const cur = this.lists[d]
    if (!cur || cur.key !== key || cur.kind !== kind) this.lists[d] = { key, kind, id: this.nextListId++ }
    this.lists.length = d + 1
    this.push({ kind: 'listItem', list: kind, depth: d, listId: this.lists[d].id, number, checked, continued: false, runs })
    this.lastList = { depth: d }
  }

  /**
   * 表を入れる。
   * - 横の結合(gridSpan)・縦の結合(vMerge)は、そのまま結合したセルにする
   * - 列の幅は、幅を固定した表(w:tblLayout が fixed)だけ w:gridCol から読む(自動で合わせる表は中身に合わせる)
   * - セルの段落の配置(w:jc)がすべて同じ中央・右なら、セルの配置にする
   * - 見出しの行:1行目が「各ページの先頭に繰り返す」(w:tblHeader)か、1行目のセルがすべて見出しの色。
   *   見出しの列:2行以上あり、各行の1列目のセルがすべて見出しの色。見出しの色(TABLE_HEAD_HEX)はセルの色にしない
   */
  table(tbl: Element) {
    const ctx = this.ctx
    const images: string[] = []
    const rows: TableCellBlock[][] = []
    /** マスごとの、そのマスのセル(縦の結合で、下のマスから上のセルを探すため) */
    const grid: (TableCellBlock | undefined)[][] = []
    /** 見出しの色のセル */
    const headFill = new Set<TableCellBlock>()
    /** セルの左上のマスの列 */
    const colOf = new Map<TableCellBlock, number>()
    let firstRowRepeats = false
    kids(tbl, 'tr').forEach((tr, r) => {
      const row: TableCellBlock[] = []
      grid[r] = []
      if (r === 0 && isOn(kid(kid(tr, 'trPr'), 'tblHeader'))) firstRowRepeats = true
      let c = Number(attr(kid(kid(tr, 'trPr'), 'gridBefore'), 'val') ?? 0) || 0
      for (const tc of tableCells(tr)) {
        const tcPr = kid(tc, 'tcPr')
        const span = Math.max(1, Number(attr(kid(tcPr, 'gridSpan'), 'val') ?? 1) || 1)
        const vMerge = kid(tcPr, 'vMerge')
        const continued = !!vMerge && (attr(vMerge, 'val') ?? 'continue') === 'continue'
        const above = continued ? grid[r - 1]?.[c] : undefined
        if (above) {
          // 縦の結合の続き:上のセルを1行のばす(このマスにはセルを作らない)
          if ((colOf.get(above) ?? -1) === c) above.rowspan = (above.rowspan ?? 1) + 1
          for (let i = 0; i < span; i++) grid[r][c + i] = above
          c += span
          continue
        }
        const paragraphs: Run[][] = []
        collectCellParagraphs(tc, ctx, paragraphs, images)
        const fill = attr(kid(tcPr, 'shd'), 'fill')
        const isHead = !!fill && fill.replace('#', '').toLowerCase() === TABLE_HEAD_HEX
        const cell: TableCellBlock = { paragraphs, bg: isHead ? null : nearestMarkerColor(fill) }
        if (isHead) headFill.add(cell)
        if (span > 1) cell.colspan = span
        const align = cellAlign(tc)
        if (align) cell.align = align
        colOf.set(cell, c)
        for (let i = 0; i < span; i++) grid[r][c + i] = cell
        row.push(cell)
        c += span
      }
      rows.push(row)
    })
    this.resetList()
    if (rows.length) {
      const first = rows[0]
      const headerRow = firstRowRepeats || (first.length > 0 && first.every((cell) => headFill.has(cell)))
      const firstCol = rows.map((row) => row.find((cell) => colOf.get(cell) === 0)).filter((cell) => !!cell)
      const headerColumn = rows.length >= 2 && firstCol.length > 0 && firstCol.every((cell) => headFill.has(cell))
      // 見出しにならなかった所の見出しの色は、灰色のセルとして残す
      for (const cell of headFill) {
        const inHead = (headerRow && first.includes(cell)) || (headerColumn && colOf.get(cell) === 0)
        if (!inHead) cell.bg = 'gray'
      }
      this.push({ kind: 'table', rows, headerRow, headerColumn, colWidths: fixedColumnWidths(tbl) })
    }
    if (images.length) {
      addIssue(ctx.issues, 'imageInTable', images.length)
      for (const key of images) this.push({ kind: 'image', key })
      this.lastWasTable = true
    }
  }
}

/** 列の幅(px)。幅を固定した表(w:tblLayout が fixed)だけ。そのほかは undefined(中身に合わせる) */
function fixedColumnWidths(tbl: Element): (number | null)[] | undefined {
  if (attr(kid(kid(tbl, 'tblPr'), 'tblLayout'), 'type') !== 'fixed') return undefined
  const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => Number(attr(g, 'w')))
  if (cols.length === 0 || !cols.every((w) => w > 0)) return undefined
  // Word の 15 twip が画面の 1px(96dpi)
  return cols.map((w) => Math.round(w / 15))
}

/** セルの段落の配置(すべて同じ中央・右のときだけ。左・両端・ばらばらは null) */
function cellAlign(tc: Element): CellAlign | null {
  const values = new Set<string>()
  for (const p of kids(tc, 'p')) {
    const jc = attr(kid(kid(p, 'pPr'), 'jc'), 'val') ?? 'left'
    values.add(jc === 'end' ? 'right' : jc === 'start' || jc === 'both' || jc === 'distribute' ? 'left' : jc)
  }
  if (values.size !== 1) return null
  const [v] = values
  return v === 'center' || v === 'right' ? v : null
}

/** 行の中のセル(<w:sdt> などの中にあるものも) */
function tableCells(tr: Element): Element[] {
  return elementsOf(tr).flatMap((c) =>
    c.localName === 'tc' ? [c] : c.localName === 'sdt' || c.localName === 'customXml' ? tableCells(kid(c, 'sdtContent') ?? c) : [],
  )
}

/** セルの中の段落を集める(セルの中の表は、段落にして並べる) */
function collectCellParagraphs(el: Element, ctx: Ctx, out: Run[][], images: string[]) {
  for (const c of elementsOf(el)) {
    if (c.localName === 'p') {
      const items: Item[] = []
      readInline(c, {}, null, ctx, items)
      const runs: Run[] = []
      for (const item of items) {
        if ('run' in item) runs.push(item.run)
        else if ('image' in item) images.push(item.image)
      }
      out.push(runs)
    } else if (c.localName === 'tbl') {
      addIssue(ctx.issues, 'mergedCell')
      for (const tr of kids(c, 'tr')) for (const tc of tableCells(tr)) collectCellParagraphs(tc, ctx, out, images)
    } else if (c.localName === 'sdt') {
      collectCellParagraphs(kid(c, 'sdtContent') ?? c, ctx, out, images)
    }
  }
  // 段落の中の改行は、セルの中では別の段落にする
  const split: Run[][] = []
  for (const runs of out.splice(0)) {
    let line: Run[] = []
    for (const r of runs) {
      r.text.split('\n').forEach((text, i) => {
        if (i > 0) {
          split.push(line)
          line = []
        }
        if (text) line.push({ ...r, text })
      })
    }
    split.push(line)
  }
  // 最後の空の段落(Word のセルは必ず段落で終わる)は、ほかに段落があれば外す
  while (split.length > 1 && split[split.length - 1].length === 0) split.pop()
  out.push(...split)
}

/** 本文(<w:body>)の中のブロックを順に読む */
function readBody(el: Element, b: Builder) {
  for (const c of elementsOf(el)) {
    switch (c.localName) {
      case 'p':
        b.paragraph(c)
        break
      case 'tbl':
        b.table(c)
        break
      case 'sdt':
        readBody(kid(c, 'sdtContent') ?? c, b)
        break
      case 'customXml':
        readBody(c, b)
        break
      case 'AlternateContent':
        addIssue(b.ctx.issues, 'shape')
        break
    }
  }
}

/** ページの後ろの「付箋(色)」から下を付箋にする(太字だけの段落が見出し) */
function splitStickies(page: ImportedPage) {
  const isHead = (blk: ImportBlock) =>
    blk.kind === 'paragraph' && hasText(blk.runs) && blk.runs.every((r) => !r.text.trim() || r.bold) ? parseStickyLabel(plain(blk.runs)) : null
  const start = page.blocks.findIndex((blk) => isHead(blk) !== null)
  if (start < 0) return
  const rest = page.blocks.splice(start)
  const stickies: ImportedSticky[] = []
  let i = 0
  while (i < rest.length) {
    const color = isHead(rest[i])
    let end = i + 1
    while (end < rest.length && isHead(rest[end]) === null) end++
    const blocks = rest.slice(i + 1, end)
    if (color === 'legacy') {
      // 古い書き出し:付箋どうしは空の段落で区切られている。色は黄色
      let chunk: ImportBlock[] = []
      for (const blk of [...blocks, null]) {
        const blank = !blk || (blk.kind === 'paragraph' && !hasText(blk.runs))
        if (!blank) chunk.push(blk!)
        else if (chunk.length) {
          stickies.push({ color: 'yellow', blocks: chunk })
          chunk = []
        }
      }
    } else if (color) {
      stickies.push({ color, blocks })
    }
    i = end
  }
  page.stickies.push(...stickies)
}

/** ヘッダー・フッターに文字があるか */
async function hasHeaderFooter(zip: JSZip, rels: Map<string, Rel>): Promise<boolean> {
  for (const rel of rels.values()) {
    if (!/\/(header|footer)$/.test(rel.type) || rel.external) continue
    const xml = await readText(zip, resolvePath('', rel.target))
    if (xml && descendants(parseXml(xml), 't').some((t) => t.textContent?.trim())) return true
  }
  return false
}

/** zip の中の本文の場所([Content_Types].xml・_rels/.rels から探す。普通は word/document.xml) */
async function mainDocumentPath(zip: JSZip): Promise<string> {
  const rels = await readRels(zip, '_rels/.rels')
  for (const rel of rels.values()) {
    if (rel.type.endsWith('/officeDocument')) return resolvePath('', rel.target)
  }
  return 'word/document.xml'
}

export async function parseDocx(data: ArrayBuffer): Promise<ImportedDoc> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data)
  } catch {
    throw new DocxError('Word のファイルを開けませんでした(壊れているか、パスワードが付いている可能性があります)')
  }
  const docPath = await mainDocumentPath(zip)
  const dir = docPath.includes('/') ? docPath.slice(0, docPath.lastIndexOf('/')) : ''
  const relsPath = `${dir ? `${dir}/` : ''}_rels/${docPath.slice(dir.length ? dir.length + 1 : 0)}.rels`
  const xml = await readText(zip, docPath)
  if (!xml) throw new DocxError('Word の本文が見つかりませんでした')
  const document = parseXml(xml)

  const rels = await readRels(zip, relsPath)
  const relXml = async (suffix: string) => {
    for (const rel of rels.values()) if (rel.type.endsWith(suffix) && !rel.external) return readText(zip, resolvePath(dir, rel.target))
    return null
  }
  const stylesXml = await relXml('/styles')
  const numberingXml = await relXml('/numbering')
  const ctx: Ctx = {
    zip,
    // 画像などの参照先は本文のある場所(word/)から数えるので、zip の頭からの場所(「/word/media/a.png」)に直しておく
    rels: new Map([...rels].map(([id, r]) => [id, r.external ? r : { ...r, target: `/${resolvePath(dir, r.target)}` }])),
    styles: readStyles(stylesXml ? parseXml(stylesXml) : null),
    numbering: readNumbering(numberingXml ? parseXml(numberingXml) : null),
    issues: new Map(),
    imagePaths: new Map(),
    fields: [],
  }

  const body = descendants(document, 'body')[0]
  if (!body) throw new DocxError('Word の本文が見つかりませんでした')
  const builder = new Builder(ctx)
  readBody(body, builder)
  builder.pages.forEach(splitStickies)
  if (await hasHeaderFooter(zip, ctx.rels)) ctx.issues.set('headerFooter', 1)

  // 画像のデータを読む(読めないものは「[画像]」になる)
  const images = new Map<string, PendingImage>()
  for (const [key, { path, mime }] of ctx.imagePaths) {
    const file = zip.file(path)
    if (!file) continue
    checkSize(file)
    images.set(key, { data: await file.async('arraybuffer'), mime })
  }

  return { title: builder.title || null, pages: builder.pages, images, issues: ctx.issues }
}
