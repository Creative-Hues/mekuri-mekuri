import { useSyncExternalStore } from 'react'

/**
 * 文字サイズ(ノートの中身の文字の大きさ。5段階)。
 * ダークモードと同じく、この端末の localStorage に保存する(ノートのデータではないのでバックアップには入れない)。
 * index.html の小さなスクリプトでも同じキーを読み、表示の途中で文字の大きさが変わるのを防いでいる。
 * 大きくするのは本文・見出し・表・付箋の文字だけ(<html> の --text-zoom を editor.css・sticky.css で使う)。
 * ボタンや本棚・設定画面、PDF の書き出しは変えない
 */

export const TEXT_SIZE_KEY = 'mekuri-text-size'

export const TEXT_SIZES = [
  { name: 'xs', label: '小', zoom: 0.9 },
  { name: 'm', label: '標準', zoom: 1 },
  { name: 'l', label: '大', zoom: 1.15 },
  { name: 'xl', label: 'より大', zoom: 1.3 },
  { name: 'xxl', label: '特大', zoom: 1.5 },
] as const

export type TextSizeName = (typeof TEXT_SIZES)[number]['name']
export const DEFAULT_TEXT_SIZE: TextSizeName = 'm'

const isSize = (v: unknown): v is TextSizeName => TEXT_SIZES.some((s) => s.name === v)

export const textSizeInfo = (name: TextSizeName) => TEXT_SIZES.find((s) => s.name === name)!

/** 1段大きく(+1)・小さく(-1)した文字サイズ。端ではそのまま */
export function stepTextSize(name: TextSizeName, delta: 1 | -1): TextSizeName {
  const i = TEXT_SIZES.findIndex((s) => s.name === name)
  const next = Math.min(TEXT_SIZES.length - 1, Math.max(0, i + delta))
  return TEXT_SIZES[next].name
}

export function loadTextSize(): TextSizeName {
  try {
    const v = localStorage.getItem(TEXT_SIZE_KEY)
    return isSize(v) ? v : DEFAULT_TEXT_SIZE
  } catch {
    return DEFAULT_TEXT_SIZE
  }
}

let size: TextSizeName = loadTextSize()
const listeners = new Set<() => void>()

function apply() {
  const root = document.documentElement
  root.dataset.textSize = size
  root.style.setProperty('--text-zoom', String(textSizeInfo(size).zoom))
  listeners.forEach((fn) => fn())
}

/** 起動時に1回呼ぶ */
export function initTextSize() {
  apply()
}

export function setTextSize(next: TextSizeName) {
  size = next
  try {
    localStorage.setItem(TEXT_SIZE_KEY, next)
  } catch {
    // 保存できない環境(プライベートブラウズなど)では、この起動の間だけ有効
  }
  apply()
}

/** 1段大きく・小さくする(ショートカット・ノートのメニュー) */
export const changeTextSize = (delta: 1 | -1) => setTextSize(stepTextSize(size, delta))

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const useTextSize = () => useSyncExternalStore(subscribe, () => size)
