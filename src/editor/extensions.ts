import { Extension, type AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { ToggleHeading, ToggleTitle } from './ToggleHeading'

export interface HistoryKeys {
  undo: () => void
  redo: () => void
}

/** Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y(Macは⌘)を、ノート単位の履歴につなぐ */
const NoteHistoryKeys = Extension.create<{ keys: HistoryKeys | null }>({
  name: 'noteHistoryKeys',
  addOptions() {
    return { keys: null }
  },
  addKeyboardShortcuts() {
    const run = (fn: 'undo' | 'redo') => () => {
      this.options.keys?.[fn]()
      return true
    }
    return {
      'Mod-z': run('undo'),
      'Mod-Z': run('undo'),
      'Shift-Mod-z': run('redo'),
      'Shift-Mod-Z': run('redo'),
      'Mod-y': run('redo'),
      'Mod-Y': run('redo'),
    }
  },
})

/** フェーズ1で使うエディタ機能 */
export function buildExtensions(keys: HistoryKeys): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      // 元に戻す/やり直しはノート単位の自前の履歴を使うので、標準の履歴はオフ
      undoRedo: false,
      // フェーズ1で使わない機能はオフ(必要になったフェーズで足す)
      blockquote: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      italic: false,
      underline: false,
      link: false,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    ToggleTitle,
    ToggleHeading,
    NoteHistoryKeys.configure({ keys }),
  ]
}
