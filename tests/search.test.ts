import { afterEach, describe, expect, it } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import { buildExtensions } from '../src/editor/extensions'
import { findAll, findOccurrence, normalize, searchNotes, textBlocks } from '../src/search/search'
import { legacyDesign } from '../src/design/defaults'
import type { Note, Page, Sticky } from '../src/db/db'

// 全ノート検索:見つけ方・結果・エディタの中の位置

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const note = (id: string, title: string, over: Partial<Note> = {}): Note => ({
  id, title, order: 0, favorite: false, deletedAt: null, design: legacyDesign(), createdAt: 0, updatedAt: 0, ...over,
})
const page = (id: string, noteId: string, order: number, content: JSONContent, over: Partial<Page> = {}): Page => ({
  id, noteId, order, content, stickies: [], deletedAt: null, deletedIndex: null, createdAt: 0, updatedAt: 0, ...over,
})
const sticky = (id: string, text: string): Sticky => ({
  id, x: 0, y: 0, w: 0.3, h: 0.3, color: 'yellow', content: doc(para(text)), createdAt: 0, updatedAt: 0,
})

describe('文字のそろえ方', () => {
  it('全角/半角・大文字/小文字・半角カナの濁点を区別しない', () => {
    expect(normalize('ＡＢＣ１２３')).toBe(normalize('abc123'))
    expect(normalize('ｶﾞｷﾞ')).toBe(normalize('ガギ'))
    expect(normalize('Tokyo')).toBe(normalize('TOKYO'))
  })

  it('見つかった場所は元の文字列の位置で返す', () => {
    expect(findAll('今日はＴＯＫＹＯへ', 'tokyo')).toEqual([{ start: 3, end: 8 }])
    expect(findAll('ｶﾞｲﾄﾞとガイド', 'ガイド')).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 9 },
    ])
  })

  it('空の言葉では何も見つけない', () => {
    expect(findAll('あいう', '  ')).toEqual([])
  })
})

describe('ページの文字のまとまり', () => {
  it('見出し・トグル見出し・リスト・表のセルの文字を、文書の順に集める', () => {
    const content = doc(
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '見出し' }] },
      { type: 'toggleHeading', attrs: { level: 2, open: false }, content: [{ type: 'toggleTitle', content: [{ type: 'text', text: 'トグル' }] }, para('中身')] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [para('項目')] }] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [para('セル')] }] }] },
      { type: 'image', attrs: { imageId: 'x' } },
    )
    expect(textBlocks(content)).toEqual(['見出し', 'トグル', '中身', '項目', 'セル'])
  })
})

describe('全ノート検索(searchNotes)', () => {
  const notes = [note('n1', '旅行の計画'), note('n2', '買い物'), note('n3', '捨てたノート', { deletedAt: 1 })]
  const pages = [
    page('p1', 'n1', 0, doc(para('京都へ行く'), para('京都タワー'))),
    page('p2', 'n1', 1, doc(para('お土産:八ツ橋')), { stickies: [sticky('s1', '京都駅で買う')] }),
    page('p3', 'n2', 0, doc({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [para('京都の牛乳')] }] }] })),
    page('p4', 'n2', 1, doc(para('京都(ゴミ箱のページ)')), { deletedAt: 5 }),
    page('p5', 'n3', 0, doc(para('京都(ゴミ箱のノート)'))),
  ]

  it('本文・付箋・表から見つけ、ページ番号と何番目かを返す', () => {
    const r = searchNotes(notes, pages, '京都')
    expect(r.map((x) => x.note.id)).toEqual(['n1', 'n2'])
    const hits = r[0].hits
    expect(hits.map((h) => [h.pageNumber, h.stickyId, h.occurrence])).toEqual([
      [1, null, 0],
      [1, null, 1],
      [2, 's1', 0],
    ])
    expect(hits[1].snippet).toEqual({ before: '', match: '京都', after: 'タワー' })
    expect(r[1].hits[0].snippet.match).toBe('京都')
  })

  it('ゴミ箱のノート・ページは探さない', () => {
    const r = searchNotes(notes, pages, 'ゴミ箱')
    expect(r).toEqual([])
  })

  it('タイトルだけ当たったノートも出す', () => {
    const r = searchNotes(notes, pages, '計画')
    expect(r).toHaveLength(1)
    expect(r[0].titleMatch).toBe(true)
    expect(r[0].hits).toEqual([])
  })

  it('長い文は前後を「…」で切る', () => {
    const long = 'あ'.repeat(30) + '目印' + 'い'.repeat(60)
    const [hit] = searchNotes([note('n', 'x')], [page('p', 'n', 0, doc(para(long)))], '目印')[0].hits
    expect(hit.snippet.before.startsWith('…')).toBe(true)
    expect(hit.snippet.after.endsWith('…')).toBe(true)
  })
})

describe('エディタの中の位置(findOccurrence)', () => {
  let editor: Editor | null = null
  afterEach(() => editor?.destroy())

  it('検索結果の「何番目」と、エディタの中の位置が一致する(改行・装飾・表があっても)', () => {
    const content = doc(
      para('りんごとみかん'),
      { type: 'paragraph', content: [
        { type: 'text', text: 'リン' },
        { type: 'text', text: 'ゴ', marks: [{ type: 'bold' }] },
        { type: 'hardBreak' },
        { type: 'text', text: 'ﾘﾝｺﾞ' },
      ] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [para('りんご')] }] }] },
    )
    editor = new Editor({ extensions: buildExtensions({ undo: () => {}, redo: () => {}, closeGroup: () => {} }), content })
    const hits = searchNotes([note('n', 'x')], [page('p', 'n', 0, content)], 'りんご')[0].hits
    // ひらがなとカタカナは区別するので、「りんご」は1行目と表の中の2つ
    expect(hits).toHaveLength(2)
    const ranges = hits.map((h) => findOccurrence(editor!.state.doc, 'りんご', h.occurrence)!)
    expect(ranges.map((r) => editor!.state.doc.textBetween(r.from, r.to))).toEqual(['りんご', 'りんご'])

    // カタカナ:全角(太字をまたぐ)と半角
    const kata = searchNotes([note('n', 'x')], [page('p', 'n', 0, content)], 'リンゴ')[0].hits
    expect(kata).toHaveLength(2)
    expect(editor.state.doc.textBetween(...Object.values(findOccurrence(editor.state.doc, 'リンゴ', 0)!) as [number, number])).toBe('リンゴ')
    expect(editor.state.doc.textBetween(...Object.values(findOccurrence(editor.state.doc, 'リンゴ', 1)!) as [number, number])).toBe('ﾘﾝｺﾞ')
    expect(findOccurrence(editor.state.doc, 'リンゴ', 2)).toBeNull()
  })
})
