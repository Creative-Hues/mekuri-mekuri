import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import type { Page, Sticky, StickyColor } from '../src/db/db'
import { buildExportNote, type LinkText } from '../src/export/model'
import { toMarkdown } from '../src/export/toMarkdown'
import { toText } from '../src/export/toText'
import { parseStickyLabel, stickyLabel } from '../src/export/stickyLabel'
import { parseText } from '../src/import/fromText'
import { parseMarkdown, stripFrontMatter } from '../src/import/fromMarkdown'
import { blocksToDoc } from '../src/import/toContent'
import { decodeText } from '../src/import/decodeText'
import { detectFormat, titleFromFileName } from '../src/import/importFiles'
import { issueMessages } from '../src/import/report'
import type { ImportedDoc } from '../src/import/model'

// ファイルの読み込み(テキスト・Markdown → 新しいノート)

// 読み込みで作る形にそろえた書き方(装飾のない文字は marks を持たない)
const t = (text: string, marks?: JSONContent['marks']): JSONContent => (marks ? { type: 'text', text, marks } : { type: 'text', text })
const p = (...content: JSONContent[]): JSONContent => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' })
const h = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [t(text)] })
const li = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content })
const task = (checked: boolean, text: string): JSONContent => ({ type: 'taskItem', attrs: { checked }, content: [p(t(text))] })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const cell = (text: string, bg: string | null = null, align: string | null = null): JSONContent => ({
  type: 'tableCell',
  attrs: { colspan: 1, rowspan: 1, colwidth: null, align, bg },
  content: [text ? p(t(text)) : p()],
})
/** 表(見出しなし)。セルは文字か、cell() で作ったもの */
const table = (...rows: (string | JSONContent)[][]): JSONContent => ({
  type: 'table',
  attrs: { headerRow: false, headerColumn: false },
  content: rows.map((r) => ({ type: 'tableRow', content: r.map((c) => (typeof c === 'string' ? cell(c) : c)) })),
})
/** 1行目を見出しにした表(Markdown の表は1行目が必ず見出しになる) */
const headed = (t: JSONContent): JSONContent => ({ ...t, attrs: { ...t.attrs, headerRow: true } })

const linkText: LinkText = () => 'リンク'
let pageNo = 0
function page(content: JSONContent, stickies: Sticky[] = []): Page {
  pageNo++
  return { id: `p${pageNo}`, noteId: 'n', order: 0, content, stickies, deletedAt: null, deletedIndex: null, createdAt: 0, updatedAt: 0 }
}
function sticky(content: JSONContent, color: StickyColor = 'yellow', y = 0): Sticky {
  return { id: `s${y}`, x: 0, y, w: 0.3, h: 0.3, color, content, createdAt: 0, updatedAt: 0 }
}

/** 読み込んだ結果を、ページごとの本文と付箋(色と中身)にする */
const pagesOf = (d: ImportedDoc) =>
  d.pages.map((pg) => ({ content: blocksToDoc(pg.blocks), stickies: pg.stickies.map((s) => ({ color: s.color, content: blocksToDoc(s.blocks) })) }))

/** Markdown で戻せるもの(色は Markdown では消える) */
const MD_PAGE1 = doc(
  h(1, '大見出し'),
  h(2, '中見出し'),
  p(t('ふつうの'), t('太字', [{ type: 'bold' }]), t('と'), t('取り消し', [{ type: 'strike' }])),
  p(t('リンク', [{ type: 'link', attrs: { href: 'https://example.com/a' } }]), t('の後'), { type: 'hardBreak' }, t('2行目')),
  {
    type: 'bulletList',
    content: [li(p(t('りんご')), { type: 'bulletList', content: [li(p(t('ふじ')))] }), li(p(t('みかん')))],
  },
  { type: 'orderedList', content: [li(p(t('一つ目'))), li(p(t('二つ目')))] },
  { type: 'taskList', content: [task(false, 'やること'), task(true, 'やったこと')] },
  // 列ごとの配置(Markdown の :---: ・ ---:)も戻る
  headed(table(['名前', cell('数', null, 'right')], ['a|b', cell('*3*', null, 'right')])),
  p(t('# 見出しではない 1. 番号でもない [括弧] <タグ> a_b_c')),
)

describe('付箋の見出し', () => {
  it('色の名前を書き、読み戻せる', () => {
    expect(stickyLabel('pink')).toBe('付箋(ピンク)')
    expect(parseStickyLabel('付箋(ピンク)')).toBe('pink')
    expect(parseStickyLabel('付箋(緑)')).toBe('green')
    expect(parseStickyLabel('付箋')).toBe('legacy')
    expect(parseStickyLabel('付箋(知らない色)')).toBeNull()
    expect(parseStickyLabel('ただの文')).toBeNull()
  })
})

describe('Markdown の読み込み', () => {
  it('書き出し → 読み込みで、元の形に戻る(ノート名・ページ・付箋の色も)', () => {
    const note = buildExportNote(
      '買い物メモ',
      [
        page(MD_PAGE1, [sticky(doc(p(t('メモ1'))), 'pink', 0), sticky(doc(p(t('メモ2')), p(t('2段落目'))), 'blue', 1)]),
        page(doc(p(t('2枚目')))),
      ],
      linkText,
    )
    const d = parseMarkdown(toMarkdown(note))
    expect(d.title).toBe('買い物メモ')
    expect(pagesOf(d)).toEqual([
      {
        content: MD_PAGE1,
        stickies: [
          { color: 'pink', content: doc(p(t('メモ1'))) },
          { color: 'blue', content: doc(p(t('メモ2')), p(t('2段落目'))) },
        ],
      },
      { content: doc(p(t('2枚目'))), stickies: [] },
    ])
    expect(issueMessages(d.issues)).toEqual([])
  })

  it('番号付きリストの始まりの番号を戻す', () => {
    const d = parseMarkdown('3. 三\n4. 四\n')
    expect(blocksToDoc(d.pages[0].blocks)).toEqual(
      doc({ type: 'orderedList', attrs: { start: 3 }, content: [li(p(t('三'))), li(p(t('四')))] }),
    )
  })

  it('古い書き出し(色のない「付箋」)の付箋は、黄色にする', () => {
    const d = parseMarkdown('# ノート\n\n本文\n\n**付箋**\n\n> 一つ目\n\n> 二つ目\n')
    expect(pagesOf(d)[0].stickies).toEqual([
      { color: 'yellow', content: doc(p(t('一つ目'))) },
      { color: 'yellow', content: doc(p(t('二つ目'))) },
    ])
    expect(pagesOf(d)[0].content).toEqual(doc(p(t('本文'))))
  })

  it('付箋の見出しのあとに引用がなければ、普通の文として読む', () => {
    const d = parseMarkdown('**付箋(ピンク)**\n\n本文\n')
    expect(d.pages[0].stickies).toEqual([])
    expect(blocksToDoc(d.pages[0].blocks)).toEqual(doc(p(t('付箋(ピンク)', [{ type: 'bold' }])), p(t('本文'))))
  })

  it('先頭が大見出しでなければ、ノート名はファイル名から(本文はそのまま)', () => {
    const d = parseMarkdown('はじめに\n\n# 見出し\n')
    expect(d.title).toBeNull()
    expect(blocksToDoc(d.pages[0].blocks)).toEqual(doc(p(t('はじめに')), h(1, '見出し')))
  })

  it('front matter は読み飛ばし、区切り線はページの区切りにする', () => {
    expect(stripFrontMatter('---\ntitle: x\n---\n本文')).toBe('本文')
    // 「キー: 値」がないものは front matter ではなく区切り線
    expect(stripFrontMatter('---\n本文\n---\n')).toBe('---\n本文\n---\n')
    const d = parseMarkdown('---\ntitle: x\ntags: [a]\n---\n\n# 題\n\n一\n\n---\n\n二\n\n***\n\n三\n')
    expect(d.title).toBe('題')
    expect(pagesOf(d).map((pg) => pg.content)).toEqual([doc(p(t('一'))), doc(p(t('二'))), doc(p(t('三')))])
  })

  it('見出しの4〜6段目は小見出しに、斜体・コード・引用は普通の文字にして知らせる', () => {
    const d = parseMarkdown('#### 深い\n\n*斜め* と `code`\n\n> 引用\n\n```\nx = 1\n```\n')
    expect(blocksToDoc(d.pages[0].blocks)).toEqual(doc(h(3, '深い'), p(t('斜め と code')), p(t('引用')), p(t('x = 1'))))
    expect(issueMessages(d.issues)).toEqual([
      '斜体(1か所)は、普通の文字になりました',
      'コード(2か所)は、普通の文字になりました',
      '引用(1か所)は、普通の段落になりました',
      '4段目より下の見出し(1か所)は、小見出しになりました',
    ])
  })

  it('ファイルの外の画像は「[画像]」にして知らせ、ファイルの中の画像(data:)は画像にする', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo='
    const d = parseMarkdown(`![a](https://example.com/a.png)\n\n![b](${png})\n`)
    expect(d.images.size).toBe(1)
    expect(d.pages[0].blocks).toEqual([
      { kind: 'paragraph', runs: [{ text: '[画像]' }] },
      { kind: 'image', key: 'md-1' },
    ])
    expect(issueMessages(d.issues)).toEqual(['ファイルの外にある画像(1枚)は読み込めないため、「[画像]」と書きました'])
  })

  it('文字参照(&amp; など)を元の文字に戻す', () => {
    const d = parseMarkdown('A &amp; B &lt;c&gt; &#12354;\n')
    expect(blocksToDoc(d.pages[0].blocks)).toEqual(doc(p(t('A & B <c> あ'))))
  })

  it('普通の改行(1つの改行)も、改行として残す', () => {
    const d = parseMarkdown('一行目\n二行目\n')
    expect(blocksToDoc(d.pages[0].blocks)).toEqual(doc(p(t('一行目'), { type: 'hardBreak' }, t('二行目'))))
  })
})

describe('テキストの読み込み', () => {
  it('書き出し → 読み込みで、ページ・リスト・表・付箋の色が戻る', () => {
    const page1 = doc(
      p(t('ふつうの段落')),
      p(),
      {
        type: 'bulletList',
        content: [li(p(t('りんご')), { type: 'bulletList', content: [li(p(t('ふじ')))] }), li(p(t('みかん')))],
      },
      { type: 'orderedList', content: [li(p(t('一つ目'))), li(p(t('二つ目')))] },
      { type: 'taskList', content: [task(false, 'やること'), task(true, 'やったこと')] },
      table(['名前', '数'], ['a', '1']),
    )
    const note = buildExportNote(
      '買い物',
      [
        page(page1, [sticky(doc(p(t('メモ')), p(), p(t('空行のあと'))), 'green', 0), sticky(doc(p(t('二枚目の付箋'))), 'purple', 1)]),
        page(doc(p(t('2枚目')))),
      ],
      linkText,
    )
    const d = parseText(toText(note))
    expect(d.title).toBe('買い物')
    expect(pagesOf(d)).toEqual([
      {
        content: page1,
        stickies: [
          { color: 'green', content: doc(p(t('メモ')), p(), p(t('空行のあと'))) },
          { color: 'purple', content: doc(p(t('二枚目の付箋'))) },
        ],
      },
      { content: doc(p(t('2枚目'))), stickies: [] },
    ])
  })

  it('リストの項目の中の改行(2行目)を戻す', () => {
    const d = parseText('・ 一行目\n  二行目\n・ 次\n')
    expect(blocksToDoc(d.pages[0].blocks)).toEqual(
      doc({ type: 'bulletList', content: [li(p(t('一行目'), { type: 'hardBreak' }, t('二行目'))), li(p(t('次')))] }),
    )
  })

  it('古い書き出し(「【付箋】」)の付箋は、空行で分けて黄色にする', () => {
    const d = parseText('題\n\n── 1ページ ──\n\n本文\n\n【付箋】\nメモA\n\nメモB\n')
    expect(pagesOf(d)[0]).toEqual({
      content: doc(p(t('本文'))),
      stickies: [
        { color: 'yellow', content: doc(p(t('メモA'))) },
        { color: 'yellow', content: doc(p(t('メモB'))) },
      ],
    })
  })

  it('書き出しの形でないファイルは、1行を1段落にし、ノート名はファイル名から', () => {
    const d = parseText('一行目\n\n  字下げ\n\tタブで字下げ\n')
    expect(d.title).toBeNull()
    expect(d.pages).toHaveLength(1)
    expect(blocksToDoc(d.pages[0].blocks)).toEqual(doc(p(t('一行目')), p(), p(t('  字下げ')), p(t('\tタブで字下げ'))))
  })
})

describe('ファイルの種類・名前・文字コード', () => {
  it('拡張子から形式を決める', () => {
    expect(detectFormat('a.txt')).toBe('txt')
    expect(detectFormat('a.MD')).toBe('md')
    expect(detectFormat('a.markdown')).toBe('md')
    expect(detectFormat('a.pdf')).toBeNull()
    expect(detectFormat('README', 'text/markdown')).toBe('md')
  })

  it('ファイル名から拡張子を外してノート名にする', () => {
    expect(titleFromFileName('旅行の計画.md')).toBe('旅行の計画')
    expect(titleFromFileName('memo.2026.txt')).toBe('memo.2026')
  })

  it('UTF-8(BOM あり・なし)・UTF-16・Shift_JIS を読める。改行をそろえる', () => {
    const enc = (s: string) => new TextEncoder().encode(s)
    expect(decodeText(enc('あいう\r\nえお').buffer)).toBe('あいう\nえお')
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...enc('あ')]).buffer)).toBe('あ')
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x42, 0x30]).buffer)).toBe('あ')
    // 「あい」の Shift_JIS
    expect(decodeText(new Uint8Array([0x82, 0xa0, 0x82, 0xa2]).buffer)).toBe('あい')
  })
})
