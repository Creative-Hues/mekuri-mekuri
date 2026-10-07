/**
 * 表紙のテンプレート(柄・文字の配置・書体)。色は palette.ts の COVER_COLORS。
 * 柄は画像ファイルを使わず、CSSのグラデーションとSVGで描く(端末で見た目が変わらないように)。
 * データには名前だけを保存する。名前を変える・消すと保存済みの表紙が出なくなるので、追加だけにすること
 */

import type { Tone } from './palette'

export interface CoverPattern {
  name: string
  label: string
  /** ink:柄を描く色(表紙の色が明るいか暗いかで変える) */
  css: (ink: string) => { backgroundImage?: string; backgroundSize?: string; backgroundPosition?: string }
}

/** SVG を背景に使う(色の # は URL の中で使えないので変換する) */
const svg = (body: string, w: number, h: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`,
  )}")`

export const COVER_PATTERNS: readonly CoverPattern[] = [
  { name: 'plain', label: '無地', css: () => ({}) },
  {
    name: 'stripe',
    label: 'ストライプ',
    css: (ink) => ({ backgroundImage: `repeating-linear-gradient(90deg, ${ink} 0 6px, transparent 6px 18px)` }),
  },
  {
    name: 'border',
    label: 'ボーダー',
    css: (ink) => ({ backgroundImage: `repeating-linear-gradient(0deg, ${ink} 0 6px, transparent 6px 18px)` }),
  },
  {
    name: 'dots',
    label: 'ドット',
    css: (ink) => ({
      backgroundImage: `radial-gradient(${ink} 2.2px, transparent 2.7px)`,
      backgroundSize: '14px 14px',
    }),
  },
  {
    name: 'check',
    label: 'チェック',
    css: (ink) => ({
      backgroundImage: `linear-gradient(${ink} 2px, transparent 2px), linear-gradient(90deg, ${ink} 2px, transparent 2px)`,
      backgroundSize: '24px 24px',
    }),
  },
  {
    name: 'gingham',
    label: 'ギンガム',
    css: (ink) => ({
      backgroundImage: `repeating-linear-gradient(0deg, ${ink} 0 8px, transparent 8px 16px), repeating-linear-gradient(90deg, ${ink} 0 8px, transparent 8px 16px)`,
    }),
  },
  {
    name: 'grid',
    label: '方眼',
    css: (ink) => ({
      backgroundImage: `linear-gradient(${ink} 1px, transparent 1px), linear-gradient(90deg, ${ink} 1px, transparent 1px)`,
      backgroundSize: '9px 9px',
    }),
  },
  {
    name: 'diagonal',
    label: '斜線',
    css: (ink) => ({ backgroundImage: `repeating-linear-gradient(45deg, ${ink} 0 3px, transparent 3px 12px)` }),
  },
  {
    name: 'wave',
    label: '波',
    css: (ink) => ({
      backgroundImage: svg(
        `<path d='M0 6 Q6 0 12 6 T24 6' fill='none' stroke='${ink}' stroke-width='2'/>`,
        24,
        12,
      ),
      backgroundSize: '24px 12px',
    }),
  },
  {
    name: 'ichimatsu',
    label: '市松',
    css: (ink) => ({
      backgroundImage: `conic-gradient(${ink} 25%, transparent 0 50%, ${ink} 0 75%, transparent 0)`,
      backgroundSize: '24px 24px',
    }),
  },
  {
    name: 'seigaiha',
    label: '青海波',
    css: (ink) => ({
      backgroundImage: svg(
        [16, 11, 6]
          .map(
            (r) =>
              `<circle cx='16' cy='16' r='${r}' fill='none' stroke='${ink}' stroke-width='1.6'/>` +
              `<circle cx='0' cy='0' r='${r}' fill='none' stroke='${ink}' stroke-width='1.6'/>` +
              `<circle cx='32' cy='0' r='${r}' fill='none' stroke='${ink}' stroke-width='1.6'/>`,
          )
          .join(''),
        32,
        16,
      ),
      backgroundSize: '32px 16px',
    }),
  },
  {
    name: 'uroko',
    label: '鱗',
    css: (ink) => ({
      backgroundImage: svg(`<path d='M0 20 L10 0 L20 20 Z' fill='${ink}'/>`, 20, 20),
      backgroundSize: '20px 20px',
    }),
  },
]

export interface CoverLayout {
  name: string
  label: string
}

/** 文字の配置(見た目は screens.css の .cover--layout-<name>) */
export const COVER_LAYOUTS: readonly CoverLayout[] = [
  { name: 'topLeft', label: '左上' },
  { name: 'center', label: '中央' },
  { name: 'bottomLeft', label: '左下' },
  { name: 'bottomRight', label: '右下' },
  { name: 'band', label: '帯' },
  { name: 'label', label: 'ラベル' },
  { name: 'vertical', label: '縦書き' },
  { name: 'bottomBand', label: '下の帯' },
  { name: 'frame', label: '枠' },
  { name: 'spine', label: '背表紙' },
]

export interface CoverFont {
  name: string
  label: string
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
  { name: 'gothicBold', label: 'ゴシック 太', family: GOTHIC, weight: 700, spacing: 0 },
  { name: 'gothic', label: 'ゴシック', family: GOTHIC, weight: 500, spacing: 0 },
  { name: 'gothicLight', label: 'ゴシック 細', family: GOTHIC, weight: 300, spacing: 0.02 },
  { name: 'gothicWide', label: 'ゴシック 広', family: GOTHIC, weight: 600, spacing: 0.2 },
  { name: 'minchoBold', label: '明朝 太', family: MINCHO, weight: 700, spacing: 0 },
  { name: 'mincho', label: '明朝', family: MINCHO, weight: 500, spacing: 0.02 },
  { name: 'minchoWide', label: '明朝 広', family: MINCHO, weight: 400, spacing: 0.25 },
  { name: 'maru', label: '丸ゴシック', family: MARU, weight: 700, spacing: 0.02 },
  { name: 'maruLight', label: '丸ゴシック 細', family: MARU, weight: 400, spacing: 0.05 },
  { name: 'classic', label: 'クラシック', family: CLASSIC, weight: 700, spacing: 0.05 },
]

/** 柄を描く色:暗い表紙には白っぽい線、明るい表紙には黒っぽい線 */
export const patternInk = (tone: Tone) => (tone === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.08)')
/** 表紙のタイトルの色 */
export const coverTextColor = (tone: Tone) => (tone === 'dark' ? '#ffffff' : '#3a3530')

export const coverPattern = (name: string | undefined) => COVER_PATTERNS.find((p) => p.name === name)
export const coverLayout = (name: string | undefined) => COVER_LAYOUTS.find((l) => l.name === name)
export const coverFont = (name: string | undefined) => COVER_FONTS.find((f) => f.name === name)
