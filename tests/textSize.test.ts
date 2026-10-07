import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  TEXT_SIZES,
  TEXT_SIZE_KEY,
  changeTextSize,
  loadTextSize,
  setTextSize,
  stepTextSize,
} from '../src/theme/textSize'
import { IS_MAC, SHORTCUTS, matchShortcut, shortcutText } from '../src/editor/shortcuts'

// 文字サイズ(端末ごとの設定)と、そのショートカット

beforeEach(() => {
  localStorage.clear()
  setTextSize('m')
})

describe('文字サイズの段階', () => {
  it('5段階:小・標準・大・より大・特大。標準が100%で、順に大きくなる', () => {
    expect(TEXT_SIZES.map((s) => s.label)).toEqual(['小', '標準', '大', 'より大', '特大'])
    expect(TEXT_SIZES.find((s) => s.name === 'm')!.zoom).toBe(1)
    const zooms = TEXT_SIZES.map((s) => s.zoom)
    expect([...zooms].sort((a, b) => a - b)).toEqual(zooms)
  })

  it('1段ずつ上げ下げでき、端ではそれ以上変わらない', () => {
    expect(stepTextSize('m', 1)).toBe('l')
    expect(stepTextSize('m', -1)).toBe('xs')
    expect(stepTextSize('xxl', 1)).toBe('xxl')
    expect(stepTextSize('xs', -1)).toBe('xs')
  })
})

describe('文字サイズの保存', () => {
  it('この端末(localStorage)に保存し、次の起動でも同じ大きさ', () => {
    setTextSize('xl')
    expect(localStorage.getItem(TEXT_SIZE_KEY)).toBe('xl')
    expect(loadTextSize()).toBe('xl')
  })

  it('保存がない・知らない値のときは標準', () => {
    expect(loadTextSize()).toBe('m')
    localStorage.setItem(TEXT_SIZE_KEY, 'huge')
    expect(loadTextSize()).toBe('m')
  })

  it('画面に倍率(--text-zoom)を設定する', () => {
    setTextSize('l')
    expect(document.documentElement.style.getPropertyValue('--text-zoom')).toBe('1.15')
    expect(document.documentElement.dataset.textSize).toBe('l')
    changeTextSize(1)
    expect(document.documentElement.style.getPropertyValue('--text-zoom')).toBe('1.3')
    expect(loadTextSize()).toBe('xl')
  })

  it('index.html の起動前の処理も同じ倍率を使う', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8')
    const m = /var z = (\{[^}]*\})/.exec(html)
    expect(m).toBeTruthy()
    const map = Function(`return ${m![1]}`)() as Record<string, number>
    expect(map).toEqual(Object.fromEntries(TEXT_SIZES.map((s) => [s.name, s.zoom])))
    expect(html).toContain(`localStorage.getItem('${TEXT_SIZE_KEY}')`)
  })
})

/** Ctrl(Macは⌘)を押しながらのキー入力 */
const key = (code: string, shift = false) =>
  new KeyboardEvent('keydown', { code, ctrlKey: !IS_MAC, metaKey: IS_MAC, shiftKey: shift })

describe('文字サイズのショートカット', () => {
  it('大きく:JIS 配列の「;+」キー・US 配列の「=+」キー・テンキーの +(Shift はあってもなくても)', () => {
    for (const code of ['Semicolon', 'Equal', 'NumpadAdd']) {
      expect(matchShortcut(key(code)), code).toBe('textBigger')
      expect(matchShortcut(key(code, true)), `Shift+${code}`).toBe('textBigger')
    }
  })

  it('小さく:「-」キー・テンキーの -', () => {
    expect(matchShortcut(key('Minus'))).toBe('textSmaller')
    expect(matchShortcut(key('NumpadSubtract'))).toBe('textSmaller')
  })

  it('Ctrl(⌘)なしでは反応しない(文字の入力をじゃましない)', () => {
    expect(matchShortcut(new KeyboardEvent('keydown', { code: 'Minus' }))).toBeNull()
    expect(matchShortcut(new KeyboardEvent('keydown', { code: 'Semicolon', shiftKey: true }))).toBeNull()
  })

  it('一覧には「+」「-」で1つずつ表示する(配列ごとの別のキーは出さない)', () => {
    const mod = IS_MAC ? '⌘' : 'Ctrl'
    expect(shortcutText('textBigger')).toBe(`${mod}++`)
    expect(shortcutText('textSmaller')).toBe(`${mod}+-`)
    expect(SHORTCUTS.find((s) => s.id === 'textBigger')!.combos).toHaveLength(1)
  })
})
