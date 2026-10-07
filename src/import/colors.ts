import { MARKER_HEX, TEXT_HEX } from '../export/colors'
import type { MarkerColorName, TextColorName } from '../editor/palette'

/**
 * Word の色(「FF0000」のような16進数・マーカーの色名)を、めくりめくりの色名にする。
 * 書き出した色と同じ値ならその色に正確に戻し、それ以外は色合いがいちばん近い色にする。
 * 黒・白・「自動」は色なし(null)
 */

interface Hsl {
  h: number
  s: number
  l: number
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHsl([r, g, b]: [number, number, number]): Hsl {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, l }
}

const hueDistance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

/** 色合い(hue)がいちばん近い色の名前 */
function nearestHue<T extends string>(h: number, table: Record<T, string>, names: T[]): T {
  let best = names[0]
  let bestD = Infinity
  for (const name of names) {
    const d = hueDistance(h, toHsl(parseHex(table[name])!).h)
    if (d < bestD) {
      bestD = d
      best = name
    }
  }
  return best
}

const exact = <T extends string>(hex: string, table: Record<T, string>): T | null =>
  (Object.keys(table) as T[]).find((k) => table[k].toLowerCase() === hex.toLowerCase()) ?? null

const TEXT_HUES: TextColorName[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple']

/** 文字色・線の色 */
export function nearestTextColor(hex: string | null | undefined): TextColorName | null {
  if (!hex || hex.toLowerCase() === 'auto') return null
  const rgb = parseHex(hex)
  if (!rgb) return null
  const hit = exact(hex.replace('#', ''), TEXT_HEX)
  if (hit) return hit
  const { h, s, l } = toHsl(rgb)
  // 色みのない色:黒っぽい・白っぽいものは色なし、間はグレー
  if (s < 0.12 || l < 0.12 || l > 0.95) return l < 0.3 || l > 0.9 ? null : 'gray'
  // 暗い・くすんだ橙色は茶色
  if (h >= 8 && h <= 50 && (l < 0.38 || s < 0.4)) return 'brown'
  // ピンク(赤紫)は赤に寄せる
  return nearestHue(h, TEXT_HEX, TEXT_HUES)
}

const MARKER_HUES: MarkerColorName[] = ['yellow', 'orange', 'pink', 'red', 'green', 'blue', 'purple']

/** マーカー・セルの背景色 */
export function nearestMarkerColor(hex: string | null | undefined): MarkerColorName | null {
  if (!hex || hex.toLowerCase() === 'auto') return null
  const rgb = parseHex(hex)
  if (!rgb) return null
  const hit = exact(hex.replace('#', ''), MARKER_HEX)
  if (hit) return hit
  const { h, s, l } = toHsl(rgb)
  if (l > 0.97) return null
  if (s < 0.12) return 'gray'
  return nearestHue(h, MARKER_HEX, MARKER_HUES)
}

/** Word のマーカー(蛍光ペン)の色名 */
const HIGHLIGHT: Record<string, MarkerColorName | null> = {
  yellow: 'yellow',
  green: 'green',
  cyan: 'blue',
  magenta: 'pink',
  blue: 'blue',
  red: 'red',
  darkBlue: 'blue',
  darkCyan: 'blue',
  darkGreen: 'green',
  darkMagenta: 'purple',
  darkRed: 'red',
  darkYellow: 'orange',
  darkGray: 'gray',
  lightGray: 'gray',
  black: 'gray',
  white: null,
  none: null,
}

export function highlightColor(name: string | null | undefined): MarkerColorName | null {
  return name ? (HIGHLIGHT[name] ?? null) : null
}
