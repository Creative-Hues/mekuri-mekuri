import { useEffect, useMemo, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'
import { buildExtensions } from '../../editor/extensions'
import { SKIP_HISTORY_META } from '../../editor/ToggleHeading'
import type { NoteSession } from './session'
import { BlockHandles } from './BlockHandles'
import { StickyLayer } from './StickyLayer'

interface Props {
  session: NoteSession
  pageId: string
  storedContent: JSONContent
}

/**
 * 1ページ分の中身:本文のエディタ・行のハンドル・付箋。
 * 付箋の位置は紙の幅に対する割合なので、この枠を幅の基準(コンテナ)にする
 */
export function PageContent({ hoverMode, ...props }: Props & { hoverMode: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div className="page-content" ref={ref}>
      <PageEditor {...props} />
      <BlockHandles session={props.session} pageId={props.pageId} containerRef={ref} hoverMode={hoverMode} />
      <StickyLayer session={props.session} pageId={props.pageId} containerRef={ref} />
    </div>
  )
}

/** 1ページ分のエディタ */
function PageEditor({ session, pageId, storedContent }: Props) {
  const extensions = useMemo(
    () =>
      buildExtensions({
        undo: () => void session.history.undo(),
        redo: () => void session.history.redo(),
        closeGroup: () => session.history.closeGroup(),
        moveLine: (dir) => {
          const editor = session.getEditor(pageId)
          return !!editor && session.moveAdjacent(editor, pageId, dir)
        },
      }),
    [session, pageId],
  )

  const editor = useEditor(
    {
      extensions,
      content: session.initialContent(pageId, storedContent),
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: { class: 'page-editor', spellcheck: 'false' },
      },
      onTransaction: ({ editor, transaction }) => {
        if (transaction.docChanged && !session.history.isApplying) {
          if (transaction.getMeta(SKIP_HISTORY_META)) {
            session.history.syncLatest(pageId, editor.state.doc)
          } else {
            session.history.recordText(pageId, transaction.before, editor.state.doc)
          }
        }
        if (session.activePageId === pageId) session.emit()
      },
      onUpdate: ({ editor }) => {
        session.changed(pageId, editor.getJSON())
      },
      onFocus: () => {
        session.activePageId = pageId
        session.activeStickyId = null
        session.emit()
      },
      onBlur: () => {
        session.emit()
      },
    },
    [extensions, pageId],
  )

  useEffect(() => {
    if (!editor) return
    session.register(pageId, editor)
    return () => {
      session.unregister(pageId, editor)
      // 画面から外れるときは保存待ちをすぐ保存する
      void session.flush(pageId)
    }
  }, [editor, pageId, session])

  return <EditorContent editor={editor} className="page-editor-wrap" />
}
