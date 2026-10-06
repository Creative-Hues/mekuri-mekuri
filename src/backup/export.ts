import { db, SCHEMA_VERSION } from '../db/db'
import { META, setMeta } from '../db/meta'
import { APP_VERSION } from '../version'
import type { Backup } from './format'

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** 全ノートを1つのファイルに書き出す */
export async function exportBackup(): Promise<void> {
  const [notes, pages] = await db.transaction('r', db.notes, db.pages, () =>
    Promise.all([db.notes.toArray(), db.pages.toArray()]),
  )
  const now = Date.now()
  const backup: Backup = {
    app: 'mekuri-mekuri',
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: now,
    notes,
    pages,
  }
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `mekuri-backup-${stamp(new Date(now))}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  await setMeta(META.lastBackupAt, now)
}
