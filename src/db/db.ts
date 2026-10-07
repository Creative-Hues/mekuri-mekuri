import Dexie, { type EntityTable } from 'dexie'
import type { JSONContent } from '@tiptap/core'
import { legacyDesign } from '../design/defaults'
import type { BorderWidthName } from '../design/palette'

// データ構造のバージョン。変えるときは docs/data-model.md も更新し、
// 下の db.version(...) に新しい版と upgrade(マイグレーション)を追加する
export const SCHEMA_VERSION = 4

/** ノートのデザイン(v3〜)。色・種類はすべて名前で保存する(src/design/) */
export interface NoteDesign {
  /** 紙の背景色。null は「指定なし」(アプリのテーマに合わせる) */
  paper: string | null
  /** 縁 */
  border: { color: string; width: BorderWidthName }
  /** 表紙 */
  cover: { pattern: string; color: string; layout: string; font: string }
}

export interface Note {
  id: string
  title: string
  /** 本棚での並び順(小さいほど先)。お気に入りの段・通常の段それぞれの中で使う */
  order: number
  /** お気に入り(v3〜) */
  favorite: boolean
  /** ゴミ箱に入れた日時。null ならゴミ箱ではない(v3〜) */
  deletedAt: number | null
  /** デザイン(v3〜) */
  design: NoteDesign
  createdAt: number
  updatedAt: number
}

/** 付箋の色(色名で保存し、実際の色はCSSで決める) */
export type StickyColor = 'yellow' | 'pink' | 'orange' | 'green' | 'blue' | 'purple'

/** ページに貼る付箋(v2〜)。位置と大きさは「紙の幅」に対する割合 */
export interface Sticky {
  id: string
  x: number
  y: number
  w: number
  h: number
  color: StickyColor
  /** TipTap(ProseMirror)のJSON */
  content: JSONContent
  createdAt: number
  updatedAt: number
}

export interface Page {
  id: string
  noteId: string
  /** ノート内での並び順(小さいほど先) */
  order: number
  /** TipTap(ProseMirror)のJSON */
  content: JSONContent
  /** 付箋(v2〜) */
  stickies: Sticky[]
  /** ゴミ箱に入れた日時。null ならゴミ箱ではない(v3〜) */
  deletedAt: number | null
  /** ゴミ箱に入れたときの位置(0から)。復元するときにこの位置へ戻す(v3〜) */
  deletedIndex: number | null
  createdAt: number
  updatedAt: number
}

/** 画像(v4〜)。ページ内容の image ノードが imageId で指す */
export interface ImageRecord {
  id: string
  /** image/jpeg・image/png など */
  mime: string
  /** 画像のデータ(iPhone の Safari でも確実に保存できるよう Blob ではなく ArrayBuffer) */
  data: ArrayBuffer
  width: number
  height: number
  createdAt: number
  /**
   * どこからも使われていないと最初に確認した日時。使われていれば null。
   * 使われていない状態が30日続いた画像だけを消す(判定の間違いで使用中の画像を消さないため)
   */
  unusedSince: number | null
}

export interface MetaEntry {
  key: string
  value: unknown
}

export const db = new Dexie('mekuri-mekuri') as Dexie & {
  notes: EntityTable<Note, 'id'>
  pages: EntityTable<Page, 'id'>
  images: EntityTable<ImageRecord, 'id'>
  meta: EntityTable<MetaEntry, 'key'>
}

// v1:最初の形
db.version(1).stores({
  notes: 'id, order',
  pages: 'id, noteId, [noteId+order]',
  meta: 'key',
})

// v2:ページに付箋(stickies)を追加。インデックスは変わらない。
// 既存のページには空の付箋リストを入れる
db.version(2)
  .stores({
    notes: 'id, order',
    pages: 'id, noteId, [noteId+order]',
    meta: 'key',
  })
  .upgrade((tx) =>
    tx
      .table('pages')
      .toCollection()
      .modify((page: Partial<Page>) => {
        if (!Array.isArray(page.stickies)) page.stickies = []
      }),
  )

// v3:ノートに お気に入り・ゴミ箱・デザイン、ページに ゴミ箱 を追加。インデックスは変わらない。
// 既存のノートは「お気に入りでない・ゴミ箱でない・今までと同じ見た目」にする
db.version(3)
  .stores({
    notes: 'id, order',
    pages: 'id, noteId, [noteId+order]',
    meta: 'key',
  })
  .upgrade(async (tx) => {
    await tx
      .table('notes')
      .toCollection()
      .modify((note: Partial<Note>) => {
        if (typeof note.favorite !== 'boolean') note.favorite = false
        if (note.deletedAt === undefined) note.deletedAt = null
        if (!note.design) note.design = legacyDesign()
      })
    await tx
      .table('pages')
      .toCollection()
      .modify((page: Partial<Page>) => {
        if (page.deletedAt === undefined) page.deletedAt = null
        if (page.deletedIndex === undefined) page.deletedIndex = null
      })
  })

// v4:画像のテーブルを追加。既存のノート・ページは変わらない(本文に表・画像・リンクのノードが増えるだけ)
db.version(4).stores({
  notes: 'id, order',
  pages: 'id, noteId, [noteId+order]',
  images: 'id',
  meta: 'key',
})

/** 空のページ内容 */
export const emptyDoc = (): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph' }] })

export const newId = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : // 古い端末向けの予備
      'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
