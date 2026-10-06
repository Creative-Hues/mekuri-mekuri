import { emptyDoc, newId, type Sticky, type StickyColor } from '../db/db'

/**
 * 付箋の位置・大きさの計算(画面に関係しない部分)。
 * 位置(x, y)と大きさ(w, h)は、どれも「紙の幅」を1とした割合。
 * 端末によって紙の幅が違っても、紙に対する位置関係が保たれる。
 */

export const STICKY_COLORS: { name: StickyColor; label: string }[] = [
  { name: 'yellow', label: '黄' },
  { name: 'pink', label: 'ピンク' },
  { name: 'orange', label: 'オレンジ' },
  { name: 'green', label: '緑' },
  { name: 'blue', label: '青' },
  { name: 'purple', label: '紫' },
]

/** いちばん小さい大きさ */
export const MIN_W = 0.2
export const MIN_H = 0.12
/** いちばん大きい高さ(縦に長くなりすぎないように) */
export const MAX_H = 2
/** 新しい付箋の大きさ */
export const DEFAULT_W = 0.42
export const DEFAULT_H = 0.28

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** 位置を紙の中に収める(左右ははみ出さない。下へは伸ばせる) */
export function clampPosition(s: Pick<Sticky, 'w'>, x: number, y: number): { x: number; y: number } {
  return { x: clamp(x, 0, Math.max(0, 1 - s.w)), y: Math.max(0, y) }
}

/** 大きさを決まりの範囲に収める(右は紙の端まで) */
export function clampSize(s: Pick<Sticky, 'x'>, w: number, h: number): { w: number; h: number } {
  return { w: clamp(w, MIN_W, Math.max(MIN_W, 1 - s.x)), h: clamp(h, MIN_H, MAX_H) }
}

/**
 * 新しい付箋を作る。
 * centerY:置きたい場所の中心(紙の幅を1とした割合。今見えている範囲の中央など)
 */
export function createSticky(color: StickyColor, centerY: number, now = Date.now()): Sticky {
  const x = (1 - DEFAULT_W) / 2
  const y = Math.max(0, centerY - DEFAULT_H / 2)
  return { id: newId(), x, y, w: DEFAULT_W, h: DEFAULT_H, color, content: emptyDoc(), createdAt: now, updatedAt: now }
}

/** 付箋のいちばん下(紙の幅を1とした割合)。紙をその下までスクロールできるようにするため */
export function stickiesBottom(stickies: Sticky[]): number {
  return stickies.reduce((m, s) => Math.max(m, s.y + s.h), 0)
}

/** 付箋の色として正しいか */
export const isStickyColor = (v: unknown): v is StickyColor => STICKY_COLORS.some((c) => c.name === v)
