import { describe, expect, it } from 'vitest'
import {
  BODY_FONTS,
  COVER_FONTS,
  COVER_LAYOUTS,
  COVER_PATTERNS,
  PATTERN_SCALES,
  bodyFontFamily,
  bodyFontKind,
  coverTextColor,
  patternInk,
  subColorInk,
} from '../src/design/cover'
import { BORDER_COLORS, BORDER_WIDTHS, COVER_COLORS, PAPER_COLORS, SUB_COLORS } from '../src/design/palette'
import { legacyDesign, legacyDesignV3, newNoteDesign, normalizeDesign, upgradeDesignToV5 } from '../src/design/defaults'
import { paperTone, resolveTheme } from '../src/theme/theme'
import type { NoteDesign } from '../src/db/db'

// 表紙のテンプレート・デザインの色・本文の書体・ダークモードの判定

const names = (list: readonly { name: string }[]) => list.map((x) => x.name)
const unique = (list: string[]) => new Set(list).size === list.length

describe('表紙のテンプレート', () => {
  it.each([
    ['柄', COVER_PATTERNS],
    ['色', COVER_COLORS],
    ['文字の配置', COVER_LAYOUTS],
    ['書体', COVER_FONTS],
  ] as const)('%sは10種類以上あり、名前が重ならない', (_, list) => {
    expect(list.length).toBeGreaterThanOrEqual(10)
    expect(unique(names(list))).toBe(true)
    expect(list.every((x) => 'label' in x && x.label.length > 0)).toBe(true)
  })

  it('市松・青海波・鱗はなくなり、太いストライプが増えた(1.1.0〜)', () => {
    const list = names(COVER_PATTERNS)
    for (const removed of ['ichimatsu', 'seigaiha', 'uroko']) expect(list).not.toContain(removed)
    expect(list).toContain('wideStripe')
  })

  it('どの柄も、すべての大きさ・なじむ色(明暗)・はっきりした色で描ける', () => {
    const inks = [patternInk('light'), patternInk('dark'), '#2f4a6d']
    for (const p of COVER_PATTERNS) {
      for (const { scale } of PATTERN_SCALES) {
        for (const ink of inks) {
          const css = p.css(ink, scale)
          expect(typeof css).toBe('object')
          if (p.name !== 'plain') {
            expect(css.backgroundImage).toBeTruthy()
            expect(css.backgroundImage).not.toContain('NaN')
          }
        }
      }
    }
  })

  it('柄の大きさ:小・中・大。中が今までの大きさで、倍率で柄の大きさが変わる', () => {
    expect(PATTERN_SCALES.map((s) => s.label)).toEqual(['小', '中', '大'])
    expect(PATTERN_SCALES.find((s) => s.name === 'medium')!.scale).toBe(1)
    const dots = COVER_PATTERNS.find((p) => p.name === 'dots')!
    expect(dots.css('#000', 1).backgroundSize).toBe('14px 14px') // 1.0.0 と同じ
    expect(dots.css('#000', 0.6).backgroundSize).toBe('8.4px 8.4px')
    expect(dots.css('#000', 1.6).backgroundSize).toBe('22.4px 22.4px')
    const stripe = COVER_PATTERNS.find((p) => p.name === 'stripe')!
    expect(stripe.css('#000', 1).backgroundImage).toBe('repeating-linear-gradient(90deg, #000 0 6px, transparent 6px 18px)')
    expect(stripe.css('#000', 1.6).backgroundImage).toContain('9.6px 28.8px')
  })

  it('柄はサブ色で描かれる', () => {
    const stripe = COVER_PATTERNS.find((p) => p.name === 'stripe')!
    expect(stripe.css(subColorInk('white', 'dark'), 1).backgroundImage).toContain('#ffffff')
  })

  it('暗い表紙には白い文字、明るい表紙には濃い文字', () => {
    expect(coverTextColor('dark')).toBe('#ffffff')
    expect(coverTextColor('light')).not.toBe('#ffffff')
  })
})

describe('サブ色(柄の色)', () => {
  it('表紙の色12色+白+黒。名前が重ならない', () => {
    expect(names(SUB_COLORS)).toEqual([...names(COVER_COLORS), 'white', 'black'])
    expect(unique(names(SUB_COLORS))).toBe(true)
    for (const c of SUB_COLORS) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('なじむ色(auto)は、ベース色の明るさに合わせた今までの柄の色', () => {
    expect(subColorInk('auto', 'dark')).toBe(patternInk('dark'))
    expect(subColorInk('auto', 'light')).toBe(patternInk('light'))
  })

  it('色を選ぶとその色、知らない名前はなじむ色', () => {
    expect(subColorInk('navy', 'light')).toBe('#2f4a6d')
    expect(subColorInk('black', 'dark')).toBe('#2b2b2b')
    expect(subColorInk('rainbow', 'dark')).toBe(patternInk('dark'))
  })
})

describe('本文の書体', () => {
  const design = (font: string, bodyFont: NoteDesign['bodyFont']) => ({
    bodyFont,
    cover: { ...legacyDesign().cover, font },
  })

  it('選べるのは 表紙と同じ・ゴシック・明朝・丸ゴシック', () => {
    expect(BODY_FONTS.map((f) => f.label)).toEqual(['表紙と同じ', 'ゴシック', '明朝', '丸ゴシック'])
  })

  it('「表紙と同じ」は、表紙の書体の種類を使う(太さ・字間は使わない)', () => {
    const kinds = Object.fromEntries(COVER_FONTS.map((f) => [f.name, bodyFontKind(design(f.name, 'cover'))]))
    expect(kinds).toEqual({
      gothicBold: 'gothic',
      gothic: 'gothic',
      gothicLight: 'gothic',
      gothicWide: 'gothic',
      minchoBold: 'mincho',
      mincho: 'mincho',
      minchoWide: 'mincho',
      maru: 'maru',
      maruLight: 'maru',
      classic: 'mincho', // 欧文の Georgia は本文には使わない
    })
  })

  it('別にした場合は、表紙の書体に関係なく選んだ書体', () => {
    expect(bodyFontKind(design('minchoBold', 'gothic'))).toBe('gothic')
    expect(bodyFontKind(design('gothicBold', 'maru'))).toBe('maru')
    expect(bodyFontKind(design('maru', 'mincho'))).toBe('mincho')
  })

  it('font-family:ゴシックはアプリの標準の書体、明朝・丸ゴシックは専用の書体', () => {
    expect(bodyFontFamily(design('gothicBold', 'cover'))).toBe('var(--font)')
    expect(bodyFontFamily(design('mincho', 'cover'))).toContain('Mincho')
    expect(bodyFontFamily(design('gothic', 'maru'))).toContain('Maru')
    // クラシックの表紙でも、本文に Georgia は使わない
    expect(bodyFontFamily(design('classic', 'cover'))).not.toContain('Georgia')
  })
})

describe('デザインの色', () => {
  it.each([
    ['紙の背景色', PAPER_COLORS],
    ['縁の色', BORDER_COLORS],
    ['表紙の色', COVER_COLORS],
  ] as const)('%sは12色前後あり、名前が重ならず、色の値が正しい', (_, list) => {
    expect(list.length).toBeGreaterThanOrEqual(12)
    expect(unique(names(list))).toBe(true)
    for (const c of list) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('紙の背景色には暗い色もある(ダークモードで使いやすいように)', () => {
    expect(PAPER_COLORS.some((c) => c.tone === 'dark')).toBe(true)
  })

  it('縁の太さ:なし/細/中/太', () => {
    expect(BORDER_WIDTHS.map((w) => w.label)).toEqual(['なし', '細', '中', '太'])
  })
})

describe('デザインの既定値と読み直し', () => {
  it('今までのノートと同じ見た目:紙は指定なし、縁なし、左上の文字の無地の表紙、なじむ色・中、本文は表紙と同じ', () => {
    expect(legacyDesign()).toEqual({
      paper: null,
      border: { color: 'brown', width: 'none' },
      cover: {
        pattern: 'plain', color: 'slate', subColor: 'auto', patternScale: 'medium', layout: 'topLeft', font: 'gothicBold',
      },
      bodyFont: 'cover',
    })
    // 表紙が ゴシック 太 なので、本文は今までどおりゴシック
    expect(bodyFontKind(legacyDesign())).toBe('gothic')
  })

  it('v3 の形(古いデータの移し替えで使う)は変えていない', () => {
    expect(legacyDesignV3()).toEqual({
      paper: null,
      border: { color: 'brown', width: 'none' },
      cover: { pattern: 'plain', color: 'slate', layout: 'topLeft', font: 'gothicBold' },
    })
  })

  it('新しいノートの表紙の色は、用意した色の中から選ばれる。サブ色はなじむ色、本文は表紙と同じ', () => {
    expect(newNoteDesign(() => 0).cover.color).toBe(COVER_COLORS[0].name)
    expect(newNoteDesign(() => 0.999).cover.color).toBe(COVER_COLORS.at(-1)!.name)
    expect(newNoteDesign(() => 0)).toMatchObject({
      bodyFont: 'cover',
      cover: { subColor: 'auto', patternScale: 'medium', pattern: 'plain' },
    })
  })

  it('知らない名前や欠けた項目は既定値にする(新しいバージョンのデータを開いたときなど)', () => {
    const d = normalizeDesign({
      paper: 'rainbow',
      border: { color: 'blue' },
      cover: { pattern: 'dots', color: '???', layout: 7, font: 'mincho', subColor: 'gold', patternScale: 'huge' },
      bodyFont: 'comic',
    })
    expect(d).toEqual({
      paper: null,
      border: { color: 'blue', width: 'none' },
      cover: {
        pattern: 'dots', color: 'slate', subColor: 'auto', patternScale: 'medium', layout: 'topLeft', font: 'mincho',
      },
      bodyFont: 'cover',
    })
    expect(normalizeDesign(undefined)).toEqual(legacyDesign())
    expect(normalizeDesign('abc')).toEqual(legacyDesign())
  })

  it('なくした柄が残っていても、表示のときは無地になる', () => {
    expect(normalizeDesign({ cover: { pattern: 'seigaiha' } }).cover.pattern).toBe('plain')
  })

  it('正しいデザインはそのまま', () => {
    const d: NoteDesign = {
      paper: 'navy',
      border: { color: 'gold', width: 'thick' },
      cover: { pattern: 'wave', color: 'wine', subColor: 'white', patternScale: 'large', layout: 'vertical', font: 'maru' },
      bodyFont: 'mincho',
    }
    expect(normalizeDesign(d)).toEqual(d)
  })
})

describe('デザインの移し替え(v4 → v5)', () => {
  const v4 = (cover: object, extra: object = {}) => ({
    paper: 'cream',
    border: { color: 'gold', width: 'thin' },
    cover: { color: 'wine', layout: 'band', font: 'minchoBold', ...cover },
    ...extra,
  })

  it('本文の書体は「表紙と同じ」、サブ色は なじむ色、柄の大きさは 中 になり、ほかは変わらない', () => {
    expect(upgradeDesignToV5(v4({ pattern: 'dots' }))).toEqual({
      paper: 'cream',
      border: { color: 'gold', width: 'thin' },
      cover: {
        pattern: 'dots', color: 'wine', layout: 'band', font: 'minchoBold', subColor: 'auto', patternScale: 'medium',
      },
      bodyFont: 'cover',
    })
  })

  it.each(['ichimatsu', 'seigaiha', 'uroko'])('なくした柄(%s)は無地になる', (pattern) => {
    expect(upgradeDesignToV5(v4({ pattern })).cover.pattern).toBe('plain')
  })

  it('残した柄はそのまま', () => {
    for (const p of names(COVER_PATTERNS)) expect(upgradeDesignToV5(v4({ pattern: p })).cover.pattern).toBe(p)
  })

  it('何度通しても同じ結果(すでに v5 の項目があれば変えない)', () => {
    const once = upgradeDesignToV5(v4({ pattern: 'uroko' }))
    expect(upgradeDesignToV5(once)).toEqual(once)
    const chosen = upgradeDesignToV5(v4({ pattern: 'dots', subColor: 'black', patternScale: 'small' }, { bodyFont: 'maru' }))
    expect(chosen.cover).toMatchObject({ subColor: 'black', patternScale: 'small' })
    expect(chosen.bodyFont).toBe('maru')
  })

  it('デザインがないノートは、今までと同じ見た目にする', () => {
    expect(upgradeDesignToV5(undefined)).toEqual(legacyDesign())
  })
})

describe('ダークモードの判定', () => {
  it('「端末に合わせる」は端末の設定どおり、ライト/ダークは常にその色', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('紙の明るさ:背景色を選んだノートはその色の明るさ、指定なしはアプリに合わせる', () => {
    expect(paperTone('white', 'dark')).toBe('light') // ダークモードでも白い紙なら文字は濃い色
    expect(paperTone('navy', 'light')).toBe('dark')
    expect(paperTone(null, 'dark')).toBe('dark')
    expect(paperTone(null, 'light')).toBe('light')
    expect(paperTone('rainbow', 'light')).toBe('light') // 知らない色名は指定なしと同じ
  })
})

describe('新しいノートの表紙の色', () => {
  it('避ける色を渡すと、その色は選ばれない(どの乱数でも)', () => {
    for (const avoid of COVER_COLORS.map((c) => c.name)) {
      for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
        expect(newNoteDesign(() => r, avoid).cover.color).not.toBe(avoid)
      }
    }
  })
})
