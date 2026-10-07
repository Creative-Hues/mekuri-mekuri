import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  COVER_TEXT_COLORS,
  coverTextColor,
  coverTitleHalo,
  coverTitleInk,
  coverTitleNeedsHalo,
} from '../src/design/cover'
import { legacyDesign, newNoteDesign, normalizeDesign, upgradeDesignToV5 } from '../src/design/defaults'
import { Cover } from '../src/components/Cover'
import type { NoteDesign } from '../src/db/db'

// 表紙のタイトルの文字色(自動・白・黒)と、読みやすくする影・ラベルの色

const design = (cover: Partial<NoteDesign['cover']>): NoteDesign => ({
  ...legacyDesign(),
  cover: { ...legacyDesign().cover, ...cover },
})
/** 表紙を HTML にして、一番外の要素の class と style を取り出す */
function render(d: NoteDesign) {
  const html = renderToStaticMarkup(createElement(Cover, { title: 'ノート', design: d }))
  const el = new DOMParser().parseFromString(html, 'text/html').body.firstElementChild as HTMLElement
  return { classes: [...el.classList], style: el.style, html }
}

describe('タイトルの文字色の選択肢', () => {
  it('自動・白・黒の3つ', () => {
    expect(COVER_TEXT_COLORS.map((c) => c.label)).toEqual(['自動', '白', '黒'])
  })

  it('今のノート・新しいノートは自動', () => {
    expect(legacyDesign().cover.textColor).toBe('auto')
    expect(newNoteDesign(() => 0.3).cover.textColor).toBe('auto')
    expect(upgradeDesignToV5({ cover: { pattern: 'dots' } }).cover.textColor).toBe('auto')
  })

  it('選んだ文字色は移し替え・読み直しでそのまま。知らない値は自動', () => {
    expect(upgradeDesignToV5(design({ textColor: 'white' })).cover.textColor).toBe('white')
    expect(normalizeDesign(design({ textColor: 'black' })).cover.textColor).toBe('black')
    expect(normalizeDesign({ cover: { textColor: 'gold' } }).cover.textColor).toBe('auto')
  })
})

describe('タイトルの文字の色', () => {
  it('自動は 1.0.0 までと同じ(暗い表紙は白、明るい表紙は濃い色)', () => {
    expect(coverTitleInk('auto', 'dark')).toEqual({ color: coverTextColor('dark'), ink: 'light' })
    expect(coverTitleInk('auto', 'light')).toEqual({ color: coverTextColor('light'), ink: 'dark' })
  })

  it('白・黒は表紙の色に関係なくその色', () => {
    for (const tone of ['light', 'dark'] as const) {
      expect(coverTitleInk('white', tone)).toEqual({ color: '#ffffff', ink: 'light' })
      expect(coverTitleInk('black', tone).ink).toBe('dark')
    }
  })

  it('影:白い文字には暗い影、黒い文字には明るい影', () => {
    expect(coverTitleHalo('light')).toContain('rgb(0 0 0')
    expect(coverTitleHalo('light')).not.toContain('rgb(255 255 255')
    expect(coverTitleHalo('dark')).toContain('rgb(255 255 255')
    expect(coverTitleHalo('dark')).not.toContain('rgb(0 0 0')
  })

  it('影は、柄があるときか文字色を選んだときだけ(自動の無地の表紙は今までと同じ見た目)', () => {
    expect(coverTitleNeedsHalo('plain', 'auto')).toBe(false)
    expect(coverTitleNeedsHalo('gingham', 'auto')).toBe(true)
    expect(coverTitleNeedsHalo('plain', 'white')).toBe(true)
    expect(coverTitleNeedsHalo('plain', 'black')).toBe(true)
  })
})

describe('表紙の表示(本棚・デザインの見本・ゴミ箱で使う Cover)', () => {
  it('今までのノート(自動・無地)は、影なしで今と同じ文字色', () => {
    const { classes, style } = render(legacyDesign())
    expect(classes).toContain('cover--text-auto')
    expect(classes).not.toContain('cover--halo')
    expect(style.getPropertyValue('--cover-text')).toBe(coverTextColor('dark')) // 青磁は暗い色
    expect(style.getPropertyValue('--cover-halo')).toBe('')
  })

  it('白を選ぶと白い文字と暗い影、黒を選ぶと黒い文字と明るい影', () => {
    const white = render(design({ textColor: 'white', color: 'mustard', pattern: 'gingham', subColor: 'navy' }))
    expect(white.classes).toEqual(expect.arrayContaining(['cover--text-white', 'cover--halo']))
    expect(white.style.getPropertyValue('--cover-text')).toBe('#ffffff')
    expect(white.style.getPropertyValue('--cover-halo')).toContain('rgb(0 0 0')
    const black = render(design({ textColor: 'black', color: 'navy', pattern: 'dots' }))
    expect(black.classes).toContain('cover--text-black')
    expect(black.style.getPropertyValue('--cover-halo')).toContain('rgb(255 255 255')
  })

  it('配置のクラスも付く(ラベル・帯の色は CSS で文字色に合わせる)', () => {
    expect(render(design({ textColor: 'white', layout: 'label' })).classes).toEqual(
      expect.arrayContaining(['cover--label', 'cover--text-white']),
    )
  })
})

describe('ラベル・帯の色(cover.css)', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles/cover.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  /** セレクタに含まれる文字をすべて持つ規則の中身 */
  const rule = (...parts: string[]) =>
    [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => parts.every((p) => m[1].includes(p))).map((m) => m[2]).join('\n')

  it('白い文字のときは、帯・ラベル・背表紙のラベルを暗くする', () => {
    for (const layout of ['band', 'label', 'spine']) {
      const r = rule('.cover--text-white', `.cover--${layout} `)
      expect(r, layout).toMatch(/background: rgb\((\d+) \d+ \d+ \/ 0\.\d+\)/)
      const level = Number(/background: rgb\((\d+)/.exec(r)![1])
      expect(level, layout).toBeLessThan(80)
      expect(r).toContain('color: var(--cover-text)')
    }
  })

  it('黒い文字のときは、下の帯を明るくする', () => {
    const r = rule('.cover--text-black', '.cover--bottomBand')
    expect(r).toMatch(/background: rgb\(255 255 255 \/ 0\.\d+\)/)
    expect(r).toContain('color: var(--cover-text)')
  })

  it('影はラベル・帯の上の文字には付けない(下が無地なので)', () => {
    expect(rule('.cover--halo .cover-title')).toContain('text-shadow: var(--cover-halo)')
    for (const layout of ['band', 'label', 'spine', 'bottomBand']) {
      expect(rule('.cover--halo', `.cover--${layout}`), layout).toContain('text-shadow: none')
    }
  })
})
