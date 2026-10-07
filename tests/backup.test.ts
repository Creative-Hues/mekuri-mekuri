import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/db/db'
import { createNote, getPages } from '../src/db/repo'
import { BackupError, parseBackup } from '../src/backup/format'
import { importAppend, importReplace } from '../src/backup/import'
import { legacyDesign } from '../src/design/defaults'

// バックアップファイルの読み込み(特に v1 = アプリ 0.1.0 で書き出したファイル)のテスト

beforeEach(async () => {
  await db.notes.clear()
  await db.pages.clear()
})

const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'こんにちは' }] }] }

/** 0.1.0 のアプリが書き出したのと同じ形のファイル */
function v1File() {
  return JSON.stringify({
    app: 'mekuri-mekuri',
    schemaVersion: 1,
    appVersion: '0.1.0',
    exportedAt: 1759740000000,
    notes: [{ id: 'n1', title: '旅行メモ', order: 0, createdAt: 1, updatedAt: 2 }],
    pages: [
      { id: 'p1', noteId: 'n1', order: 0, content, createdAt: 1, updatedAt: 2 },
      { id: 'p2', noteId: 'n1', order: 1, content, createdAt: 1, updatedAt: 2 },
    ],
  })
}

describe('バックアップの読み取り(parseBackup)', () => {
  it('v1 のファイルは今の形(v6)に変換される(付箋は空・ゴミ箱でない・今までの見た目)', () => {
    const backup = parseBackup(v1File())
    expect(backup.schemaVersion).toBe(6)
    expect(backup.notes[0]).toMatchObject({ favorite: false, deletedAt: null, design: legacyDesign() })
    expect(backup.notes).toHaveLength(1)
    expect(backup.pages).toHaveLength(2)
    for (const p of backup.pages) {
      expect(p.stickies).toEqual([])
      expect(p.content).toEqual(content)
      expect(p.deletedAt).toBeNull()
    }
  })

  it('v2 のファイルはそのまま読める(付箋も)', () => {
    const sticky = {
      id: 's1', x: 0.1, y: 0.2, w: 0.3, h: 0.3, color: 'yellow',
      content: { type: 'doc', content: [{ type: 'paragraph' }] }, createdAt: 1, updatedAt: 1,
    }
    const file = JSON.stringify({
      app: 'mekuri-mekuri', schemaVersion: 2, appVersion: '0.2.0', exportedAt: 1,
      notes: [{ id: 'n1', title: 'a', order: 0, createdAt: 1, updatedAt: 1 }],
      pages: [{ id: 'p1', noteId: 'n1', order: 0, content, stickies: [sticky], createdAt: 1, updatedAt: 1 }],
    })
    expect(parseBackup(file).pages[0].stickies).toEqual([sticky])
  })

  it('今より新しい版のファイルは読み込まない', () => {
    const file = JSON.stringify({ app: 'mekuri-mekuri', schemaVersion: 99, notes: [], pages: [] })
    expect(() => parseBackup(file)).toThrow(BackupError)
    expect(() => parseBackup(file)).toThrow(/新しいバージョン/)
  })

  it('壊れた付箋が入ったファイルは読み込まない', () => {
    const file = JSON.stringify({
      app: 'mekuri-mekuri', schemaVersion: 2, appVersion: '0.2.0', exportedAt: 1,
      notes: [{ id: 'n1', title: 'a', order: 0 }],
      pages: [{ id: 'p1', noteId: 'n1', order: 0, content, stickies: [{ id: 's1', x: 'abc' }] }],
    })
    expect(() => parseBackup(file)).toThrow(/付箋の情報が壊れています/)
  })

  it('めくりめくりのファイルでなければ読み込まない', () => {
    expect(() => parseBackup('{"hello":1}')).toThrow(BackupError)
    expect(() => parseBackup('これはJSONではない')).toThrow(BackupError)
  })
})

describe('v1 のバックアップを読み込む', () => {
  it('置き換える:今のノートは消え、ファイルのノートだけになる。付箋は空', async () => {
    await createNote('消えるノート')
    await importReplace(parseBackup(v1File()))
    const notes = await db.notes.toArray()
    expect(notes.map((n) => n.title)).toEqual(['旅行メモ'])
    const pages = await getPages('n1')
    expect(pages.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(pages.every((p) => Array.isArray(p.stickies) && p.stickies.length === 0)).toBe(true)
  })

  it('追加する:今のノートは残り、ファイルのノートは新しい id で本棚の先頭に入る', async () => {
    const existing = await createNote('前からあるノート')
    await importAppend(parseBackup(v1File()))

    const notes = await db.notes.orderBy('order').toArray()
    expect(notes.map((n) => n.title)).toEqual(['旅行メモ', '前からあるノート'])
    const added = notes[0]
    expect(added.id).not.toBe('n1')
    expect(await db.notes.get(existing.id)).toBeTruthy()

    const pages = await getPages(added.id)
    expect(pages).toHaveLength(2)
    expect(pages.map((p) => p.id)).not.toContain('p1')
    expect(pages.every((p) => p.stickies.length === 0 && p.content.type === 'doc')).toBe(true)
  })

  it('同じ v1 ファイルを2回「追加」しても、id がぶつからない', async () => {
    await importAppend(parseBackup(v1File()))
    await importAppend(parseBackup(v1File()))
    expect(await db.notes.count()).toBe(2)
    expect(await db.pages.count()).toBe(4)
  })

  it('追加するとき、付箋の id も振り直す', async () => {
    const file = JSON.stringify({
      app: 'mekuri-mekuri', schemaVersion: 2, appVersion: '0.2.0', exportedAt: 1,
      notes: [{ id: 'n1', title: 'a', order: 0, createdAt: 1, updatedAt: 1 }],
      pages: [{
        id: 'p1', noteId: 'n1', order: 0, content, createdAt: 1, updatedAt: 1,
        stickies: [{ id: 's1', x: 0, y: 0, w: 0.3, h: 0.3, color: 'pink', content, createdAt: 1, updatedAt: 1 }],
      }],
    })
    await importAppend(parseBackup(file))
    const page = (await db.pages.toArray())[0]
    expect(page.stickies).toHaveLength(1)
    expect(page.stickies[0].id).not.toBe('s1')
    expect(page.stickies[0].color).toBe('pink')
  })
})

/** 今のアプリ(v3)が書き出す形のファイル */
function v3File(over: { notes?: object[]; pages?: object[] } = {}) {
  return JSON.stringify({
    app: 'mekuri-mekuri', schemaVersion: 3, appVersion: '0.4.0', exportedAt: 1,
    notes: over.notes ?? [
      {
        id: 'n1', title: 'お気に入り', order: 0, favorite: true, deletedAt: null, createdAt: 1, updatedAt: 1,
        design: {
          paper: 'mint', border: { color: 'blue', width: 'medium' },
          cover: { pattern: 'dots', color: 'navy', layout: 'label', font: 'mincho' },
        },
      },
      { id: 'n2', title: 'ゴミ箱のノート', order: 1, favorite: false, deletedAt: 500, createdAt: 1, updatedAt: 1, design: legacyDesign() },
    ],
    pages: over.pages ?? [
      { id: 'p1', noteId: 'n1', order: 0, content, stickies: [], deletedAt: null, deletedIndex: null, createdAt: 1, updatedAt: 1 },
      { id: 'p2', noteId: 'n1', order: 1, content, stickies: [], deletedAt: 700, deletedIndex: 1, createdAt: 1, updatedAt: 1 },
      { id: 'p3', noteId: 'n2', order: 0, content, stickies: [], deletedAt: null, deletedIndex: null, createdAt: 1, updatedAt: 1 },
    ],
  })
}

describe('v3 のバックアップ(お気に入り・ゴミ箱・デザイン)', () => {
  it('v2 のファイルは今の形に変換され、今までと同じ見た目になる', () => {
    const file = JSON.stringify({
      app: 'mekuri-mekuri', schemaVersion: 2, appVersion: '0.3.0', exportedAt: 1,
      notes: [{ id: 'n1', title: 'a', order: 0, createdAt: 1, updatedAt: 1 }],
      pages: [{ id: 'p1', noteId: 'n1', order: 0, content, stickies: [], createdAt: 1, updatedAt: 1 }],
    })
    const backup = parseBackup(file)
    expect(backup.schemaVersion).toBe(6)
    expect(backup.notes[0]).toMatchObject({ favorite: false, deletedAt: null, design: legacyDesign() })
    expect(backup.pages[0]).toMatchObject({ deletedAt: null, deletedIndex: null, stickies: [] })
  })

  it('v3 のファイルは、お気に入り・ゴミ箱・デザインもそのまま読める', () => {
    const backup = parseBackup(v3File())
    expect(backup.notes[0].favorite).toBe(true)
    expect(backup.notes[0].design.cover).toEqual({
      pattern: 'dots', color: 'navy', layout: 'label', font: 'mincho', subColor: 'auto', patternScale: 'medium', textColor: 'auto',
    })
    expect(backup.notes[0].design.bodyFont).toBe('cover')
    expect(backup.notes[1].deletedAt).toBe(500)
    expect(backup.pages[1]).toMatchObject({ deletedAt: 700, deletedIndex: 1 })
  })

  it('デザインが壊れたノートの入ったファイルは読み込まない', () => {
    const file = v3File({
      notes: [{ id: 'n1', title: 'a', order: 0, favorite: false, deletedAt: null, design: 'abc' }],
      pages: [],
    })
    expect(() => parseBackup(file)).toThrow(/デザインの情報が壊れています/)
  })

  it('お気に入りが真偽値でないファイルは読み込まない', () => {
    const file = v3File({
      notes: [{ id: 'n1', title: 'a', order: 0, favorite: 'yes', deletedAt: null, design: legacyDesign() }],
      pages: [],
    })
    expect(() => parseBackup(file)).toThrow(/ノートの情報が壊れています/)
  })

  it('置き換える:ゴミ箱のノート・ページもゴミ箱のまま戻る', async () => {
    await importReplace(parseBackup(v3File()))
    expect((await db.notes.get('n2'))?.deletedAt).toBe(500)
    expect((await getPages('n1')).map((p) => p.id)).toEqual(['p1'])
    expect((await db.pages.get('p2'))?.deletedAt).toBe(700)
  })

  it('追加する:お気に入りとデザインを引き継ぐ', async () => {
    await importAppend(parseBackup(v3File()))
    const added = (await db.notes.toArray()).find((n) => n.title === 'お気に入り')!
    expect(added.id).not.toBe('n1')
    expect(added.favorite).toBe(true)
    expect(added.design.paper).toBe('mint')
    expect(await getPages(added.id)).toHaveLength(1) // ゴミ箱のページは並ばない
  })
})
