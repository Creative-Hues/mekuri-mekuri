import { useSyncExternalStore } from 'react'

// 切り替えの境目(仮の値。実機で調整する)
const SPREAD_QUERY = '(min-width: 600px)' // これ以上の幅なら見開き
const SIDEBAR_FIXED_QUERY = '(min-width: 1024px) and (hover: hover) and (pointer: fine)' // PC:一覧を常に表示
const SIDEBAR_TOGGLE_QUERY = '(min-width: 768px) and (min-height: 600px)' // タブレット:開閉できる一覧
const ARROWS_QUERY = '(min-width: 768px), (hover: hover) and (pointer: fine)' // 矢印ボタンを出す

export type SidebarMode = 'fixed' | 'toggle' | 'none'

export interface LayoutMode {
  /** 見開き表示か */
  spread: boolean
  sidebar: SidebarMode
  /** ページ送りの矢印ボタンを出すか */
  arrows: boolean
}

const queries = [SPREAD_QUERY, SIDEBAR_FIXED_QUERY, SIDEBAR_TOGGLE_QUERY, ARROWS_QUERY].map((q) =>
  window.matchMedia(q),
)

let snapshot = compute()

function compute(): LayoutMode {
  const [spread, fixed, toggle, arrows] = queries.map((m) => m.matches)
  return {
    spread,
    sidebar: fixed ? 'fixed' : toggle ? 'toggle' : 'none',
    arrows,
  }
}

// 画面の変化は1か所で受け取り、使っているすべての部品に知らせる
const listeners = new Set<() => void>()
queries.forEach((m) =>
  m.addEventListener('change', () => {
    const next = compute()
    if (
      next.spread !== snapshot.spread ||
      next.sidebar !== snapshot.sidebar ||
      next.arrows !== snapshot.arrows
    ) {
      snapshot = next
      listeners.forEach((fn) => fn())
    }
  }),
)

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

/** 画面の幅・向きから、1ページ/見開き と 一覧の出し方を決める */
export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(subscribe, () => snapshot)
}
