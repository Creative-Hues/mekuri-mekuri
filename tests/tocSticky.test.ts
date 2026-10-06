import { describe, expect, it } from 'vitest'
import { getSchema, type JSONContent } from '@tiptap/core'
import { buildExtensions } from '../src/editor/extensions'
import { closedTogglesAround, collectHeadings, findHeadingPos } from '../src/editor/toc'
import {
  DEFAULT_H,
  DEFAULT_W,
  MIN_H,
  MIN_W,
  clampPosition,
  clampSize,
  createSticky,
  isStickyColor,
  stickiesBottom,
} from '../src/editor/sticky'
import { IS_MAC, matchShortcut, shortcutText } from '../src/editor/shortcuts'

// 目次・付箋の位置計算・後半で足したショートカットのテスト

const schema = getSchema(buildExtensions({ undo() {}, redo() {}, closeGroup() {} }))
const txt = (t: string): JSONContent[] => (t ? [{ type: 'text', text: t }] : [])
const p = (t: string): JSONContent => ({ type: 'paragraph', content: txt(t) })
const h = (level: number, t: string): JSONContent => ({ type: 'heading', attrs: { level }, content: txt(t) })
const toggle = (level: number, title: string, open: boolean, ...body: JSONContent[]): JSONContent => ({
  type: 'toggleHeading',
  attrs: { level, open },
  content: [{ type: 'toggleTitle', content: txt(title) }, ...body],
})

describe('目次', () => {
  const json: JSONContent = {
    type: 'doc',
    content: [
      h(1, '旅行の計画'),
      p('本文'),
      toggle(2, '持ち物', false, p('a'), h(3, '服'), toggle(3, '薬', false, p('b'))),
      h(2, '  予算  '),
      h(3, ''),
    ],
  }

  it('見出しとトグル見出しを、文書の順に集める(閉じたトグルの中も)', () => {
    expect(collectHeadings(json)).toEqual([
      { level: 1, text: '旅行の計画', index: 0, toggle: false },
      { level: 2, text: '持ち物', index: 1, toggle: true },
      { level: 3, text: '服', index: 2, toggle: false },
      { level: 3, text: '薬', index: 3, toggle: true },
      { level: 2, text: '予算', index: 4, toggle: false },
      { level: 3, text: '', index: 5, toggle: false },
    ])
  })

  it('目次の番号で、エディタの文書の中の同じ見出しが見つかる', () => {
    const doc = schema.nodeFromJSON(json)
    const items = collectHeadings(json)
    for (const item of items) {
      const pos = findHeadingPos(doc, item.index)
      expect(pos).not.toBeNull()
      const node = doc.nodeAt(pos!)!
      const text = node.type.name === 'toggleHeading' ? node.firstChild!.textContent : node.textContent
      expect(text.trim()).toBe(item.text)
    }
    expect(findHeadingPos(doc, items.length)).toBeNull()
  })

  it('閉じたトグル見出しの中の見出しへ移動するときは、外側の閉じたトグルを開く', () => {
    const doc = schema.nodeFromJSON(json)
    const medicine = findHeadingPos(doc, 3)! // 「薬」(閉じたトグルの中の閉じたトグル)
    const toOpen = closedTogglesAround(doc, medicine)
    expect(toOpen).toEqual([findHeadingPos(doc, 1)]) // 「持ち物」だけ(「薬」自体の見出しは閉じていても見える)
  })

  it('見出しのないページは空', () => {
    expect(collectHeadings({ type: 'doc', content: [p('a')] })).toEqual([])
  })
})

describe('付箋の位置と大きさ', () => {
  it('新しい付箋は、指定した高さを中心に、横は真ん中に置く', () => {
    const s = createSticky('pink', 1, 100)
    expect(s.color).toBe('pink')
    expect(s.w).toBe(DEFAULT_W)
    expect(s.h).toBe(DEFAULT_H)
    expect(s.x).toBeCloseTo((1 - DEFAULT_W) / 2)
    expect(s.y).toBeCloseTo(1 - DEFAULT_H / 2)
    expect(s.content).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(s.createdAt).toBe(100)
  })

  it('ページの上端より上には置かない', () => {
    expect(createSticky('yellow', 0).y).toBe(0)
  })

  it('位置は紙の左右からはみ出さない(下へは伸ばせる)', () => {
    expect(clampPosition({ w: 0.4 }, -0.2, -1)).toEqual({ x: 0, y: 0 })
    expect(clampPosition({ w: 0.4 }, 0.9, 3)).toEqual({ x: 0.6, y: 3 })
  })

  it('大きさは最小・最大の範囲に収まり、右は紙の端まで', () => {
    expect(clampSize({ x: 0.5 }, 0.01, 0.01)).toEqual({ w: MIN_W, h: MIN_H })
    expect(clampSize({ x: 0.5 }, 0.9, 0.4)).toEqual({ w: 0.5, h: 0.4 })
  })

  it('いちばん下の付箋の下端', () => {
    expect(stickiesBottom([])).toBe(0)
    expect(stickiesBottom([createSticky('yellow', 0.5), { ...createSticky('blue', 0), y: 2, h: 0.3 }])).toBeCloseTo(2.3)
  })

  it('付箋の色名の確認', () => {
    expect(isStickyColor('yellow')).toBe(true)
    expect(isStickyColor('black')).toBe(false)
  })

  it('付箋ごとに違う id が付く', () => {
    expect(createSticky('yellow', 0).id).not.toBe(createSticky('yellow', 0).id)
  })
})

describe('後半で足したショートカット', () => {
  const key = (code: string, opts: { mod?: boolean; alt?: boolean; shift?: boolean } = {}) =>
    new KeyboardEvent('keydown', {
      code,
      ctrlKey: !!opts.mod && !IS_MAC,
      metaKey: !!opts.mod && IS_MAC,
      altKey: !!opts.alt,
      shiftKey: !!opts.shift,
    })

  it('行の移動は Alt+↑ / Alt+↓(Ctrl なし)', () => {
    expect(matchShortcut(key('ArrowUp', { alt: true }))).toBe('moveUp')
    expect(matchShortcut(key('ArrowDown', { alt: true }))).toBe('moveDown')
    // Ctrl も押していたら別物
    expect(matchShortcut(key('ArrowUp', { alt: true, mod: true }))).toBeNull()
    // Alt なしの矢印はふつうのカーソル移動
    expect(matchShortcut(key('ArrowUp'))).toBeNull()
  })

  it('付箋を追加・目次', () => {
    expect(matchShortcut(key('KeyN', { mod: true, alt: true }))).toBe('addSticky')
    expect(matchShortcut(key('KeyT', { mod: true, alt: true }))).toBe('toc')
    // Alt だけでは反応しない(Ctrl/⌘ が必要)
    expect(matchShortcut(key('KeyN', { alt: true }))).toBeNull()
  })

  it('表示用の文字', () => {
    expect(shortcutText('moveUp')).toBe(IS_MAC ? 'Option+↑' : 'Alt+↑')
    expect(shortcutText('toc')).toBe(IS_MAC ? '⌘+Option+T' : 'Ctrl+Alt+T')
  })
})
