/**
 * 表紙のテンプレート(柄・柄の大きさ・文字の配置・書体)と、本文の書体。色は palette.ts。
 * 柄は画像ファイルを使わず、CSSのグラデーションとSVGで描く(端末で見た目が変わらないように)。
 * 柄は「ベース色(表紙の色)」の上に「サブ色」で描く。
 * データには名前だけを保存する。名前を変える・消すと保存済みの表紙が出なくなるので、追加だけにすること
 * (消すときは、必ずデータの移し替えを入れる)
 */

import type { NoteDesign } from '../db/db'
import { subColor, type Tone } from './palette'

export interface CoverPattern {
  name: string
  label: string
  /**
   * ink:柄を描く色(サブ色)
   * s:柄の倍率(PATTERN_SCALES の scale。1 が標準の大きさ)
   */
  css: (ink: string, s: number) => { backgroundImage?: string; backgroundSize?: string; backgroundPosition?: string }
}

/** SVG を背景に使う(色の # は URL の中で使えないので変換する) */
const svg = (body: string, w: number, h: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`,
  )}")`

/** 倍率を掛けた長さ(px)。小数は2桁までにする */
const px = (n: number, s: number) => `${Math.round(n * s * 100) / 100}px`

/** はっきりした色(#rrggbb)か。なじむ色は半透明の rgba(...) */
const isSolidInk = (ink: string) => /^#[0-9a-f]{6}$/i.test(ink)

/** 縦の縞(太さ w・繰り返しの幅 period) */
const stripes = (deg: number, ink: string, w: number, period: number, s: number) =>
  `repeating-linear-gradient(${deg}deg, ${ink} 0 ${px(w, s)}, transparent ${px(w, s)} ${px(period, s)})`

// アプリ 1.1.0 で 市松(ichimatsu)・青海波(seigaiha)・鱗(uroko)をなくした。
// 保存済みのノートは、データの移し替え(defaults.ts の upgradeDesignToV5)で無地になる
export const COVER_PATTERNS: readonly CoverPattern[] = [
  { name: 'plain', label: '無地', css: () => ({}) },
  { name: 'stripe', label: 'ストライプ', css: (ink, s) => ({ backgroundImage: stripes(90, ink, 6, 18, s) }) },
  { name: 'wideStripe', label: '太ストライプ', css: (ink, s) => ({ backgroundImage: stripes(90, ink, 16, 32, s) }) },
  { name: 'border', label: 'ボーダー', css: (ink, s) => ({ backgroundImage: stripes(0, ink, 6, 18, s) }) },
  {
    name: 'dots',
    label: 'ドット',
    css: (ink, s) => ({
      backgroundImage: `radial-gradient(${ink} ${px(2.2, s)}, transparent ${px(2.7, s)})`,
      backgroundSize: `${px(14, s)} ${px(14, s)}`,
    }),
  },
  {
    name: 'check',
    label: 'チェック',
    css: (ink, s) => ({
      backgroundImage: `linear-gradient(${ink} ${px(2, s)}, transparent ${px(2, s)}), linear-gradient(90deg, ${ink} ${px(2, s)}, transparent ${px(2, s)})`,
      backgroundSize: `${px(24, s)} ${px(24, s)}`,
    }),
  },
  {
    name: 'gingham',
    label: 'ギンガム',
    css: (ink, s) =>
      isSolidInk(ink)
        ? {
            // はっきりした色:縦横の帯はベース色とサブ色の中間(サブ色を半分の濃さで重ねる)、
            // 帯の重なる所はサブ色そのもの。1つの四角(タイル)で描く
            backgroundImage: svg(
              `<rect x='0' y='0' width='16' height='8' fill='${ink}' fill-opacity='0.5'/>` +
                `<rect x='0' y='0' width='8' height='16' fill='${ink}' fill-opacity='0.5'/>` +
                `<rect x='0' y='0' width='8' height='8' fill='${ink}'/>`,
              16,
              16,
            ),
            backgroundSize: `${px(16, s)} ${px(16, s)}`,
          }
        : // なじむ色(半透明):帯を2枚重ねると、重なる所が自然に濃くなる(1.0.0 までと同じ見た目)
          { backgroundImage: `${stripes(0, ink, 8, 16, s)}, ${stripes(90, ink, 8, 16, s)}` },
  },
  {
    name: 'grid',
    label: '方眼',
    css: (ink, s) => ({
      backgroundImage: `linear-gradient(${ink} 1px, transparent 1px), linear-gradient(90deg, ${ink} 1px, transparent 1px)`,
      backgroundSize: `${px(9, s)} ${px(9, s)}`,
    }),
  },
  { name: 'diagonal', label: '斜線', css: (ink, s) => ({ backgroundImage: stripes(45, ink, 3, 12, s) }) },
  {
    name: 'wave',
    label: '波',
    css: (ink, s) => ({
      backgroundImage: svg(
        `<path d='M0 6 Q6 0 12 6 T24 6' fill='none' stroke='${ink}' stroke-width='2'/>`,
        24,
        12,
      ),
      backgroundSize: `${px(24, s)} ${px(12, s)}`,
    }),
  },
]

/** 柄の大きさ(倍率)。中が 1.0.0 までの大きさ */
export const PATTERN_SCALES = [
  { name: 'small', label: '小', scale: 0.6 },
  { name: 'medium', label: '中', scale: 1 },
  { name: 'large', label: '大', scale: 1.6 },
] as const

export type PatternScaleName = (typeof PATTERN_SCALES)[number]['name']

export interface CoverLayout {
  name: string
  label: string
}

/** 文字の配置(見た目は screens.css の .cover--layout-<name>) */
export const COVER_LAYOUTS: readonly CoverLayout[] = [
  { name: 'topLeft', label: '左上' },
  { name: 'center', label: '中央' },
  { name: 'topCenter', label: '中央上' }, // 1.1.0〜
  { name: 'bottomLeft', label: '左下' },
  { name: 'bottomRight', label: '右下' },
  { name: 'band', label: '帯' },
  { name: 'label', label: 'ラベル' },
  { name: 'vertical', label: '縦書き' },
  { name: 'bottomBand', label: '下の帯' },
  { name: 'frame', label: '枠' },
  { name: 'spine', label: '背表紙' },
]

/** 書体の種類(本文に反映するのはこの種類だけ。太さ・字間は表紙だけ) */
export type FontKind = 'gothic' | 'mincho' | 'maru'

export interface CoverFont {
  name: string
  label: string
  kind: FontKind
  family: string
  weight: number
  /** 字間(em) */
  spacing: number
}

// 書体は端末に入っているものだけを使う(外部のフォントは読み込まない)。
// 端末にない書体は、次の候補 → 最後はアプリの標準の書体になる
const MINCHO = "'Hiragino Mincho ProN', 'Yu Mincho', YuMincho, 'Noto Serif JP', 'Noto Serif CJK JP', serif"
const MARU = "'Hiragino Maru Gothic ProN', 'Hiragino Maru Gothic Pro', 'M PLUS Rounded 1c', var(--font)"
const GOTHIC = 'var(--font)'
const CLASSIC = `Georgia, 'Times New Roman', ${MINCHO}`

export const COVER_FONTS: readonly CoverFont[] = [
  { name: 'gothicBold', label: 'ゴシック 太', kind: 'gothic', family: GOTHIC, weight: 700, spacing: 0 },
  { name: 'gothic', label: 'ゴシック', kind: 'gothic', family: GOTHIC, weight: 500, spacing: 0 },
  { name: 'gothicLight', label: 'ゴシック 細', kind: 'gothic', family: GOTHIC, weight: 300, spacing: 0.02 },
  { name: 'gothicWide', label: 'ゴシック 広', kind: 'gothic', family: GOTHIC, weight: 600, spacing: 0.2 },
  { name: 'minchoBold', label: '明朝 太', kind: 'mincho', family: MINCHO, weight: 700, spacing: 0 },
  { name: 'mincho', label: '明朝', kind: 'mincho', family: MINCHO, weight: 500, spacing: 0.02 },
  { name: 'minchoWide', label: '明朝 広', kind: 'mincho', family: MINCHO, weight: 400, spacing: 0.25 },
  { name: 'maru', label: '丸ゴシック', kind: 'maru', family: MARU, weight: 700, spacing: 0.02 },
  { name: 'maruLight', label: '丸ゴシック 細', kind: 'maru', family: MARU, weight: 400, spacing: 0.05 },
  // クラシックは欧文が Georgia。本文には欧文の書体は使わず、明朝にする
  { name: 'classic', label: 'クラシック', kind: 'mincho', family: CLASSIC, weight: 700, spacing: 0.05 },
]

/** 本文の書体。cover は「表紙と同じ種類」 */
export const BODY_FONTS = [
  { name: 'cover', label: '表紙と同じ' },
  { name: 'gothic', label: 'ゴシック' },
  { name: 'mincho', label: '明朝' },
  { name: 'maru', label: '丸ゴシック' },
] as const

export type BodyFontName = (typeof BODY_FONTS)[number]['name']

const FONT_FAMILY: Record<FontKind, string> = { gothic: GOTHIC, mincho: MINCHO, maru: MARU }

/** 本文に使う書体の種類 */
export function bodyFontKind(design: Pick<NoteDesign, 'bodyFont' | 'cover'>): FontKind {
  if (design.bodyFont !== 'cover') return design.bodyFont
  return coverFont(design.cover.font)?.kind ?? 'gothic'
}

/** 本文の font-family(CSS の値) */
export const bodyFontFamily = (design: Pick<NoteDesign, 'bodyFont' | 'cover'>) => FONT_FAMILY[bodyFontKind(design)]
/** 書体の種類の font-family(デザインの見本用) */
export const fontKindFamily = (kind: FontKind) => FONT_FAMILY[kind]

/** なじむ色:暗い表紙には白っぽい線、明るい表紙には黒っぽい線(1.0.0 までの柄の色) */
export const patternInk = (tone: Tone) => (tone === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.08)')

/** 柄を描く色。auto(なじむ色)はベース色の明るさで決め、それ以外は選んだ色 */
export const subColorInk = (name: string, baseTone: Tone) => subColor(name)?.hex ?? patternInk(baseTone)

/** 表紙のタイトルの色(自動のとき):暗い表紙には白、明るい表紙には濃い色 */
export const coverTextColor = (tone: Tone) => (tone === 'dark' ? '#ffffff' : '#3a3530')

/** 表紙のタイトルの文字色(v5〜)。auto は 1.0.0 までと同じ(表紙の色の明るさで決める) */
export const COVER_TEXT_COLORS = [
  { name: 'auto', label: '自動' },
  { name: 'white', label: '白' },
  { name: 'black', label: '黒' },
] as const

export type CoverTextColorName = (typeof COVER_TEXT_COLORS)[number]['name']

/** 黒を選んだときの文字の色(真っ黒より少しやわらかく) */
const TITLE_BLACK = '#26231f'

/**
 * タイトルの文字の色と、その明るさ(影・ラベルの色を合わせるため)。
 * light:明るい文字(白)、dark:暗い文字(黒)
 */
export function coverTitleInk(textColor: string, baseTone: Tone): { color: string; ink: Tone } {
  if (textColor === 'white') return { color: '#ffffff', ink: 'light' }
  if (textColor === 'black') return { color: TITLE_BLACK, ink: 'dark' }
  const color = coverTextColor(baseTone)
  return { color, ink: baseTone === 'dark' ? 'light' : 'dark' }
}

/**
 * タイトルを柄の上でも読めるようにする薄い影(縁取り)。
 * 白い文字には暗い影、黒い文字には明るい影
 */
export const coverTitleHalo = (ink: Tone) =>
  ink === 'light'
    ? '0 0 1px rgb(0 0 0 / 0.55), 0 0 4px rgb(0 0 0 / 0.45), 0 0 8px rgb(0 0 0 / 0.25)'
    : '0 0 1px rgb(255 255 255 / 0.8), 0 0 4px rgb(255 255 255 / 0.7), 0 0 8px rgb(255 255 255 / 0.4)'

/**
 * 影を付けるか。今までと同じ見た目を保つため、「自動」の無地の表紙には付けない
 * (柄があるとき・文字色を選んだときだけ付ける)
 */
export const coverTitleNeedsHalo = (pattern: string, textColor: string) => pattern !== 'plain' || textColor !== 'auto'

export const coverPattern = (name: string | undefined) => COVER_PATTERNS.find((p) => p.name === name)
export const patternScale = (name: string | undefined) => PATTERN_SCALES.find((p) => p.name === name)
export const coverLayout = (name: string | undefined) => COVER_LAYOUTS.find((l) => l.name === name)
export const coverFont = (name: string | undefined) => COVER_FONTS.find((f) => f.name === name)
