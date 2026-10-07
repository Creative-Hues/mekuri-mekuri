import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/db/db'
import { getPages } from '../src/db/repo'
import { fromBase64, parseBackup, toBase64 } from '../src/backup/format'
import { importAppend, importReplace } from '../src/backup/import'
import { legacyDesign, legacyDesignV3 } from '../src/design/defaults'
import { remapContentIds } from '../src/editor/contentWalk'

// v4 のバックアップ(画像入り)と、「追加」で読み込むときの参照の書き換え

beforeEach(async () => {
  await db.notes.clear()
  await db.pages.clear()
  await db.images.clear()
})

const note = (id: string, title: string) => ({
  id, title, order: 0, favorite: false, deletedAt: null, design: legacyDesign(), createdAt: 1, updatedAt: 1,
})
const page = (id: string, noteId: string, content: object, stickies: object[] = []) => ({
  id, noteId, order: 0, content, stickies, deletedAt: null, deletedIndex: null, createdAt: 1, updatedAt: 1,
})
const PNG = toBase64(new Uint8Array([137, 80, 78, 71, 1, 2, 3]).buffer)

/** ノートA(画像とノートBへのリンク)とノートB */
function v4File() {
  const content = {
    type: 'doc',
    content: [
      { type: 'image', attrs: { imageId: 'img1', width: 4, height: 3 } },
      { type: 'noteLink', attrs: { noteId: 'nB', pageId: 'pB' } },
      { type: 'noteLink', attrs: { noteId: 'よそのノート', pageId: null } },
    ],
  }
  const sticky = {
    id: 's1', x: 0, y: 0, w: 0.3, h: 0.3, color: 'yellow', createdAt: 1, updatedAt: 1,
    content: { type: 'doc', content: [{ type: 'image', attrs: { imageId: 'img1' } }] },
  }
  return JSON.stringify({
    app: 'mekuri-mekuri', schemaVersion: 4, appVersion: '0.5.0', exportedAt: 1,
    notes: [note('nA', 'A'), note('nB', 'B')],
    pages: [page('pA', 'nA', content, [sticky]), page('pB', 'nB', { type: 'doc', content: [{ type: 'paragraph' }] })],
    images: [{ id: 'img1', mime: 'image/png', data: PNG, width: 4, height: 3 }],
  })
}

describe('base64 の変換', () => {
  it('行って戻ると同じデータ(大きなデータでも)', () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 256)
    expect([...new Uint8Array(fromBase64(toBase64(big.buffer)))]).toEqual([...big])
  })
})

describe('v4 のバックアップ', () => {
  it('v3 のファイルは画像なしの最新の形(v5)になる', () => {
    const file = JSON.stringify({
      app: 'mekuri-mekuri', schemaVersion: 3, appVersion: '0.4.0', exportedAt: 1,
      notes: [note('n1', 'a')], pages: [page('p1', 'n1', { type: 'doc', content: [] })],
    })
    const backup = parseBackup(file)
    expect(backup.schemaVersion).toBe(5)
    expect(backup.images).toEqual([])
  })

  it('壊れた画像の入ったファイルは読み込まない', () => {
    const bad = JSON.parse(v4File())
    bad.images[0].mime = 'text/html'
    expect(() => parseBackup(JSON.stringify(bad))).toThrow(/画像の情報が壊れています/)
  })

  it('置き換える:画像のデータもそのまま戻る', async () => {
    await importReplace(parseBackup(v4File()))
    const img = await db.images.get('img1')
    expect(img).toMatchObject({ mime: 'image/png', width: 4, height: 3, unusedSince: null })
    expect([...new Uint8Array(img!.data)]).toEqual([137, 80, 78, 71, 1, 2, 3])
  })

  it('追加する:画像・ノート・ページの id を振り直し、本文と付箋の中の参照も新しい id にする', async () => {
    await importAppend(parseBackup(v4File()))
    await importAppend(parseBackup(v4File())) // 2回読み込んでも id がぶつからない
    expect(await db.images.count()).toBe(2)

    const notes = await db.notes.toArray()
    const a = notes.find((n) => n.title === 'A')!
    const [pa] = await getPages(a.id)
    const imageId = pa.content.content![0].attrs!.imageId
    expect(imageId).not.toBe('img1')
    expect(await db.images.get(imageId)).toBeTruthy()
    expect(pa.stickies[0].content.content![0].attrs!.imageId).toBe(imageId)

    // ノートBへのリンクは、一緒に読み込んだノートBの新しい id を指す
    const link = pa.content.content![1].attrs!
    const bIds = new Set(notes.filter((n) => n.title === 'B').map((n) => n.id))
    expect(bIds.has(link.noteId)).toBe(true)
    const [pb] = await getPages(link.noteId)
    expect(link.pageId).toBe(pb.id)
    // ファイルの外のノートへのリンクはそのまま
    expect(pa.content.content![2].attrs!.noteId).toBe('よそのノート')
  })
})

describe('v5 のバックアップ(本文の書体・サブ色・柄の大きさ。アプリ 1.1.0〜)', () => {
  /** 1.0.0 で書き出したファイル(デザインは v4 の形) */
  const v4DesignFile = () =>
    JSON.stringify({
      app: 'mekuri-mekuri', schemaVersion: 4, appVersion: '1.0.0', exportedAt: 1,
      notes: [
        { ...note('n1', '青海波'), design: { ...legacyDesignV3(), cover: { ...legacyDesignV3().cover, pattern: 'seigaiha', font: 'mincho' } } },
        { ...note('n2', 'ドット'), design: { ...legacyDesignV3(), paper: 'mint', cover: { ...legacyDesignV3().cover, pattern: 'dots' } } },
      ],
      pages: [page('p1', 'n1', { type: 'doc', content: [] })],
      images: [],
    })

  it('v4 のファイルは v5 に変換される:なくした柄は無地、本文は表紙と同じ、なじむ色・中', () => {
    const backup = parseBackup(v4DesignFile())
    expect(backup.schemaVersion).toBe(5)
    const [a, b] = backup.notes
    expect(a.design.cover).toEqual({
      pattern: 'plain', color: 'slate', layout: 'topLeft', font: 'mincho', subColor: 'auto', patternScale: 'medium',
    })
    expect(a.design.bodyFont).toBe('cover')
    expect(b.design.cover.pattern).toBe('dots')
    expect(b.design.paper).toBe('mint')
  })

  it('v5 のファイルは、選んだサブ色・柄の大きさ・本文の書体のまま読める', () => {
    const design = { ...legacyDesign(), bodyFont: 'maru', cover: { ...legacyDesign().cover, pattern: 'dots', subColor: 'white', patternScale: 'large' } }
    const file = JSON.stringify({
      app: 'mekuri-mekuri', schemaVersion: 5, appVersion: '1.1.0', exportedAt: 1,
      notes: [{ ...note('n1', 'a'), design }], pages: [], images: [],
    })
    expect(parseBackup(file).notes[0].design).toEqual(design)
  })

  it('置き換えて読み込むと、DB にも v5 の形で入る', async () => {
    await importReplace(parseBackup(v4DesignFile()))
    const n1 = await db.notes.get('n1')
    expect(n1!.design).toMatchObject({ bodyFont: 'cover', cover: { pattern: 'plain', subColor: 'auto', patternScale: 'medium' } })
  })
})

describe('参照の書き換え(remapContentIds)', () => {
  it('元の JSON は変えない', () => {
    const doc = { type: 'doc', content: [{ type: 'image', attrs: { imageId: 'a' } }] }
    const out = remapContentIds(doc, { images: new Map([['a', 'b']]), notes: new Map(), pages: new Map() })
    expect(out.content![0].attrs!.imageId).toBe('b')
    expect(doc.content[0].attrs.imageId).toBe('a')
  })
})
