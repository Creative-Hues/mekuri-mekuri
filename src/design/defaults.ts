import type { NoteDesign } from '../db/db'
import { COVER_FONTS, COVER_LAYOUTS, COVER_PATTERNS } from './cover'
import { BORDER_COLORS, BORDER_WIDTHS, COVER_COLORS, PAPER_COLORS, type BorderWidthName } from './palette'

/**
 * 今までのノート(0.3.0 まで)と同じ見た目になるデザイン。
 * 既存のノートを v3 に移すときに使う
 */
export const legacyDesign = (): NoteDesign => ({
  paper: null,
  border: { color: 'brown', width: 'none' },
  cover: { pattern: 'plain', color: 'slate', layout: 'topLeft', font: 'gothicBold' },
})

/** 新しいノートのデザイン:表紙の色はランダム、柄は無地 */
export function newNoteDesign(random: () => number = Math.random): NoteDesign {
  const d = legacyDesign()
  d.cover.color = COVER_COLORS[Math.floor(random() * COVER_COLORS.length)]?.name ?? 'slate'
  return d
}

const names = (list: readonly { name: string }[]) => new Set(list.map((x) => x.name))
const paperNames = names(PAPER_COLORS)
const borderNames = names(BORDER_COLORS)
const widthNames = names(BORDER_WIDTHS)
const coverColorNames = names(COVER_COLORS)
const patternNames = names(COVER_PATTERNS)
const layoutNames = names(COVER_LAYOUTS)
const fontNames = names(COVER_FONTS)

const pick = (v: unknown, allowed: Set<string>, fallback: string): string =>
  typeof v === 'string' && allowed.has(v) ? v : fallback

/**
 * 保存されているデザインを、今のアプリで表示できる形にそろえる。
 * 知らない名前(新しいバージョンで追加された色など)や欠けた項目は既定値にする。
 * データは書き換えず、表示用に使う
 */
export function normalizeDesign(raw: unknown): NoteDesign {
  const base = legacyDesign()
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<NoteDesign>
  const border = (d.border ?? {}) as Partial<NoteDesign['border']>
  const cover = (d.cover ?? {}) as Partial<NoteDesign['cover']>
  return {
    paper: typeof d.paper === 'string' && paperNames.has(d.paper) ? d.paper : null,
    border: {
      color: pick(border.color, borderNames, base.border.color),
      width: pick(border.width, widthNames, base.border.width) as BorderWidthName,
    },
    cover: {
      pattern: pick(cover.pattern, patternNames, base.cover.pattern),
      color: pick(cover.color, coverColorNames, base.cover.color),
      layout: pick(cover.layout, layoutNames, base.cover.layout),
      font: pick(cover.font, fontNames, base.cover.font),
    },
  }
}
