import type { NoteDesign } from '../db/db'
import {
  BODY_FONTS,
  COVER_FONTS,
  COVER_LAYOUTS,
  COVER_PATTERNS,
  COVER_TEXT_COLORS,
  PATTERN_SCALES,
  type BodyFontName,
  type CoverTextColorName,
  type PatternScaleName,
} from './cover'
import {
  BORDER_COLORS,
  BORDER_WIDTHS,
  COVER_COLORS,
  PAPER_COLORS,
  RANDOM_COVER_COLORS,
  SUB_COLORS,
  SUB_COLOR_AUTO,
  type BorderWidthName,
} from './palette'

/**
 * v3(アプリ 0.4.0)でデザインを追加したときの形。0.3.0 までのノートと同じ見た目。
 * v2 → v3 の移し替えで使うので、形を変えないこと(その後 upgradeDesignToV5 で今の形にする)
 */
export const legacyDesignV3 = () => ({
  paper: null,
  border: { color: 'brown', width: 'none' as const },
  cover: { pattern: 'plain', color: 'slate', layout: 'topLeft', font: 'gothicBold' },
})

/** v5(アプリ 1.1.0)でなくした柄。保存済みのノートは無地にする */
const REMOVED_PATTERNS = new Set(['ichimatsu', 'seigaiha', 'uroko'])

/**
 * デザインを v5 の形にする(本文の書体・サブ色・柄の大きさ・タイトルの文字色を足し、なくした柄を無地にする)。
 * DB の移し替え・バックアップファイルの読み込みの両方で使う。何度通しても同じ結果になる。
 * 知らない項目・値はそのまま残す(表示のときに normalizeDesign で既定値になる)
 */
export function upgradeDesignToV5(raw: unknown): NoteDesign {
  if (!raw || typeof raw !== 'object') return upgradeDesignToV5(legacyDesignV3())
  const d = raw as Record<string, any>
  const cover = d.cover && typeof d.cover === 'object' ? d.cover : {}
  return {
    ...d,
    // 今あるノートの本文は「表紙と同じ」にする(ユーザーと決めた方針)
    bodyFont: d.bodyFont ?? 'cover',
    cover: {
      ...cover,
      pattern: REMOVED_PATTERNS.has(cover.pattern) ? 'plain' : cover.pattern,
      // なじむ色:1.0.0 までと同じ半透明の柄の色
      subColor: cover.subColor ?? SUB_COLOR_AUTO,
      patternScale: cover.patternScale ?? 'medium',
      // タイトルの文字色:自動(1.0.0 までと同じ)
      textColor: cover.textColor ?? 'auto',
    },
  } as NoteDesign
}

/**
 * 0.3.0 までのノートと同じ見た目のデザイン(今の形)。
 * 本文の書体は「表紙と同じ」で、表紙が ゴシック 太 なので本文もゴシック(今までと同じ)
 */
export const legacyDesign = (): NoteDesign => upgradeDesignToV5(legacyDesignV3())

/**
 * 新しいノートのデザイン:表紙の色はランダム、柄は無地、本文は表紙と同じ書体。
 * avoidColor(直前に作ったノートの表紙の色)とは違う色にする
 */
export function newNoteDesign(random: () => number = Math.random, avoidColor?: string): NoteDesign {
  const d = legacyDesign()
  // 白・黒は選ばない(RANDOM_COVER_COLORS)
  const choices = RANDOM_COVER_COLORS.filter((c) => c.name !== avoidColor)
  d.cover.color = choices[Math.floor(random() * choices.length)]?.name ?? 'slate'
  return d
}

const names = (list: readonly { name: string }[]) => new Set(list.map((x) => x.name))
const paperNames = names(PAPER_COLORS)
const borderNames = names(BORDER_COLORS)
const widthNames = names(BORDER_WIDTHS)
const coverColorNames = names(COVER_COLORS)
const subColorNames = new Set([SUB_COLOR_AUTO, ...names(SUB_COLORS)])
const patternNames = names(COVER_PATTERNS)
const scaleNames = names(PATTERN_SCALES)
const layoutNames = names(COVER_LAYOUTS)
const fontNames = names(COVER_FONTS)
const bodyFontNames = names(BODY_FONTS)
const textColorNames = names(COVER_TEXT_COLORS)

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
      subColor: pick(cover.subColor, subColorNames, base.cover.subColor),
      patternScale: pick(cover.patternScale, scaleNames, base.cover.patternScale) as PatternScaleName,
      textColor: pick(cover.textColor, textColorNames, base.cover.textColor) as CoverTextColorName,
      layout: pick(cover.layout, layoutNames, base.cover.layout),
      font: pick(cover.font, fontNames, base.cover.font),
    },
    bodyFont: pick(d.bodyFont, bodyFontNames, base.bodyFont) as BodyFontName,
  }
}
