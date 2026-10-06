import { Node, mergeAttributes } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'

/**
 * トグル見出し(タップで中身を開閉できる見出し)
 *
 * 形:toggleHeading(level, open)
 *       ├ toggleTitle(見出しの文字)
 *       └ ブロック1つ以上(中身)
 */

export type ToggleLevel = 1 | 2 | 3

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggleHeading: {
      /** 今の行をトグル見出しにする。すでにトグル見出しの中なら普通の段落に戻す */
      toggleToggleHeading: (level: ToggleLevel) => ReturnType
    }
  }
}

/** 開閉だけの変更は「元に戻す」の対象にしない目印 */
export const SKIP_HISTORY_META = 'mekuriSkipHistory'

export const ToggleTitle = Node.create({
  name: 'toggleTitle',
  content: 'inline*',
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-type="toggle-title"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle-title', class: 'toggle-title' }), 0]
  },
})

/** 選択位置を含む一番内側のトグル見出しを探す */
function findToggle(state: EditorState): { node: PMNode; pos: number; depth: number } | null {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'toggleHeading') return { node, pos: $from.before(d), depth: d }
  }
  return null
}

/** トグル見出しを解除し、見出し文字を段落に戻して中身を後ろに並べる */
function unwrapToggle(tr: Transaction, state: EditorState, toggle: { node: PMNode; pos: number }) {
  const { schema } = state
  const [title, ...body] = toggle.node.children
  const paragraph = schema.nodes.paragraph.create(null, title.content)
  // 中身が空の段落1つだけなら捨てる
  const keepBody = !(body.length === 1 && body[0].type.name === 'paragraph' && body[0].content.size === 0)
  const nodes = keepBody ? [paragraph, ...body] : [paragraph]
  const offsetInTitle = state.selection.$from.parent === title ? state.selection.$from.parentOffset : 0
  tr.replaceWith(toggle.pos, toggle.pos + toggle.node.nodeSize, Fragment.fromArray(nodes))
  tr.setSelection(TextSelection.create(tr.doc, toggle.pos + 1 + offsetInTitle))
}

export const ToggleHeading = Node.create({
  name: 'toggleHeading',
  group: 'block',
  content: 'toggleTitle block+',
  defining: true,

  addAttributes() {
    return {
      level: {
        default: 1,
        parseHTML: (el) => Number(el.getAttribute('data-level')) || 1,
        renderHTML: (attrs) => ({ 'data-level': attrs.level }),
      },
      open: {
        default: true,
        parseHTML: (el) => el.getAttribute('data-open') !== 'false',
        renderHTML: (attrs) => ({ 'data-open': attrs.open ? 'true' : 'false' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="toggle-heading"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle-heading', class: 'toggle-heading' }), 0]
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node
      const dom = document.createElement('div')
      dom.className = 'toggle-heading'
      dom.dataset.type = 'toggle-heading'

      // 開閉ボタン(絵文字・記号は端末で見た目が変わるのでSVGで描く)
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'toggle-btn'
      button.contentEditable = 'false'
      button.innerHTML =
        '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M5.5 3.5 L10.5 8 L5.5 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'

      const contentDOM = document.createElement('div')
      contentDOM.className = 'toggle-content'

      dom.append(button, contentDOM)

      const render = () => {
        dom.dataset.level = String(current.attrs.level)
        dom.dataset.open = current.attrs.open ? 'true' : 'false'
        button.setAttribute('aria-label', current.attrs.open ? '閉じる' : '開く')
        button.setAttribute('aria-expanded', current.attrs.open ? 'true' : 'false')
      }
      render()

      // ボタンを押してもキーボードが閉じたりカーソルが飛んだりしないようにする
      button.addEventListener('mousedown', (e) => e.preventDefault())
      button.addEventListener('click', (e) => {
        e.preventDefault()
        if (!editor.isEditable || typeof getPos !== 'function') return
        const pos = getPos()
        if (pos == null) return
        const open = !current.attrs.open
        const { state } = editor.view
        const tr = state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, open })
        tr.setMeta(SKIP_HISTORY_META, true)
        // 閉じるとき、カーソルが隠れる中身にあれば見出しの末尾へ移す
        if (!open) {
          const titleEnd = pos + 1 + current.child(0).nodeSize - 1
          const { from } = state.selection
          if (from > titleEnd && from < pos + current.nodeSize) {
            tr.setSelection(TextSelection.create(tr.doc, titleEnd))
          }
        }
        editor.view.dispatch(tr)
      })

      return {
        dom,
        contentDOM,
        update(updated) {
          if (updated.type !== current.type) return false
          current = updated
          render()
          return true
        },
        ignoreMutation(mutation) {
          // ボタンと、自分で付けた属性の変化は無視する
          if (button.contains(mutation.target)) return true
          return mutation.type === 'attributes' && mutation.target === dom
        },
        stopEvent(event) {
          return button.contains(event.target as globalThis.Node)
        },
      }
    }
  },

  addCommands() {
    return {
      toggleToggleHeading:
        (level) =>
        ({ state, tr, dispatch }) => {
          const toggle = findToggle(state)
          const { schema } = state
          if (toggle) {
            // 同じ大きさなら解除、違う大きさなら大きさだけ変える
            if (toggle.node.attrs.level === level) {
              if (dispatch) unwrapToggle(tr, state, toggle)
            } else if (dispatch) {
              tr.setNodeMarkup(toggle.pos, undefined, { ...toggle.node.attrs, level })
            }
            return true
          }
          const { $from } = state.selection
          const block = $from.parent
          if (!block.isTextblock) return false
          const depth = $from.depth
          const start = $from.before(depth)
          const parent = $from.node(depth - 1)
          const index = $from.index(depth - 1)
          const toggleNode = schema.nodes.toggleHeading.create({ level, open: true }, [
            schema.nodes.toggleTitle.create(null, block.content),
            schema.nodes.paragraph.create(),
          ])
          if (!parent.canReplaceWith(index, index + 1, toggleNode.type)) return false
          if (dispatch) {
            tr.replaceWith(start, start + block.nodeSize, toggleNode)
            tr.setSelection(TextSelection.create(tr.doc, start + 2 + $from.parentOffset))
          }
          return true
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      // 見出しの中でEnter:カーソルより後ろの文字を中身の先頭に新しい行として送る
      Enter: ({ editor }) => {
        const { state } = editor
        const { $from, empty } = state.selection
        if (!empty) return false
        const schema = state.schema

        if ($from.parent.type.name === 'toggleTitle') {
          const toggle = findToggle(state)
          if (!toggle) return false
          const title = $from.parent
          const after = title.content.cut($from.parentOffset)
          const tr = state.tr
          const titleStart = $from.start()
          tr.delete(titleStart + $from.parentOffset, titleStart + title.content.size)
          if (!toggle.node.attrs.open) {
            tr.setNodeMarkup(toggle.pos, undefined, { ...toggle.node.attrs, open: true })
          }
          const bodyStart = tr.mapping.map(titleStart + title.content.size) + 1
          tr.insert(bodyStart, schema.nodes.paragraph.create(null, after))
          tr.setSelection(TextSelection.create(tr.doc, bodyStart + 1))
          editor.view.dispatch(tr.scrollIntoView())
          return true
        }

        // 中身の最後の空行でEnter:トグル見出しの外へ出る
        const grand = $from.node($from.depth - 1)
        if (
          $from.parent.type.name === 'paragraph' &&
          $from.parent.content.size === 0 &&
          grand?.type.name === 'toggleHeading' &&
          $from.index($from.depth - 1) === grand.childCount - 1 &&
          grand.childCount > 2
        ) {
          const togglePos = $from.before($from.depth - 1)
          const tr = state.tr
          tr.delete($from.before(), $from.after())
          const afterToggle = togglePos + tr.doc.nodeAt(togglePos)!.nodeSize
          tr.insert(afterToggle, schema.nodes.paragraph.create())
          tr.setSelection(TextSelection.create(tr.doc, afterToggle + 1))
          editor.view.dispatch(tr.scrollIntoView())
          return true
        }
        return false
      },
      // 見出しの先頭でBackspace:トグル見出しを解除する
      Backspace: ({ editor }) => {
        const { state } = editor
        const { $from, empty } = state.selection
        if (!empty || $from.parent.type.name !== 'toggleTitle' || $from.parentOffset !== 0) return false
        const toggle = findToggle(state)
        if (!toggle) return false
        const tr = state.tr
        unwrapToggle(tr, state, toggle)
        editor.view.dispatch(tr)
        return true
      },
    }
  },
})
