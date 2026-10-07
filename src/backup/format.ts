import { SCHEMA_VERSION, type Note, type Page } from '../db/db'
import { legacyDesign } from '../design/defaults'

/** バックアップファイルの中身(スキーマ v3) */
export interface BackupV3 {
  app: 'mekuri-mekuri'
  schemaVersion: 3
  appVersion: string
  exportedAt: number
  notes: Note[]
  pages: Page[]
}

/** 今のアプリが扱う形 */
export type Backup = BackupV3

export class BackupError extends Error {}

/**
 * 古いバージョンのファイルを今の形に変換する。
 * スキーマを上げたら、ここに「vN → vN+1」の変換を足していく。
 */
const migrations: Record<number, (data: any) => any> = {
  // v1 → v2:ページに付箋(stickies)を追加
  1: (d) => ({
    ...d,
    schemaVersion: 2,
    pages: Array.isArray(d.pages)
      ? d.pages.map((p: any) => ({ ...p, stickies: Array.isArray(p?.stickies) ? p.stickies : [] }))
      : d.pages,
  }),
  // v2 → v3:ノートに お気に入り・ゴミ箱・デザイン、ページに ゴミ箱 を追加(今までと同じ見た目にする)
  2: (d) => ({
    ...d,
    schemaVersion: 3,
    notes: Array.isArray(d.notes)
      ? d.notes.map((n: any) => ({ ...n, favorite: false, deletedAt: null, design: legacyDesign() }))
      : d.notes,
    pages: Array.isArray(d.pages)
      ? d.pages.map((p: any) => ({ ...p, deletedAt: null, deletedIndex: null }))
      : d.pages,
  }),
}

const isTime = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v))

export function parseBackup(text: string): Backup {
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new BackupError('ファイルを読み取れませんでした。めくりめくりのバックアップファイルか確認してください。')
  }
  if (!data || data.app !== 'mekuri-mekuri' || typeof data.schemaVersion !== 'number') {
    throw new BackupError('めくりめくりのバックアップファイルではないようです。')
  }
  if (data.schemaVersion > SCHEMA_VERSION) {
    throw new BackupError(
      'このファイルは新しいバージョンのアプリで作られています。アプリを最新にしてから読み込んでください。',
    )
  }
  while (data.schemaVersion < SCHEMA_VERSION) {
    const step = migrations[data.schemaVersion]
    if (!step) throw new BackupError(`バージョン ${data.schemaVersion} のファイルは読み込めません。`)
    data = step(data)
  }
  if (!Array.isArray(data.notes) || !Array.isArray(data.pages)) {
    throw new BackupError('ファイルの中身が壊れているようです。')
  }
  for (const n of data.notes) {
    if (typeof n?.id !== 'string' || typeof n.title !== 'string') throw new BackupError('ノートの情報が壊れています。')
    if (typeof n.favorite !== 'boolean' || !isTime(n.deletedAt)) throw new BackupError('ノートの情報が壊れています。')
    // デザインは、知らない色名などがあっても表示のときに既定値になるので、形だけ確かめる
    if (!n.design || typeof n.design !== 'object' || !n.design.cover || !n.design.border) {
      throw new BackupError('ノートのデザインの情報が壊れています。')
    }
  }
  for (const p of data.pages) {
    if (typeof p?.id !== 'string' || typeof p.noteId !== 'string' || typeof p.content !== 'object') {
      throw new BackupError('ページの情報が壊れています。')
    }
    if (!isTime(p.deletedAt) || !(p.deletedIndex === null || typeof p.deletedIndex === 'number')) {
      throw new BackupError('ページの情報が壊れています。')
    }
    if (!Array.isArray(p.stickies)) throw new BackupError('付箋の情報が壊れています。')
    for (const s of p.stickies) {
      if (
        typeof s?.id !== 'string' ||
        typeof s.content !== 'object' ||
        ![s.x, s.y, s.w, s.h].every((v) => typeof v === 'number' && Number.isFinite(v))
      ) {
        throw new BackupError('付箋の情報が壊れています。')
      }
    }
  }
  return data as Backup
}
