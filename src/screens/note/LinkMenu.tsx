import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { Icon } from '../../components/Icon'
import { useDialog } from '../../components/Dialog'
import {
  LINK_DIALOG_EVENT,
  LINK_MENU_EVENT,
  applyWebLink,
  currentLink,
  normalizeUrl,
  removeWebLink,
  type LinkDialogDetail,
  type LinkMenuDetail,
} from '../../editor/webLink'
import type { NoteSession } from './session'

/** URL を読める形で表示する(%E4%BA%AC のような部分を日本語に戻す) */
function readableUrl(href: string): string {
  try {
    return decodeURI(href)
  } catch {
    return href
  }
}

/**
 * Webリンク。
 * - リンクの文字を押したとき:「開く/編集/外す」のメニュー
 * - Ctrl+K・ツールバー:URL を入力してリンクを付ける
 */
export function LinkMenu({ session }: { session: NoteSession }) {
  const dialog = useDialog()
  const [menu, setMenu] = useState<LinkMenuDetail | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })

  /** URL を入力してもらってリンクを付ける(range があればそのリンクを直す) */
  const askAndApply = async (editor: Editor, range?: { from: number; to: number; href: string }) => {
    const existing = range ?? currentLink(editor)
    const input = await dialog.prompt({
      title: existing ? 'リンクを編集' : 'Webリンク',
      message: existing ? 'リンク先の URL' : '文字を選んでいればその文字に、選んでいなければ URL をそのまま入れます。',
      initial: existing?.href ?? '',
      placeholder: 'https://example.com',
      type: 'url',
      okLabel: existing ? '変更する' : 'リンクを付ける',
    })
    if (input === null || editor.isDestroyed) return
    const href = normalizeUrl(input)
    if (!href) {
      await dialog.alert({ message: 'URL の形が正しくないようです。「https://」から始まる URL を入れてください。' })
      return
    }
    session.history.closeGroup()
    if (existing) editor.chain().setTextSelection({ from: existing.from, to: existing.to }).run()
    applyWebLink(editor, href)
    session.history.closeGroup()
  }
  const askRef = useRef(askAndApply)
  askRef.current = askAndApply

  useEffect(() => {
    const onMenu = (e: Event) => setMenu((e as CustomEvent<LinkMenuDetail>).detail)
    const onDialog = (e: Event) => void askRef.current((e as CustomEvent<LinkDialogDetail>).detail.editor)
    window.addEventListener(LINK_MENU_EVENT, onMenu)
    window.addEventListener(LINK_DIALOG_EVENT, onDialog)
    return () => {
      window.removeEventListener(LINK_MENU_EVENT, onMenu)
      window.removeEventListener(LINK_DIALOG_EVENT, onDialog)
    }
  }, [])

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu])

  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const margin = 8
    setPos({
      left: Math.max(margin, Math.min(menu.x - r.width / 2, window.innerWidth - r.width - margin)),
      top: Math.max(margin, Math.min(menu.y + 16, window.innerHeight - r.height - margin)),
    })
  }, [menu])

  if (!menu || menu.editor.isDestroyed) return null
  const close = () => setMenu(null)

  return (
    <>
      <div className="popover-backdrop" onClick={close} />
      <div ref={ref} className="popover link-menu" role="menu" style={pos}>
        <div className="link-menu-url" title={readableUrl(menu.href)}>
          {readableUrl(menu.href)}
        </div>
        <div className="popover-row">
          <button
            onClick={() => {
              close()
              window.open(menu.href, '_blank', 'noopener,noreferrer')
            }}
          >
            <Icon name="open" size={18} />
            開く
          </button>
          <button
            onClick={() => {
              close()
              void askAndApply(menu.editor, menu)
            }}
          >
            <Icon name="edit" size={18} />
            編集
          </button>
          <button
            className="is-danger"
            onClick={() => {
              close()
              session.history.closeGroup()
              removeWebLink(menu.editor, menu.from, menu.to)
              session.history.closeGroup()
            }}
          >
            <Icon name="close" size={18} />
            外す
          </button>
        </div>
      </div>
    </>
  )
}
