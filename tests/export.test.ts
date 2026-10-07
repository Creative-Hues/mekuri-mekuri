import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import type { JSONContent } from '@tiptap/core'
import type { Page, Sticky } from '../src/db/db'
import { db } from '../src/db/db'
import { createNote, getPages, savePageContent, savePageStickies, trashNote } from '../src/db/repo'
import { buildExportNote, contentToBlocks, safeFileName, type LinkText } from '../src/export/model'
import { toText } from '../src/export/toText'
import { escapeMd, toMarkdown } from '../src/export/toMarkdown'
import { buildDocx } from '../src/export/toDocx'
import { Packer } from 'docx'
import { MARKER_HEX, TEXT_HEX } from '../src/export/colors'
import { linkLabel, loadExportSource } from '../src/export/load'
import { openAllToggles } from '../src/export/PrintView'
import { createSticky } from '../src/editor/sticky'

// ノートの書き出し(テキスト・Markdown・Word・PDF の準備)

const t = (text: string, marks: JSONContent['marks'] = []): JSONContent => ({ type: 'text', text, marks })
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
const h = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [t(text)] })
const li = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content })
const task = (checked: boolean, text: string): JSONContent => ({ type: 'taskItem', attrs: { checked }, content: [p(t(text))] })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const cell = (text: string, bg: string | null = null): JSONContent => ({
  type: 'tableCell',
  attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null, bg },
  content: [text ? p(t(text)) : { type: 'paragraph' }],
})

const linkText: LinkText = (noteId, pageId) => `${noteId}${pageId ? `:${pageId}` : ''}`

function page(content: JSONContent, stickies: Sticky[] = []): Page {
  return { id: 'p', noteId: 'n', order: 0, content, stickies, deletedAt: null, deletedIndex: null, createdAt: 0, updatedAt: 0 }
}
function sticky(content: JSONContent, x = 0, y = 0): Sticky {
  return { id: `s${x}${y}`, x, y, w: 0.3, h: 0.3, color: 'yellow', content, createdAt: 0, updatedAt: 0 }
}

/** いろいろな行を含むページ */
const SAMPLE = doc(
  h(1, '大見出し'),
  p(t('ふつうの'), t('太字', [{ type: 'bold' }]), t('と'), t('取り消し', [{ type: 'strike' }])),
  p(
    t('赤', [{ type: 'textColor', attrs: { color: 'red' } }]),
    t('黄マーカー', [{ type: 'marker', attrs: { color: 'yellow' } }]),
    t('波線', [{ type: 'underline', attrs: { style: 'wavy', color: 'blue' } }]),
  ),
  p(t('リンク', [{ type: 'link', attrs: { href: 'https://example.com/a' } }]), t('の後'), { type: 'hardBreak' }, t('2行目')),
  {
    type: 'bulletList',
    content: [li(p(t('りんご')), { type: 'bulletList', content: [li(p(t('ふじ')))] }), li(p(t('みかん')))],
  },
  { type: 'orderedList', attrs: { start: 1 }, content: [li(p(t('一つ目'))), li(p(t('二つ目')))] },
  { type: 'taskList', content: [task(false, 'やること'), task(true, 'やったこと')] },
  {
    type: 'toggleHeading',
    attrs: { level: 2, open: false },
    content: [{ type: 'toggleTitle', content: [t('トグル')] }, p(t('隠れた中身'))],
  },
  {
    type: 'table',
    content: [
      { type: 'tableRow', content: [cell('名前', 'blue'), cell('数')] },
      { type: 'tableRow', content: [cell('a|b'), cell('')] },
    ],
  },
  { type: 'image', attrs: { imageId: 'img1', width: 800, height: 600 } },
  { type: 'noteLink', attrs: { noteId: 'other', pageId: 'pg' } },
)

describe('出力用の形(model)', () => {
  it('ページ内容を Block の並びにする', () => {
    const blocks = contentToBlocks(SAMPLE, linkText)
    expect(blocks.map((b) => b.kind)).toEqual([
      'heading',
      'paragraph',
      'paragraph',
      'paragraph',
      'listItem',
      'listItem',
      'listItem',
      'listItem',
      'listItem',
      'listItem',
      'listItem',
      'heading',
      'paragraph',
      'table',
      'image',
      'noteLink',
    ])
  })

  it('装飾を読み取る', () => {
    const [, bold, colors, link] = contentToBlocks(SAMPLE, linkText)
    expect(bold.kind === 'paragraph' && bold.runs[1]).toEqual({ text: '太字', bold: true })
    expect(colors.kind === 'paragraph' && colors.runs).toEqual([
      { text: '赤', color: 'red' },
      { text: '黄マーカー', marker: 'yellow' },
      { text: '波線', line: { style: 'wavy', color: 'blue' } },
    ])
    expect(link.kind === 'paragraph' && link.runs.map((r) => r.text)).toEqual(['リンク', 'の後', '\n', '2行目'])
  })

  it('知らない色名・リンク以外の URL の形は無視する', () => {
    const [b] = contentToBlocks(doc(p(t('x', [{ type: 'textColor', attrs: { color: 'neon' } }]))), linkText)
    expect(b.kind === 'paragraph' && b.runs[0]).toEqual({ text: 'x' })
  })

  it('リストの深さ・番号・チェック', () => {
    const items = contentToBlocks(SAMPLE, linkText).filter((b) => b.kind === 'listItem')
    expect(items.map((b) => b.kind === 'listItem' && [b.list, b.depth, b.number, b.checked])).toEqual([
      ['bullet', 0, 1, false],
      ['bullet', 1, 1, false],
      ['bullet', 0, 2, false],
      ['ordered', 0, 1, false],
      ['ordered', 0, 2, false],
      ['task', 0, 1, false],
      ['task', 0, 2, true],
    ])
  })

  it('付箋は空のものを除き、上から順に並べる', () => {
    const stickies = [
      sticky(doc(p(t('下'))), 0, 0.5),
      sticky(doc({ type: 'paragraph' }), 0, 0),
      sticky(doc(p(t('上'))), 0.2, 0.1),
    ]
    const note = buildExportNote('  ', [page(doc(p(t('本文'))), stickies)], linkText)
    expect(note.title).toBe('無題のノート')
    expect(note.pages[0].stickies.map((s) => s.blocks[0].kind === 'paragraph' && s.blocks[0].runs[0].text)).toEqual(['上', '下'])
  })
})

describe('テキストの出力', () => {
  it('文字だけを書き出す', () => {
    const note = buildExportNote('買い物', [page(SAMPLE, [sticky(doc(p(t('メモ'))))]), page(doc(p(t('2枚目'))))], linkText)
    expect(toText(note)).toBe(
      [
        '買い物',
        '',
        '── 1ページ ──',
        '',
        '大見出し',
        'ふつうの太字と取り消し',
        '赤黄マーカー波線',
        'リンクの後',
        '2行目',
        '・ りんご',
        '  ・ ふじ',
        '・ みかん',
        '1. 一つ目',
        '2. 二つ目',
        '□ やること',
        '■ やったこと',
        'トグル',
        '隠れた中身',
        '名前\t数',
        'a|b',
        'other:pg',
        '',
        '【付箋(黄)】',
        'メモ',
        '',
        '── 2ページ ──',
        '',
        '2枚目',
        '',
      ].join('\n'),
    )
  })
})

describe('Markdown の出力', () => {
  it('記号をエスケープする', () => {
    expect(escapeMd('a*b_c [d] <e> `f` ~g~ \\')).toBe('a\\*b\\_c \\[d\\] \\<e\\> \\`f\\` \\~g\\~ \\\\')
  })

  it('見出し・装飾・リスト・表・リンクを書き出す', () => {
    const note = buildExportNote('買い物', [page(SAMPLE, [sticky(doc(p(t('メモ'))))]), page(doc(p(t('2枚目'))))], linkText)
    expect(toMarkdown(note)).toBe(
      [
        '# 買い物',
        '',
        '# 大見出し',
        '',
        'ふつうの**太字**と~~取り消し~~',
        '',
        '赤黄マーカー波線',
        '',
        '[リンク](https://example.com/a)の後\\',
        '2行目',
        '',
        '- りんご',
        '  - ふじ',
        '- みかん',
        '1. 一つ目',
        '2. 二つ目',
        '- [ ] やること',
        '- [x] やったこと',
        '',
        '## トグル',
        '',
        '隠れた中身',
        '',
        '| 名前 | 数 |',
        '| --- | --- |',
        '| a\\|b |  |',
        '',
        '[画像]',
        '',
        'other:pg',
        '',
        '**付箋(黄)**',
        '',
        '> メモ',
        '',
        '---',
        '',
        '2枚目',
        '',
      ].join('\n'),
    )
  })

  it('行の頭の記号が見出し・リストにならないようにする', () => {
    const note = buildExportNote('t', [page(doc(p(t('# 見出しではない')), p(t('1. 番号ではない')), p(t('- 箇条書きではない'))))], linkText)
    const md = toMarkdown(note)
    expect(md).toContain('\\# 見出しではない')
    expect(md).toContain('1\\. 番号ではない')
    expect(md).toContain('\\- 箇条書きではない')
  })

  it('太字の前後の空白は記号の外に出す', () => {
    const note = buildExportNote('t', [page(doc(p(t('a'), t(' 太字 ', [{ type: 'bold' }]), t('b'))))], linkText)
    expect(toMarkdown(note)).toContain('a **太字** b')
  })

  it('番号付きリストの中の入れ子は、番号の幅だけ字下げする', () => {
    const note = buildExportNote('t', [
      page(doc({ type: 'orderedList', content: [li(p(t('親')), { type: 'bulletList', content: [li(p(t('子')))] })] })),
    ], linkText)
    expect(toMarkdown(note)).toContain('1. 親\n   - 子')
  })
})

describe('Word の出力', () => {
  it('文書を作れて、文字・見出し・表・画像が入る', async () => {
    const note = buildExportNote('買い物', [page(SAMPLE, [sticky(doc(p(t('メモ'))))]), page(doc(p(t('2枚目'))))], linkText)
    // 1×1 の PNG
    const png = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
      (c) => c.charCodeAt(0),
    ).buffer
    const images = new Map([['img1', { data: png, mime: 'image/png', width: 800, height: 600 }]])
    const buf = await Packer.toBuffer(buildDocx(note, images))
    const zip = await JSZip.loadAsync(buf)
    const xml = await zip.file('word/document.xml')!.async('string')
    for (const text of ['買い物', '大見出し', '太字', 'やったこと', '隠れた中身', '名前', 'メモ', '2枚目', 'other:pg']) {
      expect(xml).toContain(text)
    }
    expect(xml).toContain('w:tbl') // 表
    expect(xml).toContain('w:drawing') // 画像
    expect(xml).toContain(`w:fill="${MARKER_HEX.blue}"`) // セルの色
    expect(xml).toContain(`<w:color w:val="${TEXT_HEX.red}"/>`) // 文字色
    expect(xml).toContain('w:val="wave"') // 波線
    expect(xml).toContain('w:type="page"') // 改ページ
    expect(Object.keys(zip.files).some((f) => f.startsWith('word/media/'))).toBe(true)
  })

  it('画像が見つからなくても作れる', async () => {
    const note = buildExportNote('t', [page(doc({ type: 'image', attrs: { imageId: 'none', width: 10, height: 10 } }))], linkText)
    const zip = await JSZip.loadAsync(await Packer.toBuffer(buildDocx(note, new Map())))
    expect(await zip.file('word/document.xml')!.async('string')).toContain('画像が見つかりません')
  })

  it('Word の色は、画面(ライトモード)の色と同じ', () => {
    const css = readFileSync('src/styles/base.css', 'utf8')
    // 最初の :root(ライトモード)の部分だけを見る
    const light = css.slice(0, css.indexOf(":root[data-theme='dark']"))
    for (const [name, hex] of Object.entries(TEXT_HEX)) expect(light).toContain(`--tc-${name}: #${hex};`)
    for (const [name, hex] of Object.entries(MARKER_HEX)) expect(light).toContain(`--mk-${name}: #${hex};`)
  })
})

describe('ファイル名', () => {
  it('使えない記号を置き換え、空なら「無題のノート」', () => {
    expect(safeFileName('a/b:c*d?"e"<f>|g', 'md')).toBe('a_b_c_d__e__f__g.md')
    expect(safeFileName('  ', 'txt')).toBe('無題のノート.txt')
    expect(safeFileName('...', 'txt')).toBe('無題のノート.txt')
    expect(safeFileName('旅行\nメモ', 'docx')).toBe('旅行 メモ.docx')
    expect(safeFileName('あ'.repeat(100), 'txt')).toBe(`${'あ'.repeat(80)}.txt`)
  })
})

describe('PDF(印刷)の準備', () => {
  it('トグル見出しをすべて開く(元の内容は変えない)', () => {
    const src = doc({
      type: 'toggleHeading',
      attrs: { level: 1, open: false },
      content: [{ type: 'toggleTitle', content: [t('a')] }, p(t('b'))],
    })
    const opened = openAllToggles(src)
    expect(opened.content![0].attrs!.open).toBe(true)
    expect(src.content![0].attrs!.open).toBe(false)
  })
})

describe('データベースから読む(loadExportSource)', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('ゴミ箱のページを除き、リンク先の名前と画像を集める', async () => {
    const target = await createNote('行き先')
    const [targetPage] = await getPages(target.id)
    const note = await createNote('元')
    const [first] = await getPages(note.id)
    await db.images.add({ id: 'img1', mime: 'image/png', data: new ArrayBuffer(4), width: 1, height: 1, createdAt: 0, unusedSince: null })
    await savePageContent(
      first.id,
      doc(
        { type: 'noteLink', attrs: { noteId: target.id, pageId: targetPage.id } },
        { type: 'noteLink', attrs: { noteId: target.id, pageId: null } },
        { type: 'noteLink', attrs: { noteId: 'gone', pageId: null } },
      ),
    )
    await savePageStickies(first.id, [{ ...createSticky('yellow', 0.2), content: doc({ type: 'image', attrs: { imageId: 'img1' } }) }])

    const source = (await loadExportSource(note.id))!
    expect(source.model.title).toBe('元')
    const blocks = source.model.pages[0].blocks
    expect(blocks.map((b) => b.kind === 'noteLink' && b.text)).toEqual([
      '行き先(1ページ目)',
      '行き先',
      'リンク先が見つかりません',
    ])
    expect([...source.images.keys()]).toEqual(['img1'])

    await trashNote(target.id)
    const again = (await loadExportSource(note.id))!
    expect(again.model.pages[0].blocks[1]).toEqual({ kind: 'noteLink', text: '行き先(ゴミ箱にあります)' })
  })

  it('リンクの表示名', () => {
    expect(linkLabel({ kind: 'missing' })).toBe('リンク先が見つかりません')
  })
})

// ---- 表(1.3.0〜:結合・配置・見出し・列の幅) ----

/** 結合・配置・見出しのある表 */
const richTable = (attrs: object = { headerRow: true, headerColumn: true }): JSONContent => {
  const c = (text: string, a: object = {}): JSONContent => ({
    type: 'tableCell',
    attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null, bg: null, ...a },
    content: [text ? p(t(text)) : { type: 'paragraph' }],
  })
  return {
    type: 'table',
    attrs,
    content: [
      { type: 'tableRow', content: [c('項目'), c('数', { align: 'center' }), c('値段', { align: 'right' })] },
      { type: 'tableRow', content: [c('果物', { rowspan: 2 }), c('りんごとみかん', { colspan: 2, align: 'center' })] },
      { type: 'tableRow', content: [c('3', { align: 'center' }), c('120', { align: 'right' })] },
    ],
  }
}

describe('表の出力(結合・配置・見出し・列の幅)', () => {
  it('model:結合・配置・見出し・列の幅を持ち、tableGrid で1マスずつに並べられる', async () => {
    const { tableGrid } = await import('../src/export/model')
    const withWidths = richTable()
    withWidths.content![0].content![0].attrs!.colwidth = [120]
    withWidths.content![1].content![1].attrs!.colwidth = [80, 100]
    const [b] = contentToBlocks(doc(withWidths), linkText)
    if (b.kind !== 'table') throw new Error('表ではない')
    expect(b).toMatchObject({ headerRow: true, headerColumn: true, colWidths: [120, 80, 100] })
    expect(b.rows[1][0]).toMatchObject({ rowspan: 2 })
    expect(b.rows[1][1]).toMatchObject({ colspan: 2, align: 'center' })
    const grid = tableGrid(b.rows)
    expect(grid.map((r) => r.map((s) => (s.origin ? 'o' : '-')).join(''))).toEqual(['ooo', 'oo-', '-oo'])
    expect(grid[2][0].cell).toBe(b.rows[1][0])
  })

  it('Markdown:結合したセルは分けて出し、見出しの列は太字、列の配置は揃っていれば :---: ・ ---:', () => {
    const md = toMarkdown(buildExportNote('表', [page(doc(richTable()))], linkText))
    expect(md).toContain(
      ['| 項目 | 数 | 値段 |', '| --- | :---: | ---: |', '| **果物** | りんごとみかん |  |', '|  | 3 | 120 |'].join('\n'),
    )
  })

  it('Markdown:列の中で配置がばらばらなら、その列は左寄せ', () => {
    const tb = richTable()
    tb.content![2].content![1].attrs!.align = null // 3列目の「120」だけ左
    const md = toMarkdown(buildExportNote('表', [page(doc(tb))], linkText))
    expect(md).toContain('| --- | :---: | --- |')
  })

  it('テキスト:結合したセルは分けて出す(文字は左上のマス)', () => {
    const txt = toText(buildExportNote('表', [page(doc(richTable()))], linkText))
    // 行の最後の空のマス(タブ)は、ほかの行と同じく行末の空白として取る
    expect(txt).toContain(['項目\t数\t値段', '果物\tりんごとみかん', '\t3\t120'].join('\n'))
  })

  it('お知らせ:Markdown・テキストで表せなかったものだけ。Word はなし', async () => {
    const { exportNotices } = await import('../src/export/notices')
    const rich = buildExportNote('表', [page(doc(richTable()))], linkText)
    const simple = buildExportNote('表', [page(doc({ type: 'table', content: [{ type: 'tableRow', content: [cell('a')] }] }))], linkText)
    expect(exportNotices([rich], 'md')).toEqual([
      '結合したセルは、分けて出しました(文字は左上のセルに入れています)。',
      '表の見出しの列は、太字にしました。',
    ])
    expect(exportNotices([rich], 'txt')).toEqual(['結合したセルは、分けて出しました(文字は左上のマスに入れています)。'])
    expect(exportNotices([rich], 'docx')).toEqual([])
    expect(exportNotices([simple], 'md')).toEqual([])
    expect(exportNotices([simple, rich], 'txt')).toHaveLength(1)
  })

  it('Word:結合(gridSpan・vMerge)・配置・見出しの行の繰り返し・見出しの色・固定の列の幅を書く', async () => {
    const tb = richTable()
    tb.content![0].content!.forEach((c, i) => (c.attrs!.colwidth = [[120], [80], [100]][i]))
    tb.content![1].content![0].attrs!.colwidth = [120]
    tb.content![1].content![1].attrs!.colwidth = [80, 100]
    tb.content![2].content![0].attrs!.colwidth = [80]
    tb.content![2].content![1].attrs!.colwidth = [100]
    const blob = await Packer.toBlob(buildDocx(buildExportNote('表', [page(doc(tb))], linkText), new Map()))
    const xml = await (await JSZip.loadAsync(await blob.arrayBuffer())).file('word/document.xml')!.async('string')
    expect(xml).toContain('<w:gridSpan w:val="2"/>')
    expect(xml).toMatch(/<w:vMerge w:val="restart"\/>/)
    expect(xml).toMatch(/<w:vMerge w:val="continue"\/>|<w:vMerge\/>/)
    expect(xml).toContain('<w:tblHeader/>')
    expect(xml).toContain('w:fill="f0f1f2"')
    expect(xml).toContain('<w:jc w:val="center"/>')
    expect(xml).toContain('<w:jc w:val="right"/>')
    expect(xml).toContain('<w:tblLayout w:type="fixed"/>')
    expect(xml).toMatch(/<w:gridCol w:w="1800"\/><w:gridCol w:w="1200"\/><w:gridCol w:w="1500"\/>/)
  })
})

describe('まとめて書き出す(ZIP)', () => {
  it('同じ名前のファイルには(2)(3)を付ける(大文字・小文字は同じとみなす)', async () => {
    const { uniqueNames } = await import('../src/export/exportNote')
    expect(uniqueNames(['a.md', 'b.md', 'a.md', 'A.md', '無題のノート.md'])).toEqual([
      'a.md',
      'b.md',
      'a(2).md',
      'A(3).md',
      '無題のノート.md',
    ])
  })

  it('ノートごとのファイルを1つの ZIP に入れる', async () => {
    const { buildNotesZip } = await import('../src/export/exportNote')
    const src = (title: string, text: string) => ({
      note: { id: title } as never,
      pages: [],
      model: buildExportNote(title, [page(doc(p(t(text))))], linkText),
      images: new Map(),
    })
    const blob = await buildNotesZip([src('メモ', 'いち'), src('メモ', 'に'), src('日記', 'さん')], 'txt')
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(zip.files).sort()).toEqual(['メモ(2).txt', 'メモ.txt', '日記.txt'].sort())
    expect(await zip.file('メモ(2).txt')!.async('string')).toContain('に')
  })
})

describe('PDF:紙より広い表', () => {
  it('列の幅を決めた表は、読むだけの表示(印刷)で列の幅を割合にし、紙の幅を超えないようにする', async () => {
    const { Editor } = await import('@tiptap/core')
    const { buildExtensions } = await import('../src/editor/extensions')
    const c = (w: number): JSONContent => ({
      type: 'tableCell',
      attrs: { colspan: 1, rowspan: 1, colwidth: [w], align: null, bg: null },
      content: [{ type: 'paragraph' }],
    })
    const content = doc({ type: 'table', content: [{ type: 'tableRow', content: [c(600), c(300), c(300)] }] })
    const hooks = { undo: () => {}, redo: () => {}, closeGroup: () => {} }
    const widthsOf = (e: InstanceType<typeof Editor>) =>
      Array.from(e.view.dom.querySelectorAll('col')).map((col) => (col as HTMLElement).style.width)

    // 編集する画面:決めた幅(px)のまま(表は横にスクロールする)
    const editing = new Editor({ extensions: buildExtensions(hooks), content })
    expect(widthsOf(editing)).toEqual(['600px', '300px', '300px'])
    editing.destroy()

    // 印刷:比率(50% / 25% / 25%)にし、表の幅は「紙の幅と合計の小さいほう」
    const print = new Editor({ extensions: buildExtensions(hooks), content, editable: false })
    await Promise.resolve()
    expect(widthsOf(print)).toEqual(['50%', '25%', '25%'])
    const style = print.view.dom.querySelector('table')!.getAttribute('style') ?? ''
    // (jsdom は min() を読めないことがあるので、書けたときだけ確かめる)
    if (style.includes('width')) expect(style).toContain('min(100%, 1200px)')
    print.destroy()
  })

  it('印刷用の CSS:つまみ・「＋」の場所をとらず、幅のない表は折り返して紙の幅に収める', () => {
    const css = readFileSync('src/styles/print.css', 'utf8')
    expect(css).toMatch(/\.print-root \.table-block \{[^}]*grid-template-columns: 0 minmax\(0, 1fr\) 0/)
    expect(css).toMatch(/table:not\(\.is-fixed\) td,[^{]*\{[^}]*min-width: 0/)
  })
})
