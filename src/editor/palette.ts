/**
 * 色のパレット。
 * データには色名(red など)だけを保存し、実際の色は base.css の CSS 変数で決める。
 * (フェーズ3のダークモードで、読みやすい色に差し替えられるようにするため)
 * 色名を変える・消すと保存済みのノートの色が出なくなるので、追加だけにすること
 */

export interface PaletteColor<T extends string = string> {
  name: T
  label: string
}

/** 文字色 */
export const TEXT_COLORS = [
  { name: 'gray', label: 'グレー' },
  { name: 'brown', label: '茶' },
  { name: 'red', label: '赤' },
  { name: 'orange', label: 'オレンジ' },
  { name: 'yellow', label: '黄' },
  { name: 'green', label: '緑' },
  { name: 'blue', label: '青' },
  { name: 'purple', label: '紫' },
] as const satisfies readonly PaletteColor[]

/** マーカー(文字の背景) */
export const MARKER_COLORS = [
  { name: 'yellow', label: '黄' },
  { name: 'orange', label: 'オレンジ' },
  { name: 'pink', label: 'ピンク' },
  { name: 'red', label: '赤' },
  { name: 'green', label: '緑' },
  { name: 'blue', label: '青' },
  { name: 'purple', label: '紫' },
  { name: 'gray', label: 'グレー' },
] as const satisfies readonly PaletteColor[]

/** ラインの線の種類 */
export const LINE_STYLES = [
  { name: 'solid', label: '下線' },
  { name: 'wavy', label: '波線' },
  { name: 'double', label: '二重線' },
  { name: 'dotted', label: '点線' },
] as const satisfies readonly PaletteColor[]

export type TextColorName = (typeof TEXT_COLORS)[number]['name']
export type MarkerColorName = (typeof MARKER_COLORS)[number]['name']
export type LineStyleName = (typeof LINE_STYLES)[number]['name']

/** ラインの色は文字色と同じ色名。null は「文字と同じ色」 */
export type LineColorName = TextColorName | null

const textNames = new Set<string>(TEXT_COLORS.map((c) => c.name))
const markerNames = new Set<string>(MARKER_COLORS.map((c) => c.name))
const lineNames = new Set<string>(LINE_STYLES.map((c) => c.name))

export const isTextColor = (v: unknown): v is TextColorName => typeof v === 'string' && textNames.has(v)
export const isMarkerColor = (v: unknown): v is MarkerColorName => typeof v === 'string' && markerNames.has(v)
export const isLineStyle = (v: unknown): v is LineStyleName => typeof v === 'string' && lineNames.has(v)
