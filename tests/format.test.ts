import { afterEach, describe, expect, it } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import { buildExtensions } from '../src/editor/extensions'
import { applyLine, applyMarker, applyTextColor, toggleLastLine, toggleLastMarker } from '../src/editor/format'
import { setLastUsed } from '../src/editor/lastUsed'
import { IS_MAC, matchShortcut } from '../src/editor/shortcuts'

// 文字色・マーカー・ライン・ショートカットキーのテスト

let editor: Editor | null = null
let calls: string[] = []

function makeEditor(text = 'あいうえお'): Editor {
  calls = []
  editor = new Editor({
    extensions: buildExtensions({
      undo: () => calls.push('undo'),
      redo: () => calls.push('redo'),
      closeGroup: () => calls.push('closeGroup'),
    }),
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  })
  return editor
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

/** 1行目の最初の文字の装飾 */
function marksOfFirstText(e: Editor): JSONContent['marks'] {
  return e.getJSON().content?.[0].content?.[0].marks
}

/** 全体を選ぶ */
const selectAll = (e: Editor) => e.commands.setTextSelection({ from: 1, to: e.state.doc.content.size - 1 })

/** ショートカットキーの入力を作る(Macでは⌘、それ以外はCtrl) */
function keyEvent(code: string, key: string, opts: { shift?: boolean; alt?: boolean; composing?: boolean } = {}) {
  return new KeyboardEvent('keydown', {
    code,
    key,
    ctrlKey: !IS_MAC,
    metaKey: IS_MAC,
    shiftKey: !!opts.shift,
    altKey: !!opts.alt,
    isComposing: !!opts.composing,
    bubbles: true,
    cancelable: true,
  })
}

/** エディタにキー入力を渡す(処理されたら true) */
function press(e: Editor, ev: KeyboardEvent): boolean {
  return !!e.view.someProp('handleKeyDown', (f) => f(e.view, ev))
}

describe('文字色', () => {
  it('色名で保存され、HTMLでは data-text-color になる', () => {
    const e = makeEditor()
    selectAll(e)
    applyTextColor(e, 'blue')
    expect(marksOfFirstText(e)).toEqual([{ type: 'textColor', attrs: { color: 'blue' } }])
    expect(e.getHTML()).toContain('data-text-color="blue"')
  })

  it('別の色にすると置き換わり、色なしで外れる', () => {
    const e = makeEditor()
    selectAll(e)
    applyTextColor(e, 'red')
    applyTextColor(e, 'green')
    expect(marksOfFirstText(e)).toEqual([{ type: 'textColor', attrs: { color: 'green' } }])
    applyTextColor(e, null)
    expect(marksOfFirstText(e)).toBeUndefined()
  })

  it('保存したJSONを読み込み直しても色が残る', () => {
    const e = makeEditor()
    selectAll(e)
    applyTextColor(e, 'purple')
    const json = e.getJSON()
    e.commands.setContent(json)
    expect(marksOfFirstText(e)).toEqual([{ type: 'textColor', attrs: { color: 'purple' } }])
  })

  it('知らない色名のHTMLは赤として読む(壊れたデータで落ちない)', () => {
    const e = makeEditor()
    e.commands.setContent('<p><span data-text-color="unknown">x</span></p>')
    expect(marksOfFirstText(e)).toEqual([{ type: 'textColor', attrs: { color: 'red' } }])
  })
})

describe('マーカー', () => {
  it('色を付けて、外せる', () => {
    const e = makeEditor()
    selectAll(e)
    applyMarker(e, 'pink')
    expect(marksOfFirstText(e)).toEqual([{ type: 'marker', attrs: { color: 'pink' } }])
    expect(e.getHTML()).toContain('<mark data-marker="pink"')
    applyMarker(e, null)
    expect(marksOfFirstText(e)).toBeUndefined()
  })

  it('最後に使った色で付け外しできる', () => {
    const e = makeEditor()
    selectAll(e)
    setLastUsed({ marker: 'green' })
    toggleLastMarker(e)
    expect(marksOfFirstText(e)).toEqual([{ type: 'marker', attrs: { color: 'green' } }])
    toggleLastMarker(e)
    expect(marksOfFirstText(e)).toBeUndefined()
  })
})

describe('ライン', () => {
  it.each(['solid', 'wavy', 'double', 'dotted'] as const)('線の種類 %s を保存できる', (style) => {
    const e = makeEditor()
    selectAll(e)
    applyLine(e, { style, color: 'blue' })
    expect(marksOfFirstText(e)).toEqual([{ type: 'underline', attrs: { style, color: 'blue' } }])
    expect(e.getHTML()).toContain(`data-line-style="${style}"`)
  })

  it('色なし(文字と同じ色)のときは data-line-color を出さない', () => {
    const e = makeEditor()
    selectAll(e)
    applyLine(e, { style: 'wavy', color: null })
    expect(marksOfFirstText(e)).toEqual([{ type: 'underline', attrs: { style: 'wavy', color: null } }])
    expect(e.getHTML()).not.toContain('data-line-color')
  })

  it('最後に使った線で付け外しでき、外すこともできる', () => {
    const e = makeEditor()
    selectAll(e)
    setLastUsed({ lineStyle: 'double', lineColor: 'red' })
    toggleLastLine(e)
    expect(marksOfFirstText(e)).toEqual([{ type: 'underline', attrs: { style: 'double', color: 'red' } }])
    toggleLastLine(e)
    expect(marksOfFirstText(e)).toBeUndefined()
  })

  it('文字色・マーカー・ラインは重ねてかけられる', () => {
    const e = makeEditor()
    selectAll(e)
    applyTextColor(e, 'red')
    applyMarker(e, 'yellow')
    applyLine(e, { style: 'dotted', color: 'blue' })
    const types = marksOfFirstText(e)?.map((m) => m.type).sort()
    expect(types).toEqual(['marker', 'textColor', 'underline'])
  })
})

describe('ショートカットキーの判定(日本語キーボード対応)', () => {
  it('JIS配列で Shift+7 は「\'」になるが、キーの位置で番号付きリストと判定する', () => {
    expect(matchShortcut(keyEvent('Digit7', "'", { shift: true }))).toBe('orderedList')
    expect(matchShortcut(keyEvent('Digit8', '(', { shift: true }))).toBe('bulletList')
    expect(matchShortcut(keyEvent('Digit9', ')', { shift: true }))).toBe('taskList')
  })

  it('見出し・太字・元に戻す/やり直し', () => {
    expect(matchShortcut(keyEvent('Digit1', '1', { alt: true }))).toBe('h1')
    expect(matchShortcut(keyEvent('Digit0', '0', { alt: true }))).toBe('body')
    expect(matchShortcut(keyEvent('KeyB', 'b'))).toBe('bold')
    expect(matchShortcut(keyEvent('KeyZ', 'z'))).toBe('undo')
    expect(matchShortcut(keyEvent('KeyZ', 'Z', { shift: true }))).toBe('redo')
    expect(matchShortcut(keyEvent('KeyY', 'y'))).toBe('redo')
  })

  it('日本語入力の変換中は反応しない', () => {
    expect(matchShortcut(keyEvent('KeyB', 'b', { composing: true }))).toBeNull()
  })

  it('Ctrl(Macは⌘)なしでは反応しない', () => {
    const ev = new KeyboardEvent('keydown', { code: 'KeyB', key: 'b' })
    expect(matchShortcut(ev)).toBeNull()
  })

  it('修飾キーが余分に押されていたら別物とみなす', () => {
    expect(matchShortcut(keyEvent('KeyB', 'b', { shift: true }))).toBeNull()
  })
})

describe('エディタの中でのショートカット', () => {
  it('Ctrl+Shift+7(JIS)で番号付きリストになる', () => {
    const e = makeEditor()
    e.commands.setTextSelection(2)
    expect(press(e, keyEvent('Digit7', "'", { shift: true }))).toBe(true)
    expect(e.getJSON().content?.[0].type).toBe('orderedList')
  })

  it('Ctrl+Alt+2 で中見出し、Ctrl+Alt+0 で本文に戻る', () => {
    const e = makeEditor()
    e.commands.setTextSelection(2)
    press(e, keyEvent('Digit2', '2', { alt: true }))
    expect(e.getJSON().content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } })
    press(e, keyEvent('Digit0', '0', { alt: true }))
    expect(e.getJSON().content?.[0].type).toBe('paragraph')
  })

  it('Ctrl+B で太字。前後で履歴を区切る', () => {
    const e = makeEditor()
    selectAll(e)
    press(e, keyEvent('KeyB', 'b'))
    expect(marksOfFirstText(e)).toEqual([{ type: 'bold' }])
    expect(calls).toEqual(['closeGroup', 'closeGroup'])
  })

  it('Ctrl+U で最後に使ったライン', () => {
    const e = makeEditor()
    selectAll(e)
    setLastUsed({ lineStyle: 'wavy', lineColor: null })
    press(e, keyEvent('KeyU', 'u'))
    expect(marksOfFirstText(e)).toEqual([{ type: 'underline', attrs: { style: 'wavy', color: null } }])
  })

  it('Ctrl+Z / Ctrl+Shift+Z はノートの履歴に渡す', () => {
    const e = makeEditor()
    press(e, keyEvent('KeyZ', 'z'))
    press(e, keyEvent('KeyZ', 'Z', { shift: true }))
    expect(calls).toEqual(['undo', 'redo'])
  })

  it('ページ一覧のキーはエディタでは処理しない(ノート画面に任せる)', () => {
    const e = makeEditor()
    expect(press(e, keyEvent('KeyP', 'p', { alt: true }))).toBe(false)
  })
})
