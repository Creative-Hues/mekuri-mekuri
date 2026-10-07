import { db } from '../db/db'
import { getMeta, META, setMeta } from '../db/meta'

/**
 * 初回の使い方説明を出すかの判定。新しく使い始める人だけに出す。
 * すでに使っている人(使い方説明ができる前から使っている人)には出さない
 */

/** 判定の本体(テスト用に公開) */
export async function decideOnboarding(now = Date.now()): Promise<boolean> {
  if (await getMeta<number>(META.onboardingDoneAt)) return false
  // 起動の記録かノートがあれば、すでに使っている人。今後も出さないよう記録しておく
  const existing = !!(await getMeta<number>(META.firstLaunchAt)) || (await db.notes.count()) > 0
  if (existing) {
    await setMeta(META.onboardingDoneAt, now)
    return false
  }
  return true
}

let decision: Promise<boolean> | null = null

/**
 * 起動時の判定(起動中は1回だけ判定して結果を使い回す)。
 * バックアップ案内の判定(firstLaunchAt を記録する)より先に呼ぶこと
 */
export function shouldShowOnboarding(): Promise<boolean> {
  decision ??= decideOnboarding()
  return decision
}

/** 見終えたことを記録する(スキップしたときも) */
export async function finishOnboarding(now = Date.now()): Promise<void> {
  await setMeta(META.onboardingDoneAt, now)
}

/** 設定画面の「使い方を見る」から開く合図(App が受け取る) */
export const OPEN_ONBOARDING_EVENT = 'mekuri:open-onboarding'

export function openOnboarding() {
  window.dispatchEvent(new Event(OPEN_ONBOARDING_EVENT))
}
