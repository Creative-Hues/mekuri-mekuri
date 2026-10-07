import { describe, expect, it } from 'vitest'
import { COVER_FONTS, COVER_LAYOUTS, COVER_PATTERNS, coverTextColor, patternInk } from '../src/design/cover'
import { BORDER_COLORS, BORDER_WIDTHS, COVER_COLORS, PAPER_COLORS } from '../src/design/palette'
import { legacyDesign, newNoteDesign, normalizeDesign } from '../src/design/defaults'
import { paperTone, resolveTheme } from '../src/theme/theme'

// 表紙のテンプレート・デザインの色・ダークモードの判定

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

  it('どの柄も、明るい表紙・暗い表紙の両方で描ける', () => {
    for (const p of COVER_PATTERNS) {
      for (const tone of ['light', 'dark'] as const) {
        const css = p.css(patternInk(tone))
        expect(typeof css).toBe('object')
        if (p.name !== 'plain') expect(css.backgroundImage).toBeTruthy()
      }
    }
  })

  it('暗い表紙には白い文字、明るい表紙には濃い文字', () => {
    expect(coverTextColor('dark')).toBe('#ffffff')
    expect(coverTextColor('light')).not.toBe('#ffffff')
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
  it('今までのノートと同じ見た目:紙は指定なし、縁なし、左上の文字の無地の表紙', () => {
    expect(legacyDesign()).toEqual({
      paper: null,
      border: { color: 'brown', width: 'none' },
      cover: { pattern: 'plain', color: 'slate', layout: 'topLeft', font: 'gothicBold' },
    })
  })

  it('新しいノートの表紙の色は、用意した色の中から選ばれる', () => {
    expect(newNoteDesign(() => 0).cover.color).toBe(COVER_COLORS[0].name)
    expect(newNoteDesign(() => 0.999).cover.color).toBe(COVER_COLORS.at(-1)!.name)
  })

  it('知らない名前や欠けた項目は既定値にする(新しいバージョンのデータを開いたときなど)', () => {
    const d = normalizeDesign({
      paper: 'rainbow',
      border: { color: 'blue' },
      cover: { pattern: 'dots', color: '???', layout: 7, font: 'mincho' },
    })
    expect(d).toEqual({
      paper: null,
      border: { color: 'blue', width: 'none' },
      cover: { pattern: 'dots', color: 'slate', layout: 'topLeft', font: 'mincho' },
    })
    expect(normalizeDesign(undefined)).toEqual(legacyDesign())
    expect(normalizeDesign('abc')).toEqual(legacyDesign())
  })

  it('正しいデザインはそのまま', () => {
    const d = {
      paper: 'navy',
      border: { color: 'gold', width: 'thick' as const },
      cover: { pattern: 'seigaiha', color: 'wine', layout: 'vertical', font: 'maru' },
    }
    expect(normalizeDesign(d)).toEqual(d)
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
