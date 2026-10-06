import {
  isLineStyle,
  isMarkerColor,
  isTextColor,
  type LineColorName,
  type LineStyleName,
  type MarkerColorName,
  type TextColorName,
} from './palette'

/**
 * 最後に使った色・線の種類(ショートカットキーやツールバーで「同じ色をもう一度」使うため)。
 * ノートのデータではなく、この端末での使い勝手のための記録なので localStorage に置く。
 * 読めない環境(プライベートブラウズなど)でも動くよう、失敗したら初期値を使う
 */

const KEY = 'mekuri.lastUsed'

interface LastUsed {
  textColor: TextColorName
  marker: MarkerColorName
  lineStyle: LineStyleName
  lineColor: LineColorName
}

const DEFAULTS: LastUsed = { textColor: 'red', marker: 'yellow', lineStyle: 'solid', lineColor: null }

function load(): LastUsed {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return {
      textColor: isTextColor(raw.textColor) ? raw.textColor : DEFAULTS.textColor,
      marker: isMarkerColor(raw.marker) ? raw.marker : DEFAULTS.marker,
      lineStyle: isLineStyle(raw.lineStyle) ? raw.lineStyle : DEFAULTS.lineStyle,
      lineColor: isTextColor(raw.lineColor) ? raw.lineColor : null,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

let current = load()

export function getLastUsed(): Readonly<LastUsed> {
  return current
}

export function setLastUsed(patch: Partial<LastUsed>) {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // 保存できなくても、このアプリを開いている間は覚えている
  }
}
