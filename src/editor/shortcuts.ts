/**
 * ショートカットキーの一覧と判定。
 *
 * 日本語キーボード(JIS配列)では、Shift+7 で「'」、Shift+8 で「(」が入力されるなど、
 * 押した文字(event.key)がUS配列と違う。そのため文字ではなく
 * 「どのキーを押したか」(event.code:KeyB・Digit7 など)で判定する。
 * event.code はキーボードの配列や日本語入力のオン/オフに左右されない。
 */

export type ShortcutId =
  | 'bold'
  | 'strike'
  | 'line'
  | 'marker'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'body'
  | 'orderedList'
  | 'bulletList'
  | 'taskList'
  | 'undo'
  | 'redo'
  | 'pageList'
  | 'moveUp'
  | 'moveDown'
  | 'addSticky'
  | 'toc'
  | 'link'
  | 'search'

interface KeyCombo {
  code: string
  shift?: boolean
  alt?: boolean
  /** Ctrl(Macは⌘)を押さずに使う(行の移動の Alt+↑ など) */
  noMod?: boolean
}

interface ShortcutDef {
  id: ShortcutId
  label: string
  /** 最初の組み合わせを一覧・ボタンの説明に表示する */
  combos: KeyCombo[]
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'undo', label: '元に戻す', combos: [{ code: 'KeyZ' }] },
  { id: 'redo', label: 'やり直し', combos: [{ code: 'KeyZ', shift: true }, { code: 'KeyY' }] },
  { id: 'bold', label: '太字', combos: [{ code: 'KeyB' }] },
  { id: 'strike', label: '取り消し線', combos: [{ code: 'KeyS', shift: true }] },
  { id: 'line', label: 'ライン(最後に使った線)', combos: [{ code: 'KeyU' }] },
  { id: 'marker', label: 'マーカー(最後に使った色)', combos: [{ code: 'KeyH', shift: true }] },
  { id: 'h1', label: '大見出し', combos: [{ code: 'Digit1', alt: true }] },
  { id: 'h2', label: '中見出し', combos: [{ code: 'Digit2', alt: true }] },
  { id: 'h3', label: '小見出し', combos: [{ code: 'Digit3', alt: true }] },
  { id: 'body', label: '本文に戻す', combos: [{ code: 'Digit0', alt: true }] },
  { id: 'orderedList', label: '番号付きリスト', combos: [{ code: 'Digit7', shift: true }] },
  { id: 'bulletList', label: '箇条書き', combos: [{ code: 'Digit8', shift: true }] },
  { id: 'taskList', label: 'ToDoリスト', combos: [{ code: 'Digit9', shift: true }] },
  { id: 'moveUp', label: '行を上へ移動', combos: [{ code: 'ArrowUp', alt: true, noMod: true }] },
  { id: 'moveDown', label: '行を下へ移動', combos: [{ code: 'ArrowDown', alt: true, noMod: true }] },
  { id: 'addSticky', label: '付箋を追加', combos: [{ code: 'KeyN', alt: true }] },
  { id: 'toc', label: '目次を開く', combos: [{ code: 'KeyT', alt: true }] },
  { id: 'pageList', label: 'ページ一覧を開く', combos: [{ code: 'KeyP', alt: true }] },
  { id: 'link', label: 'Webリンクを付ける', combos: [{ code: 'KeyK' }] },
  { id: 'search', label: '全ノート検索', combos: [{ code: 'KeyF' }] },
]

/** Mac(iPad のキーボードを含む)では Ctrl の代わりに ⌘ を使う */
export const IS_MAC = /Mac|iPhone|iPad|iPod/.test(
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent,
)

/**
 * キー入力がどのショートカットか調べる。どれでもなければ null。
 * 行の移動(Alt+↑↓)以外は、Ctrl(Macは⌘)を押しながら使う
 */
export function matchShortcut(e: KeyboardEvent): ShortcutId | null {
  // 日本語入力の変換中は、ショートカットとして扱わない
  if (e.isComposing) return null
  const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  const none = !e.metaKey && !e.ctrlKey
  for (const s of SHORTCUTS) {
    for (const c of s.combos) {
      if (c.noMod ? !none : !mod) continue
      if (e.code === c.code && e.shiftKey === !!c.shift && e.altKey === !!c.alt) return s.id
    }
  }
  return null
}

function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  // 矢印は絵文字にならない普通の文字(U+2191・U+2193)を使う
  if (code === 'ArrowUp') return '↑'
  if (code === 'ArrowDown') return '↓'
  return code
}

/** 表示用の文字(例:Ctrl+Shift+S、Macでは ⌘+Shift+S) */
export function shortcutText(id: ShortcutId, which = 0): string {
  const def = SHORTCUTS.find((s) => s.id === id)
  const c = def?.combos[which]
  if (!c) return ''
  const parts = c.noMod ? [] : [IS_MAC ? '⌘' : 'Ctrl']
  if (c.shift) parts.push('Shift')
  if (c.alt) parts.push(IS_MAC ? 'Option' : 'Alt')
  parts.push(keyName(c.code))
  return parts.join('+')
}

/** ボタンの説明用(例:「太字(Ctrl+B)」) */
export function withShortcut(label: string, id: ShortcutId): string {
  return `${label}(${shortcutText(id)})`
}
