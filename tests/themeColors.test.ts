import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PAPER_COLORS } from '../src/design/palette'
import { THEME_COLOR } from '../src/theme/theme'

// アプリの配色(src/styles/base.css)の読みやすさ。
// 文字はコントラスト比 4.5 以上(WCAG の AA)を目安にする

const css = readFileSync(join(process.cwd(), 'src/styles/base.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** セレクタ(空白は無視)の { } の中の CSS 変数を読む */
function vars(selector: string): Record<string, string> {
  const norm = (s: string) => s.replace(/\s+/g, '')
  const re = /([^{}]+)\{([^{}]*)\}/g
  for (const m of css.matchAll(re)) {
    if (norm(m[1]) !== norm(selector)) continue
    return Object.fromEntries([...m[2].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]))
  }
  throw new Error(`base.css に ${selector} がありません`)
}

const light = { ...vars(':root'), ...vars(':root, .tone-light') }
const dark = { ...light, ...vars(":root[data-theme='dark']"), ...vars(":root[data-theme='dark'], .tone-dark") }

/** 相対輝度(WCAG) */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`色の値ではありません:${hex}`)
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

describe.each([
  ['ライト', light],
  ['ダーク', dark],
] as const)('%sモードの配色', (_, v) => {
  it('アクセントカラーのボタンの文字(--on-accent)が読める', () => {
    expect(contrast(v['--on-accent'], v['--accent'])).toBeGreaterThanOrEqual(4.5)
  })

  it('線・文字のアクセント(--accent-ink)が、背景・紙・面の上で読める', () => {
    for (const bg of ['--bg', '--paper', '--surface']) {
      expect(contrast(v['--accent-ink'], v[bg]), bg).toBeGreaterThanOrEqual(4.5)
    }
    // 選択中の背景の上(目次の現在地など)でも見分けられる
    expect(contrast(v['--accent-ink'], v['--accent-soft'])).toBeGreaterThanOrEqual(3)
  })

  it('本文・補助の文字が読める', () => {
    for (const bg of ['--bg', '--paper', '--surface', '--accent-soft']) {
      expect(contrast(v['--ink'], v[bg]), bg).toBeGreaterThanOrEqual(7)
      expect(contrast(v['--ink-soft'], v[bg]), bg).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('控えめなボタン(キャンセル・あとで)が、背景・面(ダイアログ・設定)の上でボタンとわかる', () => {
    for (const bg of ['--bg', '--surface']) {
      // 枠線がはっきり見える
      expect(contrast(v['--btn-border'], v[bg]), bg).toBeGreaterThanOrEqual(2.3)
      // 塗りも背景と同じ色にならない
      expect(v['--btn-bg']).not.toBe(v[bg])
    }
    expect(contrast(v['--ink'], v['--btn-bg'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(v['--ink'], v['--btn-bg-hover'])).toBeGreaterThanOrEqual(4.5)
  })

  it('いくつかから1つを選ぶボタン:全体の枠が見え、選んでいる項目と選んでいない項目を見分けられる', () => {
    // 全体の枠(置かれる背景・面のどちらの上でも)
    for (const bg of ['--bg', '--surface']) {
      expect(contrast(v['--btn-border'], v[bg]), bg).toBeGreaterThanOrEqual(2.3)
    }
    // 選んでいない項目の文字が読める
    expect(contrast(v['--ink-soft'], v['--seg-bg'])).toBeGreaterThanOrEqual(4.5)
    // 選んでいる項目はアクセントで塗り、文字が読める
    expect(contrast(v['--on-accent'], v['--accent'])).toBeGreaterThanOrEqual(4.5)
    // 選んでいる項目の塗りが、選んでいない項目の地と明るさでも違う
    expect(contrast(v['--accent'], v['--seg-bg'])).toBeGreaterThanOrEqual(1.5)
    // 選んでいる項目の縁(--accent-ink)は、選んでいない項目の地からはっきり見える
    expect(contrast(v['--accent-ink'], v['--seg-bg'])).toBeGreaterThanOrEqual(3)
    // 文字の色でも見分けられる(選んでいる=--on-accent、選んでいない=--ink-soft)
    expect(v['--on-accent']).not.toBe(v['--ink-soft'])
  })

  it('いくつかから1つを選ぶボタンは、選んでいる項目をアクセントで塗る(CSS)', () => {
    const screens = readFileSync(join(process.cwd(), 'src/styles/screens.css'), 'utf8')
    const rule = /\.segmented-btn\.is-selected\s*\{([^}]*)\}/.exec(screens)?.[1] ?? ''
    expect(rule).toContain('background: var(--accent)')
    expect(rule).toContain('color: var(--on-accent)')
    expect(rule).toContain('var(--accent-ink)')
    const box = /\.segmented\s*\{([^}]*)\}/.exec(screens)?.[1] ?? ''
    expect(box).toContain('border: 1px solid var(--btn-border)')
    expect(box).toContain('background: var(--seg-bg)')
  })

  it('紙の縁が、背景と紙の両方から見分けられる(白い背景に白い紙でも境目がわかる)', () => {
    expect(contrast(v['--paper-edge'], v['--bg'])).toBeGreaterThanOrEqual(1.3)
    expect(contrast(v['--paper-edge'], v['--paper'])).toBeGreaterThanOrEqual(1.3)
  })
})

describe('配色の指定どおり', () => {
  it('ライトは背景が白、ダークは背景がグレー', () => {
    expect(light['--bg']).toBe('#ffffff')
    const g = dark['--bg']
    // グレー:赤・緑・青の差が小さく、黒でも白でもない
    const [r, gr, b] = [1, 3, 5].map((i) => parseInt(g.slice(i, i + 2), 16))
    expect(Math.max(r, gr, b) - Math.min(r, gr, b)).toBeLessThanOrEqual(8)
    expect(r).toBeGreaterThan(0x20)
    expect(r).toBeLessThan(0x80)
  })

  it('アクセントカラー:ライトはライトブルー、ダークはライトパープル(どちらも明るい色)', () => {
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    const [lr, lg, lb] = rgb(light['--accent'])
    expect(lb).toBeGreaterThan(lr) // 青が強い
    expect(lb).toBeGreaterThan(lg)
    const [dr, dg, db] = rgb(dark['--accent'])
    expect(db).toBeGreaterThan(dg) // 青と赤が緑より強い=紫
    expect(dr).toBeGreaterThan(dg)
    // 指定の色(ライト #8AC2DD・ダーク #C0A3CA)。どちらも明るい色(相対輝度 0.4 以上)
    expect(light['--accent']).toBe('#8ac2dd')
    expect(dark['--accent']).toBe('#c0a3ca')
    expect(luminance(light['--accent'])).toBeGreaterThan(0.4)
    expect(luminance(dark['--accent'])).toBeGreaterThan(0.4)
  })

  it('画面の上の帯の色(theme-color)は背景と同じ', () => {
    expect(THEME_COLOR.light).toBe(light['--bg'])
    expect(THEME_COLOR.dark).toBe(dark['--bg'])
  })
})

describe('アプリと明るさの違う紙の上のアクセント', () => {
  it('ライトモードの暗い紙(紺・黒板・墨)でも読める', () => {
    const ink = vars(":root[data-theme='light'] .tone-dark")['--accent-ink']
    for (const p of PAPER_COLORS.filter((c) => c.tone === 'dark')) {
      expect(contrast(ink, p.hex), p.name).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('ダークモードの明るい紙(白・クリームなど)でも読める', () => {
    const ink = vars(":root[data-theme='dark'] .tone-light")['--accent-ink']
    for (const p of PAPER_COLORS.filter((c) => c.tone === 'light')) {
      expect(contrast(ink, p.hex), p.name).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('いくつかから1つを選ぶボタンの文字', () => {
  const screens = readFileSync(join(process.cwd(), 'src/styles/screens.css'), 'utf8')
  const rules = [...screens.matchAll(/\.segmented-btn\s*\{([^}]*)\}/g)].map((m) => m[1])

  it('文字はボタンの中で折り返さない', () => {
    expect(rules[0]).toContain('white-space: nowrap')
    expect(rules[0]).toContain('min-width: 0')
  })

  it('幅の狭いスマホでは、文字を少し小さくして収める', () => {
    const narrow = /@media \(max-width: 420px\) \{\s*\.segmented-btn \{([^}]*)\}/.exec(screens)?.[1] ?? ''
    expect(narrow).toMatch(/font-size: 1[0-3]px/)
  })

  it('画面の明るさの選択肢は短い表記(自動・ライト・ダーク)', async () => {
    const { THEME_OPTIONS } = await import('../src/theme/theme')
    expect(THEME_OPTIONS.map((o) => o.label)).toEqual(['自動', 'ライト', 'ダーク'])
  })
})

describe('リストの点・番号・ToDo のチェックボックス(本文と付箋)', () => {
  const editor = readFileSync(join(process.cwd(), 'src/styles/editor.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  /** セレクタ(カンマ区切りの1つ)に合う規則の中身 */
  const rule = (selector: string) =>
    [...editor.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => m[1].split(',').some((s) => s.trim() === selector))
      .map((m) => m[2])
      .join('\n')

  it.each(['.page-editor', '.sticky-editor'])('%s:点・番号・チェックボックスは本文の文字と同じ色(アクセントの色ではない)', (ed) => {
    expect(rule(`${ed} li::marker`)).toContain('color: var(--ink)')
    const box = rule(`${ed} ul[data-type='taskList'] input[type='checkbox']`)
    expect(box).toContain('accent-color: var(--ink)')
    expect(box).not.toContain('--accent')
  })

  it('本文の文字の色(--ink)は、ライト・ダークの紙と、色を選んだすべての紙の上で読める', () => {
    expect(contrast(light['--ink'], light['--paper'])).toBeGreaterThanOrEqual(7)
    expect(contrast(dark['--ink'], dark['--paper'])).toBeGreaterThanOrEqual(7)
    // 色を選んだ紙は、紙の明るさで .tone-light / .tone-dark の --ink になる(白い紙は黒、紺の紙は白)
    for (const p of PAPER_COLORS) {
      const ink = p.tone === 'light' ? light['--ink'] : dark['--ink']
      expect(contrast(ink, p.hex), p.name).toBeGreaterThanOrEqual(7)
    }
  })

  it('付箋の上でも読める(付箋は明るい紙として .tone-light の文字色になる)', () => {
    for (const v of [light, dark]) {
      for (const name of ['yellow', 'pink', 'orange', 'green', 'blue', 'purple']) {
        expect(contrast(light['--ink'], v[`--st-${name}`]), name).toBeGreaterThanOrEqual(7)
      }
    }
  })
})
