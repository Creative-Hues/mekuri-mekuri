import { Extension, type AnyExtension, type Editor } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { ToggleHeading, ToggleTitle } from './ToggleHeading'
import { Line, Marker, TextColor } from './marks'
import { matchShortcut, type ShortcutId } from './shortcuts'
import {
  setBody,
  toggleBold,
  toggleBullet,
  toggleHeadingLevel,
  toggleLastLine,
  toggleLastMarker,
  toggleOrdered,
  toggleStrike,
  toggleTodo,
} from './format'

/** エディタからノート画面へつなぐ処理 */
export interface EditorHooks {
  undo: () => void
  redo: () => void
  /** 書式の変更を、前後の入力とは別の「元に戻す」1回分にする */
  closeGroup: () => void
}

/** エディタの中で使うショートカットと、その処理 */
const FORMAT_ACTIONS: Partial<Record<ShortcutId, (editor: Editor) => void>> = {
  bold: toggleBold,
  strike: toggleStrike,
  line: toggleLastLine,
  marker: toggleLastMarker,
  h1: (e) => toggleHeadingLevel(e, 1),
  h2: (e) => toggleHeadingLevel(e, 2),
  h3: (e) => toggleHeadingLevel(e, 3),
  body: setBody,
  orderedList: toggleOrdered,
  bulletList: toggleBullet,
  taskList: toggleTodo,
}

/**
 * ショートカットキー(Ctrl、Macは⌘)。
 * キーの位置(event.code)で判定するので、日本語キーボードでも同じキーで使える。
 * 標準のショートカット(文字で判定する)より先に処理するため、優先度を高くしている
 */
const EditorShortcuts = Extension.create<{ hooks: EditorHooks | null }>({
  name: 'editorShortcuts',
  priority: 1000,

  addOptions() {
    return { hooks: null }
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    const options = this.options
    return [
      new Plugin({
        props: {
          handleKeyDown: (_view, event) => {
            const id = matchShortcut(event)
            if (!id) return false
            const hooks = options.hooks
            if (id === 'undo' || id === 'redo') {
              event.preventDefault()
              hooks?.[id]()
              return true
            }
            const action = FORMAT_ACTIONS[id]
            if (!action) return false // ノート画面で扱うもの(ページ一覧など)
            event.preventDefault()
            hooks?.closeGroup()
            action(editor)
            hooks?.closeGroup()
            return true
          },
        },
      }),
    ]
  },
})

/** ページ本文のエディタで使う機能 */
export function buildExtensions(hooks: EditorHooks): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      // 元に戻す/やり直しはノート単位の自前の履歴を使うので、標準の履歴はオフ
      undoRedo: false,
      // 使わない機能はオフ(必要になったフェーズで足す)
      blockquote: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      italic: false,
      // 下線は、線の種類と色を選べる自作の「ライン」を使う
      underline: false,
      link: false,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    ToggleTitle,
    ToggleHeading,
    TextColor,
    Marker,
    Line,
    EditorShortcuts.configure({ hooks }),
  ]
}
