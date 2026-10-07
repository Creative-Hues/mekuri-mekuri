import { afterEach, describe, expect, it, vi } from 'vitest'

// jsdom には matchMedia がないので、画面の大きさを調べる部品(useLayoutMode)を読み込む前に置く
vi.hoisted(() => {
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia
})

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SHELF_BOOK_BUTTONS, SHELF_HEADER_BUTTONS } from '../src/screens/shelfButtons'
import { ShelfHelp } from '../src/screens/ShelfHelp'
import { onboardingSlides } from '../src/screens/Onboarding'
import { forDevice, type ButtonDef } from '../src/help/buttons'
import * as onboarding from '../src/onboarding/onboarding'

// 本棚のヘルプ・最初の使い方説明・設定の折りたたみ(端末に合わせた内容か)

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
const headerIds = Object.keys(SHELF_HEADER_BUTTONS)
const bookIds = Object.keys(SHELF_BOOK_BUTTONS)

let root: Root
let host: HTMLDivElement
function mount(el: ReturnType<typeof createElement>) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(el))
}
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  vi.restoreAllMocks()
})

describe('本棚のボタンの一覧と画面のボタン', () => {
  it('一覧と同じボタンが、同じ順で画面に置かれている(更新漏れがない)', () => {
    const code = source('src/screens/Bookshelf.tsx')
    const ids = [...code.matchAll(/btn="(\w+)"|shelfButtonAttrs\('(\w+)'\)/g)].map((m) => m[1] ?? m[2])
    expect(ids).toEqual([...headerIds, ...bookIds])
  })

  it('本棚の上のボタンは ShelfHeaderButton だけで作る(一覧を通さないボタンを置かない)', () => {
    const code = source('src/screens/Bookshelf.tsx')
    const actions = /<div className="shelf-actions">([\s\S]*?)<\/div>/.exec(code)?.[1] ?? ''
    expect(actions).toContain('<ShelfHeaderButton')
    expect(actions).not.toMatch(/<button|<a /)
  })

  it('依頼にあるボタン(新しいノート・お気に入り・並び替え・ゴミ箱・検索・設定・ヘルプ)がそろっている', () => {
    const names = [...Object.values(SHELF_HEADER_BUTTONS), ...Object.values(SHELF_BOOK_BUTTONS)].map((d) => d.name)
    for (const n of ['新しいノート', 'お気に入り', '並び替え', 'ゴミ箱', '全ノート検索', '設定', 'ヘルプ']) {
      expect(names).toContain(n)
    }
  })

  it('説明に、端末で見た目の変わる記号(☆ など)を使わない', () => {
    const all: ButtonDef[] = [...Object.values(SHELF_HEADER_BUTTONS), ...Object.values(SHELF_BOOK_BUTTONS)]
    for (const d of all) for (const m of [true, false]) expect(forDevice(d.description, m)).not.toMatch(/[☆★]/)
  })
})

describe('本棚のヘルプ', () => {
  const help = (mouse: boolean) => mount(createElement(ShelfHelp, { side: mouse, mouse, onClose: () => {} }))

  it('本棚のボタンをすべて、同じ順で出す', () => {
    help(true)
    const shown = [...host.querySelectorAll('[data-help-id]')].map((li) => li.getAttribute('data-help-id'))
    expect(shown).toEqual([...headerIds, ...bookIds])
  })

  it('「使い方を見る」から最初の使い方説明を開ける', () => {
    const open = vi.spyOn(onboarding, 'openOnboarding').mockImplementation(() => {})
    const onClose = vi.fn()
    mount(createElement(ShelfHelp, { side: true, mouse: true, onClose }))
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('使い方を見る'))!
    act(() => button.click())
    expect(open).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('PC:マウスの操作とショートカットを出す', () => {
    help(true)
    const text = host.textContent ?? ''
    expect(text).toContain('クリック')
    expect(text).toContain('ドラッグ')
    expect(host.querySelector('kbd')).toBeTruthy()
  })

  it('スマホ:指での操作だけを出す(マウス・ショートカットの説明は出さない)', () => {
    help(false)
    const text = host.textContent ?? ''
    expect(text).toContain('押したまま動かします')
    expect(text).toContain('長押し')
    for (const t of ['マウス', 'クリック', 'ドラッグ', 'ショートカット', 'Ctrl', '⌘']) expect(text, t).not.toContain(t)
    expect(host.querySelector('kbd')).toBeNull()
  })
})

describe('最初の使い方説明のカード', () => {
  const text = (mouse: boolean) =>
    onboardingSlides(mouse)
      .map((s) => s.title + renderToStaticMarkup(createElement('div', null, s.body)))
      .join('\n')

  it('スマホ:スワイプ・押したまま動かす・長押しの説明。ショートカット・マウスは出さない', () => {
    const t = text(false)
    for (const w of ['スワイプ', '押したまま動かして', '長押し', 'カーソルのある行']) expect(t, w).toContain(w)
    for (const w of ['マウス', 'ショートカット', 'ドラッグ', '← →']) expect(t, w).not.toContain(w)
  })

  it('PC:矢印キー・ドラッグ・マウス・ショートカットの説明。スワイプは出さない', () => {
    const t = text(true)
    for (const w of ['← →', 'ドラッグ', 'マウスを乗せる', 'ショートカットキー']) expect(t, w).toContain(w)
    expect(t).not.toContain('スワイプ')
  })

  it('どちらもカードの枚数は同じ', () => {
    expect(onboardingSlides(true)).toHaveLength(onboardingSlides(false).length)
  })
})

describe('設定のショートカットキーの一覧', () => {
  it('折りたたみ式で、PC(マウス)では開いた状態・スマホでは閉じた状態から始める', () => {
    const code = source('src/screens/Settings.tsx')
    expect(code).toMatch(/const mouse = useLayoutMode\(\)\.toolbarTop/)
    expect(code).toMatch(/useState\(mouse\)/)
    expect(code).toMatch(/aria-expanded=\{shortcutsOpen\}/)
    expect(code).toMatch(/\{shortcutsOpen && \(/)
  })
})
