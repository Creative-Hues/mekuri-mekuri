import type { Editor } from '@tiptap/core'
import type { ToggleLevel } from './ToggleHeading'
import { setLastUsed, getLastUsed } from './lastUsed'
import type { LineColorName, LineStyleName, MarkerColorName, TextColorName } from './palette'

/**
 * 書式の操作。ツールバーとショートカットキーの両方からこれを呼ぶ
 * (同じ操作は必ず同じ結果になるように1か所にまとめる)
 */

export type HeadingLevel = ToggleLevel

/** 今の行の見出しの大きさ(トグル見出しを含む)。見出しでなければ null */
export function currentHeadingLevel(editor: Editor): HeadingLevel | null {
  for (const l of [1, 2, 3] as const) {
    if (editor.isActive('heading', { level: l })) return l
    if (editor.isActive('toggleTitle') && editor.isActive('toggleHeading', { level: l })) return l
  }
  return null
}

/** 見出しにする(同じ大きさならふつうの行に戻す)。トグル見出しの中ならトグルの大きさを変える */
export function toggleHeadingLevel(editor: Editor, level: HeadingLevel) {
  if (editor.isActive('toggleTitle')) editor.chain().focus().toggleToggleHeading(level).run()
  else editor.chain().focus().toggleHeading({ level }).run()
}

/** トグル見出し。ふつうの見出しの上で押したら、その大きさのトグル見出しにする */
export function toggleToggle(editor: Editor) {
  const level = currentHeadingLevel(editor) ?? 2
  editor.chain().focus().toggleToggleHeading(level).run()
}

/** ふつうの行(本文)に戻す */
export function setBody(editor: Editor) {
  if (editor.isActive('toggleTitle')) {
    // 同じ大きさを指定すると、トグル見出しが解除される
    const level = currentHeadingLevel(editor) ?? 2
    editor.chain().focus().toggleToggleHeading(level).run()
  } else {
    editor.chain().focus().setParagraph().run()
  }
}

export const toggleBullet = (editor: Editor) => editor.chain().focus().toggleBulletList().run()
export const toggleOrdered = (editor: Editor) => editor.chain().focus().toggleOrderedList().run()
export const toggleTodo = (editor: Editor) => editor.chain().focus().toggleTaskList().run()
export const toggleBold = (editor: Editor) => editor.chain().focus().toggleBold().run()
export const toggleStrike = (editor: Editor) => editor.chain().focus().toggleStrike().run()

// ---- 色 ----

export function applyTextColor(editor: Editor, color: TextColorName | null) {
  if (color) {
    setLastUsed({ textColor: color })
    editor.chain().focus().setTextColor(color).run()
  } else {
    editor.chain().focus().unsetTextColor().run()
  }
}

export function applyMarker(editor: Editor, color: MarkerColorName | null) {
  if (color) {
    setLastUsed({ marker: color })
    editor.chain().focus().setMarker(color).run()
  } else {
    editor.chain().focus().unsetMarker().run()
  }
}

/** 最後に使った色のマーカーを付け外しする(ショートカット用) */
export function toggleLastMarker(editor: Editor) {
  editor.chain().focus().toggleMarker(getLastUsed().marker).run()
}

export function applyLine(editor: Editor, attrs: { style: LineStyleName; color: LineColorName } | null) {
  if (attrs) {
    setLastUsed({ lineStyle: attrs.style, lineColor: attrs.color })
    editor.chain().focus().setLine(attrs).run()
  } else {
    editor.chain().focus().unsetLine().run()
  }
}

/** 最後に使った種類・色のラインを付け外しする(ショートカット用) */
export function toggleLastLine(editor: Editor) {
  const { lineStyle, lineColor } = getLastUsed()
  editor.chain().focus().toggleLine({ style: lineStyle, color: lineColor }).run()
}
