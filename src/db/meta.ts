import { db } from './db'

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key)
  return row?.value as T | undefined
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}

export const META = {
  firstLaunchAt: 'firstLaunchAt',
  lastBackupAt: 'lastBackupAt',
  backupReminderSnoozedAt: 'backupReminderSnoozedAt',
} as const
