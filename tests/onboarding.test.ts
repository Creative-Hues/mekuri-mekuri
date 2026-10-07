import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/db/db'
import { getMeta, META, setMeta } from '../src/db/meta'
import { createNote } from '../src/db/repo'
import { decideOnboarding, finishOnboarding } from '../src/onboarding/onboarding'
import { shouldRemindBackup } from '../src/backup/reminder'

// 初回の使い方説明を出すかの判定

const NOW = new Date(2026, 9, 7, 12, 0).getTime()

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('使い方説明の判定', () => {
  it('新しく使い始める人(記録もノートもない)には出す', async () => {
    expect(await decideOnboarding(NOW)).toBe(true)
    // 見終えるまでは記録しない(途中で閉じても、次の起動でもう一度出る)
    expect(await getMeta(META.onboardingDoneAt)).toBeUndefined()
  })

  it('見終えたら、もう出さない', async () => {
    await finishOnboarding(NOW)
    expect(await decideOnboarding(NOW)).toBe(false)
  })

  it('すでに使っている人(起動の記録がある)には出さず、出さないことを記録する', async () => {
    await setMeta(META.firstLaunchAt, NOW - 1000)
    expect(await decideOnboarding(NOW)).toBe(false)
    expect(await getMeta(META.onboardingDoneAt)).toBe(NOW)
  })

  it('ノートがある人にも出さない', async () => {
    await createNote('前から使っている')
    expect(await decideOnboarding(NOW)).toBe(false)
  })

  it('バックアップ案内の判定(初回起動を記録する)より先に判定すれば、新しい人に出せる', async () => {
    const show = await decideOnboarding(NOW)
    await shouldRemindBackup(NOW)
    expect(show).toBe(true)
    // 逆の順番だと既存の利用者と見分けられないので、App では必ず使い方説明を先に判定する
    expect(await decideOnboarding(NOW)).toBe(false)
  })
})
