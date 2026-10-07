import { SCHEMA_VERSION, type Note, type Page } from '../db/db'
import { legacyDesignV3, upgradeDesignToV5 } from '../design/defaults'
import { upgradeTablesToV6 } from '../editor/tableMigrate'

/** バックアップファイルの中の画像(v4〜)。data は base64 */
export interface BackupImage {
  id: string
  mime: string
  data: string
  width: number
  height: number
}

/**
 * バックアップファイルの中身(スキーマ v6。v4 からはデザインの項目(v5)・表の見出しの持ち方(v6)が変わっただけで、
 * ファイルの形は同じ)
 */
export interface BackupV6 {
  app: 'mekuri-mekuri'
  schemaVersion: 6
  appVersion: string
  exportedAt: number
  notes: Note[]
  pages: Page[]
  images: BackupImage[]
}

/** 今のアプリが扱う形 */
export type Backup = BackupV6

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
      ? d.notes.map((n: any) => ({ ...n, favorite: false, deletedAt: null, design: legacyDesignV3() }))
      : d.notes,
    pages: Array.isArray(d.pages)
      ? d.pages.map((p: any) => ({ ...p, deletedAt: null, deletedIndex: null }))
      : d.pages,
  }),
  // v3 → v4:画像を追加(v3 までのファイルには画像はない)
  3: (d) => ({ ...d, schemaVersion: 4, images: Array.isArray(d.images) ? d.images : [] }),
  // v4 → v5:デザインに 本文の書体・サブ色・柄の大きさ・タイトルの文字色 を追加、市松・青海波・鱗は無地に(DB の移し替えと同じ)
  4: (d) => ({
    ...d,
    schemaVersion: 5,
    notes: Array.isArray(d.notes)
      ? d.notes.map((n: any) =>
          // デザインが壊れているノートは、下の確認で「壊れている」と知らせるためにそのまま残す
          n && n.design && typeof n.design === 'object' ? { ...n, design: upgradeDesignToV5(n.design) } : n,
        )
      : d.notes,
  }),
  // v5 → v6:表の見出しを、見出しセル(tableHeader)から表の設定(headerRow・headerColumn)へ(DB の移し替えと同じ)
  5: (d) => ({
    ...d,
    schemaVersion: 6,
    pages: Array.isArray(d.pages)
      ? d.pages.map((p: any) =>
          // 中身が壊れているページは、下の確認で「壊れている」と知らせるためにそのまま残す
          p && p.content && typeof p.content === 'object' ? { ...p, content: upgradeTablesToV6(p.content) } : p,
        )
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
  if (!Array.isArray(data.notes) || !Array.isArray(data.pages) || !Array.isArray(data.images)) {
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
  for (const img of data.images) {
    if (
      typeof img?.id !== 'string' ||
      typeof img.mime !== 'string' ||
      !img.mime.startsWith('image/') ||
      typeof img.data !== 'string' ||
      typeof img.width !== 'number' ||
      typeof img.height !== 'number'
    ) {
      throw new BackupError('画像の情報が壊れています。')
    }
  }
  return data as Backup
}

/** ArrayBuffer → base64(大きな画像でも止まらないよう、少しずつ変換する) */
export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}

/** base64 → ArrayBuffer */
export function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}
