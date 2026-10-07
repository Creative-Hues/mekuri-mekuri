import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COVER_COLORS, RANDOM_COVER_COLORS, coverColor } from '../src/design/palette'
import { coverTitleInk, patternInk } from '../src/design/cover'
import { legacyDesign, newNoteDesign, normalizeDesign } from '../src/design/defaults'
import { Cover } from '../src/components/Cover'
import type { NoteDesign } from '../src/db/db'

// 表紙のベース色の白・黒(アプリ 1.1.0〜)

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const luminance = ([r, g, b]: number[]) => {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * R + 0.7152 * G + 0.0722 * B
}
const contrast = (a: number[], b: number[]) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}
/** 半透明の色(rgba(r,g,b,a))を下の色に重ねた色 */
const over = (rgba: string, base: number[]) => {
  const [r, g, b, a] = rgba.match(/[\d.]+/g)!.map(Number)
  return [r, g, b].map((c, i) => c * a + base[i] * (1 - a))
}

const design = (cover: Partial<NoteDesign['cover']>): NoteDesign => ({
  ...legacyDesign(),
  cover: { ...legacyDesign().cover, ...cover },
})

describe('白・黒のベース色', () => {
  it('表紙の色に白と黒がある(白は明るい色、黒は暗い色)', () => {
    expect(coverColor('white')).toMatchObject({ label: '白', hex: '#ffffff', tone: 'light' })
    expect(coverColor('black')).toMatchObject({ label: '黒', tone: 'dark' })
    expect(normalizeDesign(design({ color: 'white' })).cover.color).toBe('white')
    expect(normalizeDesign(design({ color: 'black' })).cover.color).toBe('black')
  })

  it('新しいノートの表紙の色をランダムに選ぶときは、白と黒は選ばない', () => {
    expect(RANDOM_COVER_COLORS.map((c) => c.name)).not.toContain('white')
    expect(RANDOM_COVER_COLORS.map((c) => c.name)).not.toContain('black')
    expect(RANDOM_COVER_COLORS).toHaveLength(COVER_COLORS.length - 2)
    for (let i = 0; i < 100; i++) {
      const color = newNoteDesign(() => i / 100).cover.color
      expect(['white', 'black']).not.toContain(color)
    }
  })

  it('タイトルの文字色「自動」は、白い表紙では濃い色、黒い表紙では白で、読みやすい', () => {
    for (const name of ['white', 'black']) {
      const c = coverColor(name)!
      const ink = coverTitleInk('auto', c.tone)
      expect(contrast(rgb(ink.color), rgb(c.hex)), name).toBeGreaterThanOrEqual(7)
    }
  })

  it('柄の「なじむ色」は、白・黒の表紙でもほかの表紙と同じくらい見える', () => {
    for (const c of COVER_COLORS) {
      const base = rgb(c.hex)
      expect(contrast(over(patternInk(c.tone), base), base), c.name).toBeGreaterThanOrEqual(1.15)
    }
  })
})

describe('白・黒の表紙の輪郭(背景に溶け込まないように)', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles/cover.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rule = (selector: string) =>
    [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => m[1].split(',').some((s) => s.trim() === selector))
      .map((m) => m[2])
      .join('\n')

  it('白・黒の表紙には、目印のクラスが付く(本棚・ゴミ箱・デザインの見本・リンクのカードは同じ Cover を使う)', () => {
    for (const name of ['white', 'black']) {
      const html = renderToStaticMarkup(createElement(Cover, { title: 'ノート', design: design({ color: name }) }))
      expect(html).toContain(`cover--color-${name}`)
    }
    // リンクのカードの小さな表紙(タイトルなし)にも付く
    const bare = renderToStaticMarkup(createElement(Cover, { title: '', design: design({ color: 'white' }), bare: true }))
    expect(bare).toContain('cover--color-white')
  })

  it('白い表紙には暗い縁、黒い表紙には明るい縁を内側に付ける', () => {
    expect(rule('.cover--color-white')).toMatch(/box-shadow: inset 0 0 0 1px rgb\(0 0 0 \/ 0\.\d+\)/)
    expect(rule('.cover--color-black')).toMatch(/box-shadow: inset 0 0 0 1px rgb\(255 255 255 \/ 0\.\d+\)/)
  })

  it('黒い表紙では、背表紙の影と下の帯を明るくして見分けられるようにする', () => {
    expect(rule('.cover--color-black::before')).toMatch(/background: rgb\(255 255 255 \/ 0\.\d+\)/)
    expect(rule('.cover--color-black.cover--text-auto.cover--bottomBand .cover-title')).toMatch(
      /background: rgb\(255 255 255 \/ 0\.\d+\)/,
    )
  })

  it('デザインの柄の見本・色の見本にも輪郭がある', () => {
    const note = readFileSync(join(process.cwd(), 'src/styles/note.css'), 'utf8')
    expect(note).toMatch(/\.design-tile-pattern\[data-color='white'\] \{\s*box-shadow: inset/)
    expect(note).toMatch(/\.design-tile-pattern\[data-color='black'\] \{\s*box-shadow: inset/)
    // 色の見本の枠は、白い背景でも暗い背景でも見える中間のグレー
    expect(/\.swatch-fill \{[^}]*border: 1px solid rgb\(128 128 128 \/ 0\.(\d+)\)/.exec(note)?.[1]).toBeTruthy()
  })
})

describe('白・黒の表紙の下の帯(自動の文字色は白)', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles/cover.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  /** そのセレクタの帯の色(rgb(r g b / a)) */
  const band = (selector: string) => {
    const m = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((r) => r[1].split(',').some((s) => s.trim() === selector))
    const v = /background: rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/.exec(m?.[2] ?? '')!
    return `rgba(${v[1]},${v[2]},${v[3]},${v[4]})`
  }
  it.each(['white', 'black'])('%s の表紙でも、帯の上の白い文字が読める(4.5 以上)', (name) => {
    const base = rgb(coverColor(name)!.hex)
    const color = band(`.cover--color-${name}.cover--text-auto.cover--bottomBand .cover-title`)
    expect(contrast(rgb('#ffffff'), over(color, base))).toBeGreaterThanOrEqual(4.5)
  })
})

describe('黒を濃くした(#1a1a1a)あとも見分けられる', () => {
  const black = rgb(coverColor('black')!.hex)
  it('墨(#3a3a3e)と見分けられる', () => {
    expect(coverColor('black')!.hex).toBe('#1a1a1a')
    expect(contrast(black, rgb(coverColor('charcoal')!.hex))).toBeGreaterThanOrEqual(1.4)
  })
  it('輪郭・背表紙の影が黒い表紙の上で見える', () => {
    expect(contrast(over('rgba(255,255,255,0.22)', black), black)).toBeGreaterThanOrEqual(1.5)
    expect(contrast(over('rgba(255,255,255,0.1)', black), black)).toBeGreaterThanOrEqual(1.25)
  })
})

describe('文字の配置「中央上」(1.1.0〜)', () => {
  it('配置の一覧にあり、表紙に cover--topCenter が付く。文字色・影もほかの配置と同じく効く', () => {
    const html = renderToStaticMarkup(
      createElement(Cover, { title: 'ノート', design: design({ layout: 'topCenter', pattern: 'dots', textColor: 'white' }) }),
    )
    expect(html).toContain('cover--topCenter')
    expect(html).toContain('cover--text-white')
    expect(html).toContain('cover--halo')
    expect(normalizeDesign(design({ layout: 'topCenter' })).cover.layout).toBe('topCenter')
    const css = readFileSync(join(process.cwd(), 'src/styles/cover.css'), 'utf8')
    expect(css).toMatch(/\.cover--topCenter \{\s*align-items: flex-start;\s*justify-content: center;\s*text-align: center;/)
    // 影を消すのはラベル・帯の配置だけ(中央上には影が付く)
    expect(css).not.toMatch(/\.cover--halo\.cover--topCenter/)
  })
})
