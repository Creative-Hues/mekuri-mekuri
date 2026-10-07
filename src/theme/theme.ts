import { useSyncExternalStore } from 'react'
import { paperColor, type Tone } from '../design/palette'

/**
 * ダークモード。
 * 設定(端末に合わせる/ライト/ダーク)はこの端末の localStorage に保存する(ノートのデータではないので
 * バックアップには入れない)。index.html の小さなスクリプトでも同じキーを読み、画面が一瞬白くなるのを防いでいる
 */

export type ThemePref = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

export const THEME_KEY = 'mekuri-theme'
/** 画面の上の帯(ステータスバー)の色。base.css の --bg と同じ */
export const THEME_COLOR: Record<Theme, string> = { light: '#ffffff', dark: '#36363c' }

export const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'system', label: '端末に合わせる' },
  { value: 'light', label: 'ライト' },
  { value: 'dark', label: 'ダーク' },
]

const isPref = (v: unknown): v is ThemePref => v === 'system' || v === 'light' || v === 'dark'

/** 設定と端末のダークモードから、実際に使うテーマを決める */
export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  if (pref === 'system') return systemDark ? 'dark' : 'light'
  return pref
}

/**
 * 紙の色の明るさ。
 * 背景色を選んだノートはその色の明るさで、「指定なし」はアプリのテーマに合わせる
 */
export function paperTone(paper: string | null | undefined, theme: Theme): Tone {
  return paperColor(paper)?.tone ?? theme
}

export function loadThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return isPref(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null

let pref: ThemePref = loadThemePref()
let theme: Theme = resolveTheme(pref, media?.matches ?? false)
const listeners = new Set<() => void>()

function apply() {
  theme = resolveTheme(pref, media?.matches ?? false)
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
  listeners.forEach((fn) => fn())
}

/** 起動時に1回呼ぶ:テーマを当て、端末の設定の変化に追従する */
export function initTheme() {
  apply()
  media?.addEventListener('change', () => {
    if (pref === 'system') apply()
  })
}

export function setThemePref(next: ThemePref) {
  pref = next
  try {
    localStorage.setItem(THEME_KEY, next)
  } catch {
    // 保存できない環境(プライベートブラウズなど)では、この起動の間だけ有効
  }
  apply()
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const useThemePref = () => useSyncExternalStore(subscribe, () => pref)
export const useTheme = () => useSyncExternalStore(subscribe, () => theme)
