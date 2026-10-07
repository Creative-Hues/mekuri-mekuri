import { useEffect, useMemo, useReducer, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'
import type { Sticky } from '../../db/db'
import { Icon } from '../../components/Icon'
import { useDialog } from '../../components/Dialog'
import { buildStickyExtensions } from '../../editor/extensions'
import { STICKY_COLORS, clampPosition, clampSize, stickiesBottom } from '../../editor/sticky'
import type { NoteSession } from './session'

/**
 * ページに貼った付箋(ページ1枚分)。
 * 位置と大きさは「紙の幅」に対する割合で保存しているので、紙の幅(コンテナの幅)を掛けて表示する
 */
export function StickyLayer({
  session,
  pageId,
  containerRef,
}: {
  session: NoteSession
  pageId: string
  containerRef: RefObject<HTMLDivElement | null>
}) {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => session.subscribe(rerender), [session])
  const stickies = session.getStickies(pageId)
  if (!stickies.length) return null
  return (
    <>
      {/* 付箋の下までスクロールできるよう、いちばん下の付箋の位置に目印を置く */}
      <div className="sticky-spacer" style={{ top: `calc(${stickiesBottom(stickies)} * 100cqw)` }} />
      {stickies.map((s) => (
        <StickyNote key={s.id} session={session} pageId={pageId} sticky={s} containerRef={containerRef} />
      ))}
    </>
  )
}

/** ドラッグ中だけ手元で持つ位置・大きさ(離したときに保存して、元に戻す1回分にする) */
type Draft = Pick<Sticky, 'x' | 'y' | 'w' | 'h'>

function StickyNote({
  session,
  pageId,
  sticky,
  containerRef,
}: {
  session: NoteSession
  pageId: string
  sticky: Sticky
  containerRef: RefObject<HTMLDivElement | null>
}) {
  const dialog = useDialog()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const box = draft ?? sticky

  const update = (patch: Partial<Sticky>, mergeKey: string | null = null) =>
    session.updateStickies(
      pageId,
      (list) => list.map((s) => (s.id === sticky.id ? { ...s, ...patch, updatedAt: Date.now() } : s)),
      mergeKey,
    )

  // ---- 中身のエディタ ----
  /** 自分で保存した内容(元に戻すなどで外から変わったときだけ、エディタに入れ直す) */
  const lastContent = useRef<JSONContent>(sticky.content)
  const extensions = useMemo(
    () =>
      buildStickyExtensions({
        undo: () => void session.history.undo(),
        redo: () => void session.history.redo(),
        closeGroup: () => session.history.closeGroup(),
      }),
    [session],
  )
  const editor = useEditor(
    {
      extensions,
      content: sticky.content,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editable: !session.select.active,
      editorProps: { attributes: { class: 'sticky-editor', spellcheck: 'false' } },
      onUpdate: ({ editor }) => {
        const json = editor.getJSON()
        lastContent.current = json
        update({ content: json }, `text:${sticky.id}`)
      },
      onFocus: () => {
        session.activePageId = pageId
        session.activeStickyId = sticky.id
        session.emit()
      },
      onTransaction: () => {
        if (session.activeStickyId === sticky.id) session.emit()
      },
    },
    [extensions, sticky.id],
  )

  useEffect(() => {
    if (!editor) return
    session.registerSticky(sticky.id, editor)
    // 追加した直後の付箋には、すぐ書けるようにカーソルを置く
    if (session.focusStickyId === sticky.id) {
      session.focusStickyId = null
      editor.commands.focus('end')
    }
    return () => session.unregisterSticky(sticky.id, editor)
  }, [editor, session, sticky.id])

  // 元に戻す/やり直しで中身が変わったとき
  useEffect(() => {
    if (!editor || editor.isDestroyed || sticky.content === lastContent.current) return
    lastContent.current = sticky.content
    session.history.silently(() => editor.commands.setContent(sticky.content, { emitUpdate: false }))
  }, [editor, session, sticky.content])

  // ---- 移動・大きさ変更(ドラッグ) ----
  const startDrag = (e: ReactPointerEvent, mode: 'move' | 'resize') => {
    const container = containerRef.current
    if (!container || session.select.active) return
    e.preventDefault()
    e.stopPropagation()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const width = container.clientWidth
    const start = { x: e.clientX, y: e.clientY }
    const origin: Draft = { x: sticky.x, y: sticky.y, w: sticky.w, h: sticky.h }
    let current = origin

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / width
      const dy = (ev.clientY - start.y) / width
      if (mode === 'move') {
        current = { ...origin, ...clampPosition(origin, origin.x + dx, origin.y + dy) }
      } else {
        current = { ...origin, ...clampSize(origin, origin.w + dx, origin.h + dy) }
      }
      setDraft(current)
    }
    const onUp = () => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
      setDraft(null)
      if (current !== origin) update(current)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }

  const remove = async () => {
    setMenuOpen(false)
    const ok = await dialog.confirm({
      title: '付箋を削除',
      message: 'この付箋を削除しますか？(削除しても「元に戻す」で戻せます)',
      okLabel: '削除する',
      danger: true,
    })
    if (ok) session.updateStickies(pageId, (list) => list.filter((s) => s.id !== sticky.id))
  }

  return (
    <div
      data-sticky-id={sticky.id}
      className={`sticky tone-light sticky--${sticky.color}${draft ? ' is-dragging' : ''}`}
      style={{
        left: `${box.x * 100}%`,
        top: `calc(${box.y} * 100cqw)`,
        width: `${box.w * 100}%`,
        height: `calc(${box.h} * 100cqw)`,
      }}
    >
      <div className="sticky-bar">
        <button
          type="button"
          className="sticky-grip drag-handle"
          aria-label="付箋を移動"
          title="ドラッグして移動"
          onPointerDown={(e) => startDrag(e, 'move')}
        >
          <Icon name="grip" size={16} />
        </button>
        <button
          type="button"
          className="sticky-menu-btn"
          aria-label="付箋のメニュー"
          aria-expanded={menuOpen}
          title="色・削除"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <Icon name="dots" size={16} />
        </button>
      </div>
      {menuOpen && (
        <div className="sticky-menu" role="menu">
          <div className="sticky-colors">
            {STICKY_COLORS.map((c) => (
              <button
                key={c.name}
                type="button"
                className={`sticky-color sticky--${c.name}${c.name === sticky.color ? ' is-selected' : ''}`}
                aria-label={`${c.label}にする`}
                title={c.label}
                onClick={() => {
                  setMenuOpen(false)
                  if (c.name !== sticky.color) update({ color: c.name })
                }}
              />
            ))}
          </div>
          <button type="button" className="sticky-delete" onClick={() => void remove()}>
            <Icon name="trash" size={16} />
            削除
          </button>
        </div>
      )}
      <div className="sticky-body">
        <EditorContent editor={editor} className="sticky-editor-wrap" />
      </div>
      <button
        type="button"
        className="sticky-resize"
        aria-label="付箋の大きさを変える"
        title="ドラッグして大きさを変える"
        onPointerDown={(e) => startDrag(e, 'resize')}
      />
    </div>
  )
}
