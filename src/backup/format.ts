import { SCHEMA_VERSION, type Note, type Page } from '../db/db'

/** バックアップファイルの中身(スキーマ v1) */
export interface BackupV1 {
  app: 'mekuri-mekuri'
  schemaVersion: 1
  appVersion: string
  exportedAt: number
  notes: Note[]
  pages: Page[]
}

/** 今のアプリが扱う形 */
export type Backup = BackupV1

export class BackupError extends Error {}

/**
 * 古いバージョンのファイルを今の形に変換する。
 * スキーマを上げたら、ここに「vN → vN+1」の変換を足していく。
 */
const migrations: Record<number, (data: any) => any> = {
  // 例) 1: (d) => ({ ...d, schemaVersion: 2, notes: d.notes.map((n) => ({ ...n, favorite: false })) }),
}

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
  }
  for (const p of data.pages) {
    if (typeof p?.id !== 'string' || typeof p.noteId !== 'string' || typeof p.content !== 'object') {
      throw new BackupError('ページの情報が壊れています。')
    }
  }
  return data as Backup
}
