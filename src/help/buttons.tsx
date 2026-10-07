import type { ReactNode } from 'react'
import { Icon, type IconName } from '../components/Icon'
import { shortcutText, type ShortcutId } from '../editor/shortcuts'

/**
 * 画面のボタンの情報(名前・アイコン・説明・ショートカット)の決まりと、それを使う部品。
 * ノート画面(screens/note/noteButtons.tsx)・本棚(screens/shelfButtons.tsx)は、
 * それぞれのボタンの一覧をこの形で持ち、画面のボタン・ボタンの名前の表示・ヘルプをその一覧から作る
 */

export type ButtonGlyph = { icon: IconName } | { text: string; textClass?: string }

/** 端末で操作のしかたが違うときは、タッチ(スマホ)とマウス(PC)で分けて書く */
export type DeviceText = string | { touch: string; mouse: string }

export interface ButtonDef {
  /** ボタンの名前(短く。マウスを乗せたとき・長押ししたときに出す) */
  name: string
  /** ヘルプに出す説明 */
  description: DeviceText
  glyph: ButtonGlyph
  /** 対応するショートカット(PC のヘルプにだけ出す) */
  shortcut?: ShortcutId
  /** ショートカットがボタンと少し違う働きのときの説明(例:最後に使った色を付け外し) */
  shortcutNote?: string
  /** いつも出ているわけではないボタンの、出る条件 */
  when?: DeviceText
  /** その端末でだけ出るボタン(ヘルプでも、その端末のときだけ載せる) */
  only?: 'touch' | 'mouse'
}

/** 端末に合わせた文 */
export const forDevice = (text: DeviceText, mouse: boolean) =>
  typeof text === 'string' ? text : mouse ? text.mouse : text.touch

/** その端末のヘルプに載せるか */
export const shownOn = (def: ButtonDef, mouse: boolean) => !def.only || def.only === (mouse ? 'mouse' : 'touch')

/** ショートカットの表示(例:Ctrl+B)。ないときは空 */
export const buttonShortcut = (def: ButtonDef) => (def.shortcut ? shortcutText(def.shortcut) : '')

/** 読み上げ用の名前(ショートカットがあれば付ける) */
export function buttonLabel(def: ButtonDef): string {
  const key = buttonShortcut(def)
  if (!key) return def.name
  return def.shortcutNote ? `${def.name}(${def.shortcutNote}:${key})` : `${def.name}(${key})`
}

/**
 * ボタンに付ける属性:読み上げ用の名前と、マウスを乗せた・長押ししたときに出す名前(ButtonTips.tsx)。
 * ショートカットは PC だけで出す(data-tip-key)
 */
export function tipProps(def: ButtonDef) {
  const key = buttonShortcut(def)
  return {
    'aria-label': buttonLabel(def),
    'data-tip': def.name,
    'data-tip-key': key ? (def.shortcutNote ? `${def.shortcutNote}:${key}` : key) : undefined,
  }
}

/** ボタンの見た目(アイコンか文字) */
export function Glyph({ glyph, size }: { glyph: ButtonGlyph; size?: number }): ReactNode {
  return 'icon' in glyph ? <Icon name={glyph.icon} size={size} /> : <span className={glyph.textClass}>{glyph.text}</span>
}
