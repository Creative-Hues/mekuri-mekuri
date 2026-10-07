import { Extension, getMarkRange, type Editor } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'

/**
 * Webリンク(文字に付けるリンク)。リンクの仕組みは StarterKit に入っている link を使う。
 * エディタの中でリンクの文字を押すと、すぐには開かず「開く/編集/外す」のメニューを出す
 * (文字を直したいときに、間違えて開かないように)
 */

/** リンクのメニューを出すときに送る合図(ノート画面の LinkMenu が受け取る) */
export const LINK_MENU_EVENT = 'mekuri:link-menu'
/** Webリンクの入力欄を出すときに送る合図(Ctrl+K・ツールバー) */
export const LINK_DIALOG_EVENT = 'mekuri:link-dialog'

export interface LinkMenuDetail {
  editor: Editor
  href: string
  from: number
  to: number
  x: number
  y: number
}

export interface LinkDialogDetail {
  editor: Editor
}

/**
 * 入力された URL を整える。使えない URL なら null。
 * 「example.com」のように https:// を省いたものは https:// を付ける
 */
export function normalizeUrl(input: string): string | null {
  const text = input.trim()
  if (!text || /\s/.test(text)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
  try {
    const url = new URL(withScheme)
    if (url.protocol === 'mailto:') return url.href
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    // 「https://abc」のような、点のないホスト名は打ち間違いとみなす
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null
    return url.href
  } catch {
    return null
  }
}

/** 選んだ文字にリンクを付ける。文字を選んでいなければ URL をそのまま文字として入れる */
export function applyWebLink(editor: Editor, href: string) {
  const { from, to, empty } = editor.state.selection
  if (empty) {
    editor
      .chain()
      .focus()
      .insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
      .run()
  } else {
    editor.chain().focus().setTextSelection({ from, to }).extendMarkRange('link').setLink({ href }).run()
  }
}

/** from〜to のリンクを外す */
export function removeWebLink(editor: Editor, from: number, to: number) {
  editor.chain().focus().setTextSelection({ from, to }).unsetLink().run()
}

/** 今カーソルのあるリンク(なければ null) */
export function currentLink(editor: Editor): { href: string; from: number; to: number } | null {
  const type = editor.schema.marks.link
  if (!type || !editor.isActive('link')) return null
  const range = getMarkRange(editor.state.selection.$from, type)
  const href = editor.getAttributes('link').href as string | undefined
  return range && href ? { href, from: range.from, to: range.to } : null
}

/** リンクの文字を押したらメニューの合図を送る */
export const WebLinkMenu = Extension.create({
  name: 'webLinkMenu',

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        props: {
          handleClick: (view, pos, event) => {
            const type = view.state.schema.marks.link
            if (!type) return false
            const $pos = view.state.doc.resolve(pos)
            const range = getMarkRange($pos, type)
            if (!range) return false
            const mark = $pos.marks().find((m) => m.type === type) ?? view.state.doc.nodeAt(pos)?.marks.find((m) => m.type === type)
            const href = mark?.attrs.href as string | undefined
            if (!href) return false
            window.dispatchEvent(
              new CustomEvent<LinkMenuDetail>(LINK_MENU_EVENT, {
                detail: { editor, href, from: range.from, to: range.to, x: event.clientX, y: event.clientY },
              }),
            )
            // カーソルはいつもどおり置く
            return false
          },
        },
      }),
    ]
  },
})
