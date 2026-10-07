import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/db/db'
import { createNote, getPages, getShelfNotes, savePageContent } from '../src/db/repo'
import { importFiles, saveImportedDoc, stickyBox, type PrepareImage } from '../src/import/importFiles'
import { parseMarkdown } from '../src/import/fromMarkdown'
import { collectImageIds } from '../src/editor/contentWalk'
import { MAX_H } from '../src/editor/sticky'
import { Packer } from 'docx'
import { buildDocx } from '../src/export/toDocx'
import { buildExportNote } from '../src/export/model'

// 読み込んだファイルを、新しいノートとして保存する

/** テストでは画像の縮小(canvas)を使わず、そのまま保存する */
const prepare: PrepareImage = async (img) => ({ data: img.data, mime: img.mime, width: 10, height: 20 })
const file = (name: string, text: string, type = '') => new File([text], name, { type })

beforeEach(async () => {
  await db.notes.clear()
  await db.pages.clear()
  await db.images.clear()
})

describe('新しいノートとして保存する', () => {
  it('1ファイル1ノート。選んだ順に本棚の先頭へ入り、今あるノートは変わらない', async () => {
    const old = await createNote('前からあるノート')
    const [oldPage] = await getPages(old.id)
    await savePageContent(oldPage.id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '元の本文' }] }] })
    const before = await db.pages.get(oldPage.id)

    const results = await importFiles([file('一つ目.md', '# 題A\n\n本文A\n\n---\n\n2ページ目\n'), file('二つ目.txt', '本文B\n')], prepare)
    expect(results.map((r) => r.ok && r.note.title)).toEqual(['題A', '二つ目'])

    const shelf = await getShelfNotes()
    expect(shelf.map((n) => n.title)).toEqual(['題A', '二つ目', '前からあるノート'])
    // 今あるノートのページは変わらない
    expect(await db.pages.get(oldPage.id)).toEqual(before)
    expect(await getPages(old.id)).toHaveLength(1)

    const a = results[0].ok ? results[0].note : null
    const pages = await getPages(a!.id)
    expect(pages.map((p) => p.order)).toEqual([0, 1])
    expect(pages[0].content).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '本文A' }] }] })
    expect(a!.design.cover.color).toBeTruthy()
    expect(a!.favorite).toBe(false)
  })

  it('Word のファイルを、画像・付箋つきのノートにする', async () => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0))
    const note = buildExportNote(
      '旅のしおり',
      [
        {
          id: 'p', noteId: 'n', order: 0, deletedAt: null, deletedIndex: null, createdAt: 0, updatedAt: 0,
          content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '本文' }] }, { type: 'image', attrs: { imageId: 'i', width: 1, height: 1 } }] },
          stickies: [{ id: 's', x: 0, y: 0, w: 0.3, h: 0.3, color: 'orange', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '持ち物' }] }] }, createdAt: 0, updatedAt: 0 }],
        },
      ],
      () => '',
    )
    const buf = await Packer.toBuffer(buildDocx(note, new Map([['i', { data: png.buffer, mime: 'image/png', width: 1, height: 1 }]])))
    const [r] = await importFiles([new File([new Uint8Array(buf)], 'しおり.docx')], prepare)
    expect(r.ok && r.note.title).toBe('旅のしおり')
    const [page] = await getPages(r.ok ? r.note.id : '')
    expect([...collectImageIds(page.content)]).toEqual((await db.images.toArray()).map((i) => i.id))
    expect(page.stickies.map((s) => s.color)).toEqual(['orange'])
  })

  it('読めないファイルがあっても、ほかのファイルは読み込む', async () => {
    const results = await importFiles([file('a.pdf', 'x'), file('空.txt', '\n\n'), file('b.txt', 'ok')], prepare)
    expect(results).toEqual([
      { fileName: 'a.pdf', ok: false, error: expect.stringContaining('対応していない形式') },
      { fileName: '空.txt', ok: false, error: '中身が空のファイルです' },
      expect.objectContaining({ fileName: 'b.txt', ok: true }),
    ])
    expect(await db.notes.count()).toBe(1)
  })

  it('付箋を色つきで戻し、右上から少しずつずらして置く', async () => {
    const doc = parseMarkdown('本文\n\n**付箋(ピンク)**\n\n> 一\n\n**付箋(緑)**\n\n> 二\n')
    const { note } = await saveImportedDoc(doc, 'x.md', prepare)
    const [page] = await getPages(note.id)
    expect(page.stickies.map((s) => s.color)).toEqual(['pink', 'green'])
    expect(page.stickies[0].x).toBeGreaterThan(page.stickies[1].x)
    expect(page.stickies[0].y).toBeLessThan(page.stickies[1].y)
    for (const s of page.stickies) expect(s.x + s.w).toBeLessThanOrEqual(1)
  })

  it('付箋の大きさは、紙の中に収まり、行が多いと高くなる', () => {
    for (let i = 0; i < 20; i++) {
      const box = stickyBox(i, 3)
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.w).toBeLessThanOrEqual(1)
    }
    expect(stickyBox(0, 10).h).toBeGreaterThan(stickyBox(0, 1).h)
    expect(stickyBox(0, 1000).h).toBe(MAX_H)
  })

  it('ファイルの中の画像を images に保存し、本文から参照する。付箋の中の画像は「[画像]」にする', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgo='
    const doc = parseMarkdown(`![a](${png})\n\n**付箋(黄)**\n\n> ![b](${png})\n`)
    const { note } = await saveImportedDoc(doc, 'x.md', prepare)
    const [page] = await getPages(note.id)
    const ids = collectImageIds(page.content)
    expect(ids.size).toBe(1)
    const images = await db.images.toArray()
    expect(images.map((i) => i.id)).toEqual([...ids])
    expect(images[0]).toMatchObject({ mime: 'image/png', width: 10, height: 20, unusedSince: null })
    expect(JSON.stringify(page.stickies[0].content)).toContain('[画像]')
  })

  it('開けない画像は「[画像]」にして知らせる', async () => {
    const doc = parseMarkdown('![a](data:image/png;base64,iVBORw0KGgo=)\n')
    const { note, messages } = await saveImportedDoc(doc, 'x.md', async () => null)
    const [page] = await getPages(note.id)
    expect(JSON.stringify(page.content)).toContain('[画像]')
    expect(messages).toEqual(['開けなかった画像(1枚)は、「[画像]」と書きました'])
    expect(await db.images.count()).toBe(0)
  })

  it('保存に失敗したら、ノートも画像も残さない', async () => {
    const doc = parseMarkdown('![a](data:image/png;base64,iVBORw0KGgo=)\n\n本文\n')
    // 最後の手順(ページの保存)で失敗させる。先に入れたノート・画像も取り消される
    const orig = db.pages.bulkAdd
    db.pages.bulkAdd = (() => Promise.reject(new Error('失敗'))) as typeof db.pages.bulkAdd
    try {
      await expect(saveImportedDoc(doc, 'a.md', prepare)).rejects.toThrow('失敗')
    } finally {
      db.pages.bulkAdd = orig
    }
    expect(await db.notes.count()).toBe(0)
    expect(await db.images.count()).toBe(0)
    expect(await db.pages.count()).toBe(0)
  })
})
