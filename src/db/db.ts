import Dexie, { type EntityTable } from 'dexie'
import type { JSONContent } from '@tiptap/core'

// データ構造のバージョン。変えるときは docs/data-model.md も更新し、
// 下の db.version(...) に新しい版と upgrade(マイグレーション)を追加する
export const SCHEMA_VERSION = 1

export interface Note {
  id: string
  title: string
  /** 本棚での並び順(小さいほど先) */
  order: number
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
  createdAt: number
  updatedAt: number
}

export interface MetaEntry {
  key: string
  value: unknown
}

export const db = new Dexie('mekuri-mekuri') as Dexie & {
  notes: EntityTable<Note, 'id'>
  pages: EntityTable<Page, 'id'>
  meta: EntityTable<MetaEntry, 'key'>
}

// v1:最初の形
db.version(1).stores({
  notes: 'id, order',
  pages: 'id, noteId, [noteId+order]',
  meta: 'key',
})

/** 空のページ内容 */
export const emptyDoc = (): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph' }] })

export const newId = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : // 古い端末向けの予備
      'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
