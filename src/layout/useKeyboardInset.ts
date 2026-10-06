import { useSyncExternalStore } from 'react'

/**
 * スマホのキーボード対策。
 * iPhone の Safari などでは、キーボードが出ても画面(レイアウト)の高さは変わらず、
 * 「実際に見えている範囲」(visualViewport)だけが小さくなる。
 * そこで、アプリ全体の高さと位置を見えている範囲に合わせる(CSS変数 --app-height・--app-top)。
 * こうすると画面の下端にあるツールバーが、キーボードのすぐ上に来る。
 */

/** これ以上見えている範囲が小さくなったら「キーボードが出ている」とみなす(px) */
const KEYBOARD_MIN = 120

const vv = window.visualViewport
let keyboardOpen = false
const listeners = new Set<() => void>()
let frame = 0

function update() {
  frame = 0
  if (!vv) return
  const root = document.documentElement
  // ピンチで拡大しているときは合わせない(拡大中に画面が縮むのを防ぐ)
  if (Math.abs(vv.scale - 1) > 0.01) return
  root.style.setProperty('--app-height', `${vv.height}px`)
  root.style.setProperty('--app-top', `${vv.offsetTop}px`)
  const open = window.innerHeight - vv.height > KEYBOARD_MIN
  if (open !== keyboardOpen) {
    keyboardOpen = open
    listeners.forEach((fn) => fn())
  }
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(update)
}

if (vv) {
  vv.addEventListener('resize', schedule)
  vv.addEventListener('scroll', schedule)
  update()
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** キーボードが出ているか(スマホ・タブレット) */
export function useKeyboardOpen(): boolean {
  return useSyncExternalStore(subscribe, () => keyboardOpen)
}
