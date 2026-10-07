import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import { buildExtensions, buildStickyExtensions, type EditorHooks } from '../src/editor/extensions'
import { canInsertImageAt, pickImageFiles, type TransferLike } from '../src/editor/imagePaste'
import { insertImageFiles } from '../src/editor/image'

// ほかのアプリからの画像の貼り付け・ドラッグ&ドロップ

// 画像の縮小は jsdom では動かない(canvas がない)ので、決まった大きさを返す偽物にする
vi.mock('../src/images/resize', () => ({
  resizeImage: vi.fn(async (file: File) => {
    if (file.name.startsWith('broken')) throw new Error('読めない画像')
    return { data: new ArrayBuffer(4), mime: 'image/png', width: 100, height: 50 }
  }),
}))

const png = (name = 'shot.png') => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })
const pdf = () => new File([new Uint8Array([1])], 'a.pdf', { type: 'application/pdf' })
function transfer(files: File[], data: Record<string, string> = {}): TransferLike {
  return { files, getData: (f) => data[f] ?? '' }
}

describe('貼り付け・ドロップの中身の判定(pickImageFiles)', () => {
  it('画像だけ(スクリーンショットなど)なら、その画像を使う', () => {
    const f = png()
    expect(pickImageFiles(transfer([f]), 'paste')).toEqual([f])
  })
  it('文字も入っているとき(Word・Excel のコピー)は、文字の貼り付けを優先する', () => {
    expect(pickImageFiles(transfer([png()], { 'text/plain': '表の中身' }), 'paste')).toEqual([])
    expect(pickImageFiles(transfer([png()], { 'text/html': '<p>文章</p><img src="x.png">' }), 'paste')).toEqual([])
  })
  it('ブラウザの「画像をコピー」(HTML が画像だけ)なら、画像を使う', () => {
    const f = png()
    expect(pickImageFiles(transfer([f], { 'text/html': '<meta charset="utf-8"><img src="https://example.com/a.png">' }), 'paste')).toEqual([f])
  })
  it('画像以外のファイルは使わない', () => {
    expect(pickImageFiles(transfer([pdf()]), 'paste')).toEqual([])
    const f = png()
    expect(pickImageFiles(transfer([pdf(), f]), 'drop')).toEqual([f])
  })
  it('ドロップは文字があっても画像を使う(複数枚も)', () => {
    const a = png('a.png')
    const b = png('b.png')
    expect(pickImageFiles(transfer([a, b], { 'text/plain': 'a.png' }), 'drop')).toEqual([a, b])
  })
  it('中身がないときは空', () => {
    expect(pickImageFiles(null, 'paste')).toEqual([])
  })
})

let editors: Editor[] = []
afterEach(() => {
  editors.forEach((e) => e.destroy())
  editors = []
})

const para = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const cell = (text: string): JSONContent => ({
  type: 'tableCell',
  attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null, bg: null },
  content: [para(text)],
})
const tableDoc: JSONContent = {
  type: 'doc',
  content: [para('前'), { type: 'table', content: [{ type: 'tableRow', content: [cell('A'), cell('B')] }] }, para('後')],
}

function makeEditor(onImageFiles?: EditorHooks['onImageFiles'], content: JSONContent = { type: 'doc', content: [para('こんにちは')] }) {
  const hooks: EditorHooks = { undo: () => {}, redo: () => {}, closeGroup: () => {}, onImageFiles }
  const e = new Editor({ extensions: buildExtensions(hooks), content })
  editors.push(e)
  return e
}

/** 貼り付けを、エディタのプラグインに渡す */
function paste(editor: Editor, data: TransferLike): boolean {
  const event = { clipboardData: data, preventDefault: () => {} } as unknown as ClipboardEvent
  return !!editor.view.someProp('handlePaste', (f) => f(editor.view, event, editor.state.doc.slice(0, 0)))
}

describe('エディタでの貼り付け', () => {
  it('本文のエディタでは、画像ファイルをノート画面へ渡す', () => {
    const got = vi.fn()
    const e = makeEditor(got)
    const f = png()
    expect(paste(e, transfer([f]))).toBe(true)
    expect(got).toHaveBeenCalledWith([f], null)
  })
  it('文字の貼り付けは、今までどおりエディタに任せる', () => {
    const got = vi.fn()
    const e = makeEditor(got)
    expect(paste(e, transfer([png()], { 'text/plain': '文字' }))).toBe(false)
    expect(got).not.toHaveBeenCalled()
  })
  it('付箋のエディタには画像を入れない(何もしない)', () => {
    const e = new Editor({
      extensions: buildStickyExtensions({ undo: () => {}, redo: () => {}, closeGroup: () => {} }),
      content: { type: 'doc', content: [para('付箋')] },
    })
    editors.push(e)
    expect(paste(e, transfer([png()]))).toBe(false)
  })
})

describe('画像を入れる位置', () => {
  it('表の中には入れられない', () => {
    const e = makeEditor(undefined, tableDoc)
    // 「前」の段落の中
    expect(canInsertImageAt(e.state, 1)).toBe(true)
    // 表の中(セル「A」の文字)
    let inCell = -1
    e.state.doc.descendants((n, pos) => {
      if (n.isText && n.text === 'A') inCell = pos
    })
    expect(canInsertImageAt(e.state, inCell)).toBe(false)
  })
})

describe('画像を縮小・保存して入れる(insertImageFiles)', () => {
  const ui = () => ({ closeGroup: vi.fn(), alert: vi.fn(async () => {}) })
  const images = (e: Editor) => {
    const found: JSONContent[] = []
    e.state.doc.descendants((n) => {
      if (n.type.name === 'image') found.push(n.toJSON())
    })
    return found
  }

  it('複数の画像を、まとめて1回の変更で入れる', async () => {
    const e = makeEditor()
    let changes = 0
    e.on('update', () => changes++)
    const u = ui()
    await insertImageFiles(e, [png('a.png'), png('b.png')], u)
    expect(images(e)).toHaveLength(2)
    expect(images(e)[0].attrs).toMatchObject({ width: 100, height: 50 })
    expect(changes).toBe(1)
    // 前後の入力と分けて、「元に戻す」1回で戻せるようにする
    expect(u.closeGroup).toHaveBeenCalledTimes(2)
    expect(u.alert).not.toHaveBeenCalled()
  })

  it('ドロップした位置に入れる', async () => {
    const e = makeEditor(undefined, { type: 'doc', content: [para('一'), para('二'), para('三')] })
    // 「二」の段落の終わり
    const pos = 1 + 3 + 2
    await insertImageFiles(e, [png()], ui(), pos)
    const kinds: string[] = []
    e.state.doc.forEach((n) => kinds.push(n.type.name === 'image' ? 'image' : n.textContent))
    expect(kinds.indexOf('image')).toBe(kinds.indexOf('二') + 1)
  })

  it('読めない画像があれば、入れられた分だけ入れて知らせる', async () => {
    const e = makeEditor()
    const u = ui()
    await insertImageFiles(e, [png('a.png'), png('broken.png')], u)
    expect(images(e)).toHaveLength(1)
    expect(u.alert).toHaveBeenCalledWith('1枚の画像を入れられませんでした。別の画像で試してください。')
  })

  it('表の中では入れずに知らせる', async () => {
    const e = makeEditor(undefined, tableDoc)
    let inCell = -1
    e.state.doc.descendants((n, pos) => {
      if (n.isText && n.text === 'A') inCell = pos
    })
    const u = ui()
    await insertImageFiles(e, [png()], u, inCell)
    expect(images(e)).toHaveLength(0)
    expect(u.alert).toHaveBeenCalledWith('表の中には画像を入れられません。表の外に入れてください。')
  })
})
