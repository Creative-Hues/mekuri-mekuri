import { db, SCHEMA_VERSION } from '../db/db'
import { META, setMeta } from '../db/meta'
import { APP_VERSION } from '../version'
import { toBase64, type Backup } from './format'
import { downloadBlob } from '../export/download'

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** 全ノートを1つのファイルに書き出す(画像も含める) */
export async function exportBackup(): Promise<void> {
  const [notes, pages, images] = await db.transaction('r', db.notes, db.pages, db.images, () =>
    Promise.all([db.notes.toArray(), db.pages.toArray(), db.images.toArray()]),
  )
  const now = Date.now()
  const backup: Backup = {
    app: 'mekuri-mekuri',
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: now,
    notes,
    pages,
    // 使われているかの記録(unusedSince)は入れない。読み込んだ端末で改めて判定する
    images: images.map((img) => ({
      id: img.id,
      mime: img.mime,
      data: toBase64(img.data),
      width: img.width,
      height: img.height,
    })),
  }
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' })
  downloadBlob(blob, `mekuri-backup-${stamp(new Date(now))}.json`)
  await setMeta(META.lastBackupAt, now)
}
