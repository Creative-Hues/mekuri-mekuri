import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/db/db'
import { createNote, getPages, savePageContent, savePageStickies, trashNote, trashPage, insertPage } from '../src/db/repo'
import { IMAGE_GRACE_DAYS, cleanupImages, planImageCleanup, saveImage } from '../src/images/store'
import { fitSize, outputType } from '../src/images/resize'
import { collectImageIds } from '../src/editor/contentWalk'
import { createSticky } from '../src/editor/sticky'

// 画像:縮小の大きさ・保存・使われていない画像の片付け(30日の猶予)

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date(2026, 9, 7, 12, 0).getTime()

describe('縮小の大きさ(fitSize)', () => {
  it('長い辺を1600pxにし、縦横比を保つ', () => {
    expect(fitSize(4032, 3024)).toEqual({ width: 1600, height: 1200 })
    expect(fitSize(3024, 4032)).toEqual({ width: 1200, height: 1600 })
  })
  it('小さい画像は拡大しない', () => {
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitSize(1600, 10)).toEqual({ width: 1600, height: 10 })
  })
  it('とても細長い画像でも1px以上', () => {
    expect(fitSize(10000, 2)).toEqual({ width: 1600, height: 1 })
  })
  it('PNG は PNG のまま、それ以外は JPEG にする', () => {
    expect(outputType('image/png')).toBe('image/png')
    expect(outputType('image/jpeg')).toBe('image/jpeg')
    expect(outputType('image/heic')).toBe('image/jpeg')
    expect(outputType('')).toBe('image/jpeg')
  })
})

describe('片付けの計画(planImageCleanup)', () => {
  const used = new Set(['a'])

  it('使われていない画像は、初めて見つけたときは日時を記録するだけで消さない', () => {
    expect(planImageCleanup([{ id: 'b', unusedSince: null }], used, NOW)).toEqual({ clear: [], mark: ['b'], remove: [] })
  })

  it('使われていない状態が29日では消さない', () => {
    const plan = planImageCleanup([{ id: 'b', unusedSince: NOW - 29 * DAY }], used, NOW)
    expect(plan.remove).toEqual([])
    expect(plan.mark).toEqual([]) // 最初に見つけた日時はそのまま
  })

  it(`使われていない状態が${IMAGE_GRACE_DAYS}日続いたら消す`, () => {
    expect(planImageCleanup([{ id: 'b', unusedSince: NOW - 30 * DAY }], used, NOW).remove).toEqual(['b'])
  })

  it('また使われるようになったら、記録を消す(null に戻す)', () => {
    expect(planImageCleanup([{ id: 'a', unusedSince: NOW - 40 * DAY }], used, NOW)).toEqual({
      clear: ['a'],
      mark: [],
      remove: [],
    })
  })

  it('使われている画像は何もしない', () => {
    expect(planImageCleanup([{ id: 'a', unusedSince: null }], used, NOW)).toEqual({ clear: [], mark: [], remove: [] })
  })
})

const imageDoc = (...ids: string[]) => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: '写真' }] },
    ...ids.map((imageId) => ({ type: 'image', attrs: { imageId, width: 10, height: 10 } })),
  ],
})

describe('使われていない画像の片付け(データベース)', () => {
  beforeEach(async () => {
    await db.notes.clear()
    await db.pages.clear()
    await db.images.clear()
  })

  const newImage = () => saveImage({ data: new Uint8Array([1, 2, 3]).buffer, mime: 'image/png', width: 10, height: 10 })
  const unusedSince = async (id: string) => (await db.images.get(id))?.unusedSince

  it('保存した画像は、データと大きさが読み出せる', async () => {
    const id = await newImage()
    const rec = await db.images.get(id)
    expect(rec).toMatchObject({ mime: 'image/png', width: 10, height: 10, unusedSince: null })
    expect([...new Uint8Array(rec!.data)]).toEqual([1, 2, 3])
  })

  it('本文で使っている画像は消さず、使っていない画像は日時の記録だけ', async () => {
    const note = await createNote('写真')
    const page = (await getPages(note.id))[0]
    const used = await newImage()
    const unused = await newImage()
    await savePageContent(page.id, imageDoc(used))

    await cleanupImages(NOW)
    expect(await unusedSince(used)).toBeNull()
    expect(await unusedSince(unused)).toBe(NOW)
    expect(await db.images.count()).toBe(2)
  })

  it('29日後はまだ残り、30日後に消える', async () => {
    const unused = await newImage()
    await cleanupImages(NOW)
    await cleanupImages(NOW + 29 * DAY)
    expect(await db.images.get(unused)).toBeTruthy()
    await cleanupImages(NOW + 30 * DAY)
    expect(await db.images.get(unused)).toBeUndefined()
  })

  it('いったん使われなくなっても、また使えば消えない', async () => {
    const note = await createNote('写真')
    const page = (await getPages(note.id))[0]
    const id = await newImage()
    await cleanupImages(NOW) // 使われていない → 記録
    await savePageContent(page.id, imageDoc(id)) // 元に戻すなどで、また使われた
    await cleanupImages(NOW + 20 * DAY)
    expect(await unusedSince(id)).toBeNull()
    await cleanupImages(NOW + 60 * DAY)
    expect(await db.images.get(id)).toBeTruthy()
  })

  it('ゴミ箱のページ・ゴミ箱のノートの中で使っている画像は消さない', async () => {
    const a = await createNote('ゴミ箱のノート')
    const b = await createNote('ページだけゴミ箱')
    await insertPage(b.id, 1)
    const [pa] = await getPages(a.id)
    const [, pb] = await getPages(b.id)
    const inNote = await newImage()
    const inPage = await newImage()
    await savePageContent(pa.id, imageDoc(inNote))
    await savePageContent(pb.id, imageDoc(inPage))
    await trashNote(a.id)
    await trashPage(pb.id)

    await cleanupImages(NOW)
    await cleanupImages(NOW + 100 * DAY)
    expect(await db.images.get(inNote)).toBeTruthy()
    expect(await db.images.get(inPage)).toBeTruthy()
  })

  it('付箋の中で使っている画像も消さない', async () => {
    const note = await createNote('付箋')
    const page = (await getPages(note.id))[0]
    const id = await newImage()
    const sticky = { ...createSticky('yellow', 0.2), content: imageDoc(id) }
    await savePageStickies(page.id, [sticky])
    await cleanupImages(NOW)
    expect(await unusedSince(id)).toBeNull()
  })
})

describe('本文の画像の参照集め', () => {
  it('入れ子の中の画像も集める', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { imageId: 'x' } },
        { type: 'toggleHeading', content: [{ type: 'toggleTitle' }, { type: 'image', attrs: { imageId: 'y' } }] },
      ],
    }
    expect([...collectImageIds(doc)].sort()).toEqual(['x', 'y'])
  })
})
