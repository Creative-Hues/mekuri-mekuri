import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HEADER_BUTTONS, TOOLBAR_GROUPS, toolbarButton } from '../src/screens/note/noteButtons'
import { buttonLabel, forDevice, tipProps, type ButtonDef } from '../src/help/buttons'
import { NoteHelp } from '../src/screens/note/NoteHelp'
import { ButtonTips } from '../src/help/ButtonTips'
import { IS_MAC, SHORTCUTS } from '../src/editor/shortcuts'

// ノート画面のボタンの一覧(ヘルプ・ボタンの名前と、画面のボタンが同じ情報から作られているか)

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
/** ソースの中の btn="…" を、出てくる順に */
const btnIds = (code: string) => [...code.matchAll(/btn="(\w+)"/g)].map((m) => m[1])

const toolbarIds = TOOLBAR_GROUPS.flatMap((g) => Object.keys(g.buttons))
const headerIds = Object.keys(HEADER_BUTTONS)
const allDefs: [string, ButtonDef][] = [
  ...Object.entries(HEADER_BUTTONS),
  ...TOOLBAR_GROUPS.flatMap((g) => Object.entries(g.buttons as Record<string, ButtonDef>)),
]

describe('ボタンの一覧と画面のボタン', () => {
  it('ツールバーのボタンは、一覧と同じものが同じ順で画面に置かれている(更新漏れがない)', () => {
    expect(btnIds(source('src/screens/note/Toolbar.tsx'))).toEqual(toolbarIds)
  })

  it('ヘッダーのボタンも、一覧と同じものが同じ順で画面に置かれている', () => {
    const view = source('src/screens/note/NoteView.tsx')
    const header = /<header className="note-header">([\s\S]*?)<\/header>/.exec(view)?.[1] ?? ''
    expect(btnIds(header)).toEqual(headerIds)
    // ヘッダーのボタンは HeaderButton だけで作る(一覧を通さないボタンを置かない)
    expect(header).not.toMatch(/<button|className="icon-btn"/)
  })

  it('ツールバーのボタンは TBtn だけで作る(一覧を通さないボタンを置かない)', () => {
    const toolbar = source('src/screens/note/Toolbar.tsx')
    const row = /<div className="toolbar-row">([\s\S]*?)\n {6}<\/div>\n/.exec(toolbar)?.[1] ?? ''
    expect(row).toContain('<TBtn')
    expect(row).not.toMatch(/<button/)
  })

  it('どのボタンにも名前・説明があり、id が重ならない', () => {
    const ids = allDefs.map(([id]) => id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const [id, def] of allDefs) {
      expect(def.name, id).toBeTruthy()
      for (const mouse of [true, false]) expect(forDevice(def.description, mouse).length, id).toBeGreaterThan(5)
    }
  })

  it('ショートカットは、ショートカットの一覧にあるもの', () => {
    const known = new Set(SHORTCUTS.map((s) => s.id))
    for (const [id, def] of allDefs) if (def.shortcut) expect(known.has(def.shortcut), id).toBe(true)
  })

  it('読み上げ用の名前・マウスを乗せたときの名前', () => {
    const mod = IS_MAC ? '⌘' : 'Ctrl'
    expect(buttonLabel(toolbarButton('bold'))).toBe(`太字(${mod}+B)`)
    expect(buttonLabel(toolbarButton('insert'))).toBe('挿入')
    expect(buttonLabel(toolbarButton('marker'))).toBe(`マーカー(最後に使った色を付け外し:${mod}+Shift+H)`)
    expect(tipProps(toolbarButton('bold'))).toEqual({
      'aria-label': `太字(${mod}+B)`,
      'data-tip': '太字',
      'data-tip-key': `${mod}+B`,
    })
    expect(tipProps(toolbarButton('insert'))['data-tip-key']).toBeUndefined()
  })
})

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
  vi.useRealTimers()
})

describe('ヘルプ', () => {
  const help = (mouse: boolean) => mount(createElement(NoteHelp, { side: mouse, mouse, onClose: () => {} }))
  const shownIds = () => [...host.querySelectorAll('[data-help-id]')].map((li) => li.getAttribute('data-help-id'))

  it('PC:一覧のボタンを同じ順で出す(スマホだけのボタンは出さない)', () => {
    help(true)
    expect(shownIds()).toEqual([...headerIds, ...toolbarIds.filter((id) => id !== 'keyboardHide')])
    // ツールバーはグループごとの見出しつき
    const groups = [...host.querySelectorAll('.help-group')].map((h) => h.textContent)
    expect(groups).toEqual(TOOLBAR_GROUPS.map((g) => g.title).filter((t) => t !== 'キーボード'))
  })

  it('スマホ:一覧のボタンをすべて同じ順で出す(キーボードを閉じるも)', () => {
    help(false)
    expect(shownIds()).toEqual([...headerIds, ...toolbarIds])
  })

  it('PC:マウスの操作とショートカットキーを出し、指での操作は出さない', () => {
    help(true)
    const bold = host.querySelector('[data-help-id="bold"]')!
    expect(bold.querySelector('kbd')?.textContent).toBe(IS_MAC ? '⌘+B' : 'Ctrl+B')
    const text = host.textContent ?? ''
    expect(text).toContain('マウスを乗せる')
    expect(text).toContain('マウスを乗せた行の左に ≡')
    expect(text).toContain('右クリック')
    expect(text).not.toContain('スワイプ')
    expect(text).not.toContain('長押しすると、ボタンの名前')
    expect(host.querySelector('[data-device="mouse"]')).toBeTruthy()
  })

  it('スマホ:指での操作を出し、ショートカットキー・マウスの説明は出さない', () => {
    help(false)
    expect(host.querySelector('kbd')).toBeNull()
    const text = host.textContent ?? ''
    for (const t of ['スワイプ', 'カーソルを置くと', '≡ を長押し', 'ボタンを長押しすると', 'キーボードを閉じる', 'つまみを押すと', '丸いつまみ']) {
      expect(text, t).toContain(t)
    }
    for (const t of ['マウス', 'クリック', 'ショートカット', 'Ctrl', '⌘']) expect(text, t).not.toContain(t)
    // セルの長押しのメニューはなくした(1.3.0)
    expect(text).not.toContain('セルを長押し')
    expect(host.querySelector('.toc--sheet')).toBeTruthy()
  })
})


describe('ボタンの名前(長押し・マウス)', () => {
  let clicks: string[]

  beforeEach(() => {
    vi.useFakeTimers()
    clicks = []
    // ノート画面の見せかけ:名前の出るボタンと、行のハンドル(名前は出さない)
    host = document.createElement('div')
    host.className = 'note-view'
    host.innerHTML = `
      <button id="bold" data-tip="太字" data-tip-key="Ctrl+B">B</button>
      <button id="handle" class="drag-handle">≡</button>`
    document.body.appendChild(host)
    host.querySelector('#bold')!.addEventListener('click', () => clicks.push('bold'))
    host.querySelector('#handle')!.addEventListener('click', () => clicks.push('handle'))
    const tipHost = document.createElement('div')
    host.appendChild(tipHost)
    root = createRoot(tipHost)
    act(() => root.render(createElement(ButtonTips, { scope: '.note-view' })))
  })

  const pointer = (type: string, el: Element, pointerType: string, x = 10, y = 10) =>
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType, clientX: x, clientY: y }))
  const tipText = () => document.querySelector('.button-tip')?.textContent ?? null

  it('スマホ:長押しで名前を出し、指を離してもボタンは押されない', () => {
    const bold = host.querySelector('#bold')!
    act(() => {
      pointer('pointerdown', bold, 'touch')
      vi.advanceTimersByTime(500)
    })
    expect(tipText()).toBe('太字') // スマホではショートカットは出さない
    act(() => {
      pointer('pointerup', bold, 'touch')
      ;(bold as HTMLElement).click()
    })
    expect(clicks).toEqual([])
    // しばらくすると消える
    act(() => vi.advanceTimersByTime(1600))
    expect(tipText()).toBeNull()
    // 次に普通に押したときは押せる
    act(() => {
      pointer('pointerdown', bold, 'touch')
      pointer('pointerup', bold, 'touch')
      ;(bold as HTMLElement).click()
    })
    expect(clicks).toEqual(['bold'])
  })

  it('スマホ:長押しのあとにクリックが来ない端末でも、すぐ次に押したボタンは押せる', () => {
    const bold = host.querySelector('#bold')!
    act(() => {
      pointer('pointerdown', bold, 'touch')
      vi.advanceTimersByTime(600)
      pointer('pointerup', bold, 'touch') // ここでクリックが来ない
      vi.advanceTimersByTime(100)
      // すぐに普通に押す
      pointer('pointerdown', bold, 'touch')
      pointer('pointerup', bold, 'touch')
      ;(bold as HTMLElement).click()
    })
    expect(clicks).toEqual(['bold'])
  })

  it('スマホ:短く押したときは名前を出さず、普通に押せる', () => {
    const bold = host.querySelector('#bold')!
    act(() => {
      pointer('pointerdown', bold, 'touch')
      vi.advanceTimersByTime(200)
      pointer('pointerup', bold, 'touch')
      ;(bold as HTMLElement).click()
      vi.advanceTimersByTime(600)
    })
    expect(tipText()).toBeNull()
    expect(clicks).toEqual(['bold'])
  })

  it('スマホ:押したまま指を動かした(ツールバーのスクロール)ときは名前を出さない', () => {
    const bold = host.querySelector('#bold')!
    act(() => {
      pointer('pointerdown', bold, 'touch', 10, 10)
      pointer('pointermove', bold, 'touch', 40, 10)
      vi.advanceTimersByTime(600)
    })
    expect(tipText()).toBeNull()
  })

  it('行のハンドルの長押しには何もしない(選択モードとぶつからない)', () => {
    const handle = host.querySelector('#handle')!
    const down = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' })
    act(() => {
      handle.dispatchEvent(down)
      vi.advanceTimersByTime(700)
      pointer('pointerup', handle, 'touch')
      ;(handle as HTMLElement).click()
    })
    expect(down.defaultPrevented).toBe(false)
    expect(tipText()).toBeNull()
    expect(clicks).toEqual(['handle'])
  })

  it('PC:マウスを乗せると、名前とショートカットを出し、離すと消える', () => {
    const bold = host.querySelector('#bold')!
    act(() => {
      pointer('pointerover', bold, 'mouse')
      vi.advanceTimersByTime(450)
    })
    expect(tipText()).toBe('太字Ctrl+B')
    act(() => {
      bold.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body }))
    })
    expect(tipText()).toBeNull()
  })
})
