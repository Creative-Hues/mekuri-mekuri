import type { StickyColor } from '../db/db'
import { STICKY_COLORS } from '../editor/sticky'

/**
 * 書き出したファイルの中の、付箋の見出し(「付箋(ピンク)」)。
 * 書き出し(Markdown・テキスト・Word)と読み込みで同じ書き方を使い、読み込むときに付箋の色を戻す。
 * 1.2.0 より前の書き出しは色のない「付箋」で、そのファイルの付箋は黄色にする
 */

/** 付箋の見出しの文字 */
export const stickyLabel = (color: StickyColor): string =>
  `付箋(${STICKY_COLORS.find((c) => c.name === color)?.label ?? STICKY_COLORS[0].label})`

/**
 * 付箋の見出しか調べる。
 * 色つきの見出しならその色、色のない古い見出しなら 'legacy'、見出しでなければ null
 */
export function parseStickyLabel(text: string): StickyColor | 'legacy' | null {
  const s = text.trim()
  if (s === '付箋') return 'legacy'
  const m = /^付箋[(（](.+)[)）]$/.exec(s)
  if (!m) return null
  return STICKY_COLORS.find((c) => c.label === m[1].trim())?.name ?? null
}
