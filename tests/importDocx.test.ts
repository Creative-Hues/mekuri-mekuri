import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { Packer } from 'docx'
import type { JSONContent } from '@tiptap/core'
import type { Page, Sticky, StickyColor } from '../src/db/db'
import { buildExportNote, type LinkText } from '../src/export/model'
import { buildDocx, docxColumnWidths, type DocxImage } from '../src/export/toDocx'
import { parseDocx } from '../src/import/fromDocx'
import { blocksToDoc, type SavedImages } from '../src/import/toContent'
import { issueMessages } from '../src/import/report'
import { highlightColor, nearestMarkerColor, nearestTextColor } from '../src/import/colors'
import { MARKER_HEX, TEXT_HEX } from '../src/export/colors'
import { detectFormat, parseFileData } from '../src/import/importFiles'
import type { ImportedDoc } from '../src/import/model'

// Word(.docx)の読み込み

const t = (text: string, marks?: JSONContent['marks']): JSONContent => (marks ? { type: 'text', text, marks } : { type: 'text', text })
const p = (...content: JSONContent[]): JSONContent => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' })
const h = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [t(text)] })
const li = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content })
const task = (checked: boolean, text: string): JSONContent => ({ type: 'taskItem', attrs: { checked }, content: [p(t(text))] })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const cell = (text: string, bg: string | null = null): JSONContent => ({
  type: 'tableCell',
  attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null, bg },
  content: [text ? p(t(text)) : p()],
})
const color = (c: string) => ({ type: 'textColor', attrs: { color: c } })
const marker = (c: string) => ({ type: 'marker', attrs: { color: c } })
const line = (style: string, c: string | null = null) => ({ type: 'underline', attrs: { style, color: c } })

const linkText: LinkText = () => 'リンク'
let n = 0
const page = (content: JSONContent, stickies: Sticky[] = []): Page => ({
  id: `p${++n}`, noteId: 'n', order: 0, content, stickies, deletedAt: null, deletedIndex: null, createdAt: 0, updatedAt: 0,
})
const sticky = (content: JSONContent, c: StickyColor, y: number): Sticky => ({ id: `s${y}`, x: 0, y, w: 0.3, h: 0.3, color: c, content, createdAt: 0, updatedAt: 0 })

/** 1x1 の PNG */
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0))

/** 画像の key を、保存したことにした id に置き換えて中身にする */
function pagesOf(d: ImportedDoc) {
  const saved: SavedImages = new Map([...d.images.keys()].map((k, i) => [k, { id: `img${i + 1}`, width: 1, height: 1 }]))
  return d.pages.map((pg) => ({
    content: blocksToDoc(pg.blocks, saved),
    stickies: pg.stickies.map((s) => ({ color: s.color, content: blocksToDoc(s.blocks) })),
  }))
}

async function exportedDocx(title: string, pages: Page[], images = new Map<string, DocxImage>()) {
  const buf = await Packer.toBuffer(buildDocx(buildExportNote(title, pages, linkText), images))
  return parseDocx(new Uint8Array(buf).buffer)
}

// ---- 手で作る Word ファイル(Word で作ったものに近い形) ----

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:v="urn:schemas-microsoft-com:vml"'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** 日本語版の Word のように、見出しのスタイルの id が「1」「2」… のもの */
const STYLES = `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W_NS}>
<w:style w:type="paragraph" w:styleId="a"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/><w:basedOn w:val="a"/><w:rPr><w:color w:val="2F5496"/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="2"><w:name w:val="heading 2"/><w:basedOn w:val="a"/></w:style>
<w:style w:type="paragraph" w:styleId="5"><w:name w:val="heading 5"/><w:basedOn w:val="a"/></w:style>
<w:style w:type="paragraph" w:styleId="a3"><w:name w:val="Title"/></w:style>
<w:style w:type="paragraph" w:styleId="mine"><w:name w:val="自分の見出し"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>
<w:style w:type="character" w:styleId="a4"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="character" w:styleId="a5"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
</w:styles>`

const NUMBERING = `<?xml version="1.0" encoding="UTF-8"?><w:numbering ${W_NS}>
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimalFullWidth"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="aiueoFullWidth"/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
<w:num w:numId="3"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride></w:num>
</w:numbering>`

interface Extra {
  rels?: string
  files?: Record<string, string | Uint8Array>
  contentTypes?: boolean
}

async function makeDocx(body: string, extra: Extra = {}): Promise<ArrayBuffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
  zip.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`)
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document ${W_NS}><w:body>${body}<w:sectPr/></w:body></w:document>`)
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rStyles" Type="${REL}/styles" Target="styles.xml"/>
<Relationship Id="rNum" Type="${REL}/numbering" Target="numbering.xml"/>
<Relationship Id="rImg" Type="${REL}/image" Target="media/image1.png"/>
<Relationship Id="rEmf" Type="${REL}/image" Target="media/image2.emf"/>
<Relationship Id="rWeb" Type="${REL}/hyperlink" Target="https://example.com/page" TargetMode="External"/>
<Relationship Id="rBad" Type="${REL}/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>
<Relationship Id="rFar" Type="${REL}/image" Target="https://example.com/far.png" TargetMode="External"/>
${extra.rels ?? ''}</Relationships>`,
  )
  zip.file('word/styles.xml', STYLES)
  zip.file('word/numbering.xml', NUMBERING)
  zip.file('word/media/image1.png', PNG)
  zip.file('word/media/image2.emf', new Uint8Array([1, 2, 3]))
  for (const [path, data] of Object.entries(extra.files ?? {})) zip.file(path, data)
  return zip.generateAsync({ type: 'arraybuffer' })
}

const para = (inner: string, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`
const run = (text: string, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`
const drawing = (rid: string) =>
  `<w:r><w:drawing><wp:inline><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
const pageBreak = '<w:r><w:br w:type="page"/></w:r>'

const parse = async (body: string, extra?: Extra) => parseDocx(await makeDocx(body, extra))
const firstPage = async (body: string, extra?: Extra) => pagesOf(await parse(body, extra))[0].content

describe('書き出した Word → 読み込み', () => {
  it('元の形に戻る(ノート名・ページ・見出し・装飾・色・リスト・ToDo・表・画像・付箋の色)', async () => {
    const page1 = doc(
      h(1, '大見出し'),
      h(3, '小見出し'),
      p(
        t('太字', [{ type: 'bold' }]),
        t('取り消し', [{ type: 'strike' }]),
        t('赤', [color('red')]),
        t('黄マーカー', [marker('yellow')]),
        t('青い波線', [line('wavy', 'blue')]),
        t('二重線', [line('double')]),
        t('点線', [line('dotted', 'green')]),
        t('全部', [{ type: 'bold' }, color('purple'), marker('pink'), line('solid', 'orange')]),
      ),
      p(t('リンク', [{ type: 'link', attrs: { href: 'https://example.com/a' } }]), t('の後'), { type: 'hardBreak' }, t('2行目')),
      p(),
      {
        type: 'bulletList',
        content: [
          li(p(t('りんご')), { type: 'orderedList', content: [li(p(t('ふじ'))), li(p(t('つがる')))] }),
          li(p(t('みかん')), p(t('2段落目'))),
        ],
      },
      { type: 'orderedList', content: [li(p(t('一つ目'))), li(p(t('二つ目')))] },
      { type: 'taskList', content: [task(false, 'やること'), task(true, 'やったこと')] },
      {
        type: 'table',
        attrs: { headerRow: false, headerColumn: false },
        content: [
          { type: 'tableRow', content: [cell('名前', 'blue'), cell('数')] },
          { type: 'tableRow', content: [cell('a'), cell('', 'gray')] },
        ],
      },
      { type: 'image', attrs: { imageId: 'img1', width: 1, height: 1 } },
    )
    const d = await exportedDocx(
      '買い物',
      [
        page(page1, [sticky(doc(p(t('メモ'))), 'pink', 0), sticky(doc(p(t('二つ目')), p(t('続き'))), 'green', 1)]),
        page(doc(p(t('2枚目')))),
      ],
      new Map([['img1', { data: PNG.buffer, mime: 'image/png', width: 1, height: 1 }]]),
    )
    expect(d.title).toBe('買い物')
    expect(pagesOf(d)).toEqual([
      {
        content: page1,
        stickies: [
          { color: 'pink', content: doc(p(t('メモ'))) },
          { color: 'green', content: doc(p(t('二つ目')), p(t('続き'))) },
        ],
      },
      { content: doc(p(t('2枚目'))), stickies: [] },
    ])
    expect(d.images.get('docx-1')?.mime).toBe('image/png')
    expect(new Uint8Array(d.images.get('docx-1')!.data)).toEqual(PNG)
    expect(issueMessages(d.issues)).toEqual([])
  })

  it('表:結合(横・縦)・列の幅・セルごとの配置・見出しの行と列・セルの色が、そのまま戻る', async () => {
    const c = (text: string, attrs: { colspan?: number; rowspan?: number; colwidth?: number[]; align?: string | null; bg?: string | null } = {}): JSONContent => ({
      type: 'tableCell',
      attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null, bg: null, ...attrs },
      content: [text ? p(t(text)) : p()],
    })
    const w = [120, 80, 100]
    const table: JSONContent = {
      type: 'table',
      attrs: { headerRow: true, headerColumn: true },
      content: [
        { type: 'tableRow', content: [c('項目', { colwidth: [w[0]] }), c('数', { colwidth: [w[1]], align: 'center' }), c('値段', { colwidth: [w[2]], align: 'right' })] },
        { type: 'tableRow', content: [c('果物', { rowspan: 2, colwidth: [w[0]] }), c('りんごとみかん', { colspan: 2, colwidth: [w[1], w[2]], align: 'center', bg: 'yellow' })] },
        { type: 'tableRow', content: [c('3', { colwidth: [w[1]], align: 'right' }), c('120', { colwidth: [w[2]] })] },
        { type: 'tableRow', content: [c('野菜', { colwidth: [w[0]] }), c('', { colwidth: [w[1]], bg: 'gray' }), c('80', { colwidth: [w[2]], bg: 'green', align: 'right' })] },
      ],
    }
    // 見出しのセルの色・ふつうの表(幅なし)も並べて、取り違えないことを確かめる
    const plain: JSONContent = {
      type: 'table',
      attrs: { headerRow: false, headerColumn: false },
      content: [{ type: 'tableRow', content: [c('x', { bg: 'gray' }), c('y')] }],
    }
    const d = await exportedDocx('表', [page(doc(table, p(), plain, p()))])
    expect(pagesOf(d)[0].content).toEqual(doc(table, p(), plain, p()))
    expect(issueMessages(d.issues)).toEqual([])
  })

  it('紙の幅より広い表は、Word では比率を保って本文の幅に収める', () => {
    // 本文の幅は 9026 twip(約 601px)
    expect(docxColumnWidths([400, 400, 200], 3)).toEqual([3610, 3610, 1805])
    expect(docxColumnWidths([100, null], 2)).toEqual([1500, 1500])
    expect(docxColumnWidths(undefined, 2)).toBeNull()
    expect(docxColumnWidths([null, null], 2)).toBeNull()
  })

  it('1ページ目が空のノート・空のページも、ページの数が戻る', async () => {
    const d = await exportedDocx('題', [page(doc(p())), page(doc(p())), page(doc(p(t('3枚目'))))])
    expect(d.title).toBe('題')
    expect(pagesOf(d).map((pg) => pg.content)).toEqual([doc(p()), doc(p()), doc(p(t('3枚目')))])
  })
})

describe('Word で作ったファイル', () => {
  it('見出し(日本語版のスタイル・アウトラインレベル)と、先頭の見出し1をノート名に', async () => {
    const d = await parse(
      para('') +
        para(run('旅行の計画'), '<w:pStyle w:val="1"/>') +
        para(run('一日目'), '<w:pStyle w:val="2"/>') +
        para(run('細かい'), '<w:pStyle w:val="5"/>') +
        para(run('自分のスタイル'), '<w:pStyle w:val="mine"/>') +
        para(run('段落で指定'), '<w:outlineLvl w:val="1"/>') +
        para(run('2つ目の見出し1'), '<w:pStyle w:val="1"/>'),
    )
    expect(d.title).toBe('旅行の計画')
    // 見出しのスタイルの色(青)は文字色にしない
    expect(pagesOf(d)[0].content).toEqual(doc(h(2, '一日目'), h(3, '細かい'), h(3, '自分のスタイル'), h(2, '段落で指定'), h(1, '2つ目の見出し1')))
    expect(issueMessages(d.issues)).toContain('4段目より下の見出し(1か所)は、小見出しになりました')
  })

  it('表題のスタイルをノート名にする。表題がなく先頭が見出しでなければ null', async () => {
    expect((await parse(para(run('表題です'), '<w:pStyle w:val="a3"/>') + para(run('本文')))).title).toBe('表題です')
    expect((await parse(para(run('本文')) + para(run('見出し'), '<w:pStyle w:val="1"/>'))).title).toBeNull()
  })

  it('箇条書き・番号付き(開始番号・スタイルの段落番号)・Word のチェックボックス', async () => {
    const num = (id: number, lvl: number) => `<w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${id}"/></w:numPr>`
    const c = await firstPage(
      para(run('箇条'), '<w:pStyle w:val="ListBullet"/>') +
        para(run('入れ子'), num(1, 1)) +
        para(run('五'), num(3, 0)) +
        para(run('六'), num(3, 0)) +
        para(run('普通の段落')) +
        para(run('☐ 未完了'), num(1, 0)) +
        para('<w:r><w:sym w:font="Wingdings" w:char="F0FE"/></w:r>' + run(' 完了'), num(1, 0)),
    )
    expect(c).toEqual(
      doc(
        { type: 'bulletList', content: [li(p(t('箇条')), { type: 'bulletList', content: [li(p(t('入れ子')))] })] },
        { type: 'orderedList', attrs: { start: 5 }, content: [li(p(t('五'))), li(p(t('六')))] },
        p(t('普通の段落')),
        { type: 'taskList', content: [task(false, '未完了'), task(true, '完了')] },
      ),
    )
  })

  it('文字の装飾:マーカー(蛍光ペン)・近い色・文字スタイル・オフの指定', async () => {
    const c = await firstPage(
      para(
        run('黄', '<w:highlight w:val="yellow"/>') +
          run('水色', '<w:highlight w:val="cyan"/>') +
          run('ほぼ赤', '<w:color w:val="FF0000"/>') +
          run('黒', '<w:color w:val="000000"/>') +
          run('自動', '<w:color w:val="auto"/>') +
          run('強調', '<w:rStyle w:val="a4"/>') +
          run('太字オフ', '<w:rStyle w:val="a4"/><w:b w:val="0"/>') +
          run('二重取り消し', '<w:dstrike/>') +
          run('網かけ', '<w:shd w:val="clear" w:color="auto" w:fill="C6EFCE"/>'),
      ),
    )
    expect(c).toEqual(
      doc(
        p(
          t('黄', [marker('yellow')]),
          t('水色', [marker('blue')]),
          t('ほぼ赤', [color('red')]),
          t('黒自動'),
          t('強調', [{ type: 'bold' }]),
          t('太字オフ'),
          t('二重取り消し', [{ type: 'strike' }]),
          t('網かけ', [marker('green')]),
        ),
      ),
    )
  })

  it('リンク:Web のリンク・フィールドのリンクは戻し、危ないもの・文書の中の場所へのリンクは文字だけ', async () => {
    const d = await parse(
      para(
        `<w:hyperlink r:id="rWeb">${run('ウェブ', '<w:rStyle w:val="a5"/>')}</w:hyperlink>` +
          `<w:hyperlink r:id="rBad">${run('危ない')}</w:hyperlink>` +
          `<w:hyperlink w:anchor="_Toc1">${run('目次')}</w:hyperlink>` +
          '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK "https://example.org/x" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
          run('フィールド') +
          '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
          '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPERLINK "javascript:alert(1)" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
          run('悪いフィールド') +
          '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
          `<w:fldSimple w:instr="PAGE">${run('3')}</w:fldSimple>`,
      ),
    )
    const link = (href: string) => ({ type: 'link', attrs: { href } })
    expect(pagesOf(d)[0].content).toEqual(
      doc(p(t('ウェブ', [link('https://example.com/page')]), t('危ない目次'), t('フィールド', [link('https://example.org/x')]), t('悪いフィールド3'))),
    )
    expect(issueMessages(d.issues)).toEqual(['安全のため、開けないリンク(2か所)は文字だけにしました'])
  })

  it('改ページ:改ページの記号・段落の前で改ページ・セクション区切り。表示用の区切りは使わない', async () => {
    const d = await parse(
      pageBreak +
        para(run('一') + '<w:r><w:lastRenderedPageBreak/></w:r>' + run('続き')) +
        para(run('前') + pageBreak + run('後')) +
        para(run('段落の前'), '<w:pageBreakBefore/>') +
        para(run('セクションの終わり'), '<w:sectPr><w:type w:val="nextPage"/></w:sectPr>') +
        para(run('続けて'), '<w:sectPr><w:type w:val="continuous"/></w:sectPr>') +
        para(run('同じページ')),
    )
    expect(pagesOf(d).map((pg) => pg.content)).toEqual([
      doc(p(t('一続き')), p(t('前'))),
      doc(p(t('後'))),
      doc(p(t('段落の前')), p(t('セクションの終わり'))),
      doc(p(t('続けて')), p(t('同じページ'))),
    ])
  })

  it('表:結合したセルは結合したまま読み、セルの中の画像は表の後ろに置いて知らせる', async () => {
    const tc = (inner: string, tcPr = '') => `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ''}${inner}</w:tc>`
    const d = await parse(
      '<w:tbl>' +
        `<w:tr>${tc(para(run('横に2つ')), '<w:gridSpan w:val="2"/><w:shd w:fill="FFFF00"/>')}${tc(para(run('c')))}</w:tr>` +
        `<w:tr>${tc(para(run('縦')), '<w:vMerge w:val="restart"/>')}${tc(para(run('x')) + para(''))}${tc(para(drawing('rImg')))}</w:tr>` +
        `<w:tr>${tc(para(''), '<w:vMerge/>')}${tc(para(run('一') + '<w:r><w:br/></w:r>' + run('二')))}${tc(para(''))}</w:tr>` +
        '</w:tbl>' +
        para(''),
    )
    const cellOf = (paras: string[], bg: string | null = null, span: { colspan?: number; rowspan?: number } = {}): JSONContent => ({
      type: 'tableCell',
      attrs: { colspan: span.colspan ?? 1, rowspan: span.rowspan ?? 1, colwidth: null, align: null, bg },
      content: paras.length ? paras.map((s) => (s ? p(t(s)) : p())) : [p()],
    })
    expect(pagesOf(d)[0].content).toEqual(
      doc(
        {
          type: 'table',
          attrs: { headerRow: false, headerColumn: false },
          content: [
            { type: 'tableRow', content: [cellOf(['横に2つ'], 'yellow', { colspan: 2 }), cellOf(['c'])] },
            { type: 'tableRow', content: [cellOf(['縦'], null, { rowspan: 2 }), cellOf(['x']), cellOf([''])] },
            { type: 'tableRow', content: [cellOf(['一', '二']), cellOf([''])] },
          ],
        },
        { type: 'image', attrs: { imageId: 'img1', width: 1, height: 1 } },
      ),
    )
    // 結合したセルはお知らせしない(そのまま読めるため)
    expect(issueMessages(d.issues)).toEqual(['表の中の画像(1枚)は、表のすぐ後ろに置きました'])
  })

  it('画像:表示できない形式・ファイルの外の画像は「[画像]」、図形・テキストボックスは読み込まない', async () => {
    const d = await parse(
      para(drawing('rImg')) +
        para(run('前') + drawing('rEmf') + run('後')) +
        para(`<w:r><w:drawing><wp:inline><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:link="rFar"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`) +
        para('<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:txbx><w:txbxContent><w:p><w:r><w:t>箱の中</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice></mc:AlternateContent></w:r>' + run('本文')),
    )
    expect(pagesOf(d)[0].content).toEqual(
      doc({ type: 'image', attrs: { imageId: 'img1', width: 1, height: 1 } }, p(t('前[画像]後')), p(t('[画像]')), p(t('本文'))),
    )
    expect(d.images.size).toBe(1)
    expect(issueMessages(d.issues)).toEqual([
      'ファイルの外にある画像(1枚)は読み込めないため、「[画像]」と書きました',
      '表示できない形式の画像(1枚。EMF・WMF など)は、「[画像]」と書きました',
      '図形・テキストボックス・グラフ・数式(1か所)は、読み込んでいません',
    ])
  })

  it('斜体・脚注・コメント・変更履歴・ヘッダー・配置を知らせる(変更履歴は変更後の形で)', async () => {
    const d = await parse(
      para(
        run('斜め', '<w:i/>') +
          '<w:r><w:footnoteReference w:id="1"/></w:r>' +
          '<w:r><w:commentReference w:id="0"/></w:r>' +
          `<w:ins w:id="1" w:author="a">${run('足した')}</w:ins>` +
          `<w:del w:id="2" w:author="a"><w:r><w:delText>消した</w:delText></w:r></w:del>`,
        '<w:jc w:val="center"/>',
      ),
      {
        rels: `<Relationship Id="rHead" Type="${REL}/header" Target="header1.xml"/>`,
        files: { 'word/header1.xml': `<?xml version="1.0"?><w:hdr ${W_NS}><w:p><w:r><w:t>社外秘</w:t></w:r></w:p></w:hdr>` },
      },
    )
    expect(pagesOf(d)[0].content).toEqual(doc(p(t('斜め足した'))))
    expect(issueMessages(d.issues)).toEqual([
      '斜体(1か所)は、普通の文字になりました',
      '脚注・文末脚注(1か所)は、読み込んでいません',
      'コメント(1か所)は、読み込んでいません',
      'ヘッダー・フッターは、読み込んでいません',
      '変更履歴は、変更を反映したあとの形で読み込みました',
      '文字の大きさ・書体・配置(中央揃えなど)は読み込まず、めくりめくりの書き方にそろえました',
    ])
  })

  it('「hint」だけの書体の指定は、知らせない', async () => {
    const d = await parse(para(run('日本語', '<w:rFonts w:hint="eastAsia"/>')))
    expect(issueMessages(d.issues)).toEqual([])
  })
})

describe('Word の安全性・読み込めないファイル', () => {
  it('DOCTYPE(実体の定義)を含むファイルは読まない', async () => {
    const zip = await JSZip.loadAsync(await makeDocx(para(run('x'))))
    zip.file('word/document.xml', `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY a "aaaa">]><w:document ${W_NS}><w:body><w:p><w:r><w:t>&a;</w:t></w:r></w:p></w:body></w:document>`)
    await expect(parseDocx(await zip.generateAsync({ type: 'arraybuffer' }))).rejects.toThrow('読み込めない内容')
  })

  it('本文の中の文字はただの文字(HTML のタグ・script を書いても動かない)', async () => {
    const c = await firstPage(para(run('&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;')))
    expect(c).toEqual(doc(p(t('<script>alert(1)</script><img src=x onerror=alert(1)>'))))
  })

  it('zip でないファイル・古い .doc は、わかる言葉で断る', async () => {
    await expect(parseDocx(new TextEncoder().encode('これは Word ではない').buffer)).rejects.toThrow('Word のファイルを開けませんでした')
    await expect(parseFileData('古い.doc', '', new ArrayBuffer(1))).rejects.toThrow('.docx として保存し直して')
  })

  it('.docx を Word の形式として扱う', () => {
    expect(detectFormat('a.docx')).toBe('docx')
    expect(detectFormat('a.DOCX')).toBe('docx')
    expect(detectFormat('noext', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx')
  })
})

describe('Word の色 → めくりめくりの色', () => {
  it('書き出した色は、元の色に正確に戻る', () => {
    for (const [name, hex] of Object.entries(TEXT_HEX)) expect(nearestTextColor(hex.toUpperCase())).toBe(name)
    for (const [name, hex] of Object.entries(MARKER_HEX)) expect(nearestMarkerColor(hex)).toBe(name)
  })

  it('ほかの色は近い色に。黒・白・自動は色なし', () => {
    expect(nearestTextColor('000000')).toBeNull()
    expect(nearestTextColor('auto')).toBeNull()
    expect(nearestTextColor('FFFFFF')).toBeNull()
    expect(nearestTextColor('808080')).toBe('gray')
    expect(nearestTextColor('FF0000')).toBe('red')
    expect(nearestTextColor('0070C0')).toBe('blue')
    expect(nearestTextColor('00B050')).toBe('green')
    expect(nearestTextColor('7030A0')).toBe('purple')
    expect(nearestTextColor('FFC000')).toBe('yellow')
    expect(nearestTextColor('ED7D31')).toBe('orange')
    expect(nearestTextColor('843C0C')).toBe('brown')
    expect(nearestMarkerColor('FFFFFF')).toBeNull()
    expect(nearestMarkerColor('D9D9D9')).toBe('gray')
    expect(nearestMarkerColor('FFC7CE')).toBe('red')
    expect(nearestMarkerColor('DDEBF7')).toBe('blue')
    expect(highlightColor('magenta')).toBe('pink')
    expect(highlightColor('none')).toBeNull()
    expect(highlightColor('知らない')).toBeNull()
  })
})
