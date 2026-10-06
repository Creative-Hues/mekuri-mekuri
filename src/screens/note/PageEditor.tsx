import { useEffect, useMemo } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'
import { buildExtensions } from '../../editor/extensions'
import { SKIP_HISTORY_META } from '../../editor/ToggleHeading'
import type { NoteSession } from './session'

interface Props {
  session: NoteSession
  pageId: string
  storedContent: JSONContent
}

/** 1ページ分のエディタ */
export function PageEditor({ session, pageId, storedContent }: Props) {
  const extensions = useMemo(
    () =>
      buildExtensions({
        undo: () => void session.history.undo(),
        redo: () => void session.history.redo(),
        closeGroup: () => session.history.closeGroup(),
      }),
    [session],
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
