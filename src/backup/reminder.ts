import { db } from '../db/db'
import { getMeta, META, setMeta } from '../db/meta'

const DAY = 24 * 60 * 60 * 1000
/** 前回のバックアップからこの日数で案内する */
const REMIND_AFTER = 7 * DAY
/** 「あとで」を押したら、この時間は案内しない */
const SNOOZE = 1 * DAY

/** 起動時に呼ぶ。案内を出すべきなら true */
export async function shouldRemindBackup(now = Date.now()): Promise<boolean> {
  let first = await getMeta<number>(META.firstLaunchAt)
  if (!first) {
    first = now
    await setMeta(META.firstLaunchAt, now)
  }
  if ((await db.notes.count()) === 0) return false
  const last = (await getMeta<number>(META.lastBackupAt)) ?? first
  if (now - last < REMIND_AFTER) return false
  const snoozed = await getMeta<number>(META.backupReminderSnoozedAt)
  if (snoozed && now - snoozed < SNOOZE) return false
  return true
}

export async function snoozeBackupReminder(): Promise<void> {
  await setMeta(META.backupReminderSnoozedAt, Date.now())
}
