import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/editor/extensions'
import { NoteSession } from '../src/screens/note/session'
import { BlockHandles } from '../src/screens/note/BlockHandles'
import { blockAtPoint } from '../src/screens/note/BlockDrag'

// 行のハンドルの表示(PC:マウスを乗せた行に出す)のテスト。
// 不具合:マウスを乗せた行とは別の行にハンドルが出ることがあった
// (行の位置の番号で覚えていたので、行の移動やスクロールのあとにずれていた)。
//
// jsdom には画面のレイアウトがないので、次のように見せかける:
// - 本文の行は、上から 30px ずつ並ぶ(1行目が 0〜30px、2行目が 30〜60px…)
// - 紙のスクロール量 scrollY の分だけ、行は上にずれて見える

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// jsdom には ResizeObserver がないので、何もしないものを置く
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const ROW = 30
let scrollY = 0
let editor: Editor
let session: NoteSession
let root: Root
let host: HTMLDivElement

const rect = (top: number, height: number) =>
  ({ top, bottom: top + height, left: 0, right: 300, width: 300, height, x: 0, y: top, toJSON() {} }) as DOMRect

beforeEach(() => {
  scrollY = 0
  // 本文の行(エディタの直下の要素)と、エディタ・ページの中身の枠の位置
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const parent = this.parentElement
    if (parent?.classList.contains('ProseMirror')) {
      const index = [...parent.children].indexOf(this)
      return rect(index * ROW - scrollY, ROW)
    }
    if (this.classList.contains('ProseMirror')) return rect(-scrollY, parent ? this.children.length * ROW : 0)
    if (this.classList.contains('page-content')) return rect(-scrollY, 1000)
    return rect(0, 0)
  })
})

afterEach(() => {
  act(() => root?.unmount())
  editor?.destroy()
  host?.remove()
  vi.restoreAllMocks()
})

const para = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })

/** 画面上の高さ y にある行の、文書の中の位置(posAtCoords の見せかけ) */
function mockPosAtCoords() {
  vi.spyOn(editor.view, 'posAtCoords').mockImplementation(({ top }) => {
    const index = Math.floor((top + scrollY) / ROW)
    const doc = editor.state.doc
    if (index < 0 || index >= doc.childCount) return null
    let pos = 0
    for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize
    return { pos: pos + 1, inside: pos }
  })
}

async function mount(lines: string[]) {
  session = new NoteSession('n', {
    showPage() {},
    removePage: async () => null,
    restorePage: async () => {},
    rename: async () => {},
    reorderPages: async () => {},
  })
  editor = new Editor({
    extensions: buildExtensions({ undo() {}, redo() {}, closeGroup() {} }),
    content: { type: 'doc', content: lines.map(para) },
  })
  mockPosAtCoords()
  session.register('p1', editor)

  host = document.createElement('div')
  document.body.append(host)
  function Harness() {
    const ref = useRef<HTMLDivElement>(null)
    return createElement(
      'div',
      { className: 'paper-scroll' },
      createElement(
        'div',
        { className: 'page-content', ref },
        createElement(BlockHandles, { session, pageId: 'p1', containerRef: ref, hoverMode: true }),
      ),
    )
  }
  root = createRoot(host)
  await act(async () => root.render(createElement(Harness)))
  // 枠ができたあとに描き直す(実際の画面では ResizeObserver が行う)
  await act(async () => session.emit())
}

const content = () => host.querySelector('.page-content')!
const handleTop = () => (host.querySelector('.block-handle') as HTMLElement | null)?.style.top ?? null

/** マウスを画面上の高さ y に動かす */
async function hover(y: number) {
  await act(async () => {
    content().dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: y, bubbles: true }))
  })
}

describe('マウスを乗せた行にハンドルを出す(PC)', () => {
  it('マウスを乗せた行の左にハンドルが出る', async () => {
    await mount(['AAAA', 'B', 'C', 'D'])
    await hover(45) // 2行目(B)の上
    expect(handleTop()).toBe(`${ROW}px`)
    await hover(100) // 4行目(D)の上
    expect(handleTop()).toBe(`${3 * ROW}px`)
  })

  it('行を移動したあとも、マウスの下の行にハンドルが出る(別の行に出ない)', async () => {
    await mount(['AAAA', 'B', 'C', 'D'])
    await hover(45) // 2行目(B)の上
    expect(handleTop()).toBe(`${ROW}px`)

    // 1行目(AAAA)を末尾へ移動 → 行は B, C, D, AAAA の順になり、マウスの下は C
    await act(async () => {
      await session.moveBlocks([{ pageId: 'p1', positions: [0] }], {
        pageId: 'p1',
        pos: editor.state.doc.content.size,
      })
    })
    expect(editor.state.doc.child(1).textContent).toBe('C')
    // 以前は、覚えていた位置の番号がずれて、4行目(D)の所にハンドルが出ていた
    expect(handleTop()).toBe(`${ROW}px`)
  })

  it('マウスを動かさずに紙をスクロールしたら、マウスの下に来た行にハンドルが移る', async () => {
    await mount(['A', 'B', 'C', 'D'])
    await hover(45) // 2行目(B)の上
    expect(handleTop()).toBe(`${ROW}px`)

    // 1行分スクロール → マウスの下は3行目(C)
    scrollY = ROW
    await act(async () => {
      host.querySelector('.paper-scroll')!.dispatchEvent(new Event('scroll'))
    })
    // ハンドルの位置はページの中身の左上からなので、3行目は 60px
    expect(handleTop()).toBe(`${2 * ROW}px`)
  })

  it('マウスが紙から出たら、ハンドルを消す', async () => {
    await mount(['A', 'B'])
    await hover(5)
    expect(handleTop()).toBe('0px')
    await act(async () => {
      content().dispatchEvent(new MouseEvent('mouseleave'))
    })
    expect(handleTop()).toBeNull()
  })
})

describe('画面上の位置にある行を探す(blockAtPoint)', () => {
  it('リストの項目の境目を指していても、指している要素(inside)の行を選ぶ', async () => {
    editor = new Editor({
      extensions: buildExtensions({ undo() {}, redo() {}, closeGroup() {} }),
      content: {
        type: 'doc',
        content: [
          { type: 'bulletList', content: [{ type: 'listItem', content: [para('A')] }, { type: 'listItem', content: [para('B')] }] },
        ],
      },
    })
    const list = editor.state.doc.child(0)
    const itemA = 1
    const itemB = itemA + list.child(0).nodeSize
    // 文字の位置としては項目 B の直前(境目)だが、指している要素は項目 A
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: itemB, inside: itemA })
    expect(blockAtPoint(editor, 10, 10)?.pos).toBe(itemA)
  })
})
