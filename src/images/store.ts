import { db, newId, type ImageRecord } from '../db/db'
import { collectImageIds } from '../editor/contentWalk'

/** 使われていない状態がこの日数続いた画像を消す */
export const IMAGE_GRACE_DAYS = 30
const DAY = 24 * 60 * 60 * 1000

/** 画像を保存して id を返す */
export async function saveImage(img: { data: ArrayBuffer; mime: string; width: number; height: number }): Promise<string> {
  const record: ImageRecord = { id: newId(), ...img, createdAt: Date.now(), unusedSince: null }
  await db.images.add(record)
  return record.id
}

// 表示用の URL(同じ画像を何度も読み直さないよう、アプリを開いている間は覚えておく)
const urls = new Map<string, Promise<string | null>>()

/** 画像の表示用 URL。見つからなければ null */
export function imageUrl(id: string): Promise<string | null> {
  let p = urls.get(id)
  if (!p) {
    p = db.images.get(id).then((rec) => (rec ? URL.createObjectURL(new Blob([rec.data], { type: rec.mime })) : null))
    urls.set(id, p)
    // 見つからなかったときは、あとで(バックアップの読み込み後など)読み直せるようにする
    void p.then((u) => {
      if (!u) urls.delete(id)
    })
  }
  return p
}

export interface CleanupPlan {
  /** また使われるようになった:unusedSince を null に戻す */
  clear: string[]
  /** 初めて使われていないと分かった:今の日時を記録する(まだ消さない) */
  mark: string[]
  /** 使われていない状態が30日続いた:完全に削除する */
  remove: string[]
}

/**
 * 使われていない画像の片付けの計画(画面にもデータベースにも触らない計算だけの関数)。
 * 判定の間違いで使用中の画像を消してしまっても元に戻せないため、すぐには消さず、
 * 「使われていない」状態が30日続いたものだけを消す
 */
export function planImageCleanup(
  images: Pick<ImageRecord, 'id' | 'unusedSince'>[],
  referenced: Set<string>,
  now: number,
): CleanupPlan {
  const plan: CleanupPlan = { clear: [], mark: [], remove: [] }
  for (const img of images) {
    if (referenced.has(img.id)) {
      if (img.unusedSince != null) plan.clear.push(img.id)
    } else if (img.unusedSince == null) {
      plan.mark.push(img.id)
    } else if (now - img.unusedSince >= IMAGE_GRACE_DAYS * DAY) {
      plan.remove.push(img.id)
    }
  }
  return plan
}

/**
 * 使われていない画像を片付ける(起動時に1回)。
 * ページ・付箋・ゴミ箱のページ・ゴミ箱のノートの中のページ、すべてから使われている画像を集めて判定する
 */
export async function cleanupImages(now = Date.now()): Promise<CleanupPlan> {
  return db.transaction('rw', db.pages, db.images, async () => {
    const referenced = new Set<string>()
    await db.pages.each((page) => {
      collectImageIds(page.content, referenced)
      for (const s of page.stickies ?? []) collectImageIds(s.content, referenced)
    })
    // 画像のデータは読まず、判定に必要な項目だけ集める
    const images: Pick<ImageRecord, 'id' | 'unusedSince'>[] = []
    await db.images.each((img) => images.push({ id: img.id, unusedSince: img.unusedSince }))
    const plan = planImageCleanup(images, referenced, now)
    for (const id of plan.clear) await db.images.update(id, { unusedSince: null })
    for (const id of plan.mark) await db.images.update(id, { unusedSince: now })
    await db.images.bulkDelete(plan.remove)
    return plan
  })
}
