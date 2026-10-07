import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { getPages } from '../db/repo'
import { href, navigate } from '../router'
import { Cover } from '../components/Cover'
import { Icon } from '../components/Icon'
import { linkTargetState } from './noteLink'

/** 別ノート・別ページへのリンクのカード。押すとそのページへ移動する */
export function NoteLinkCard({ node, selected, deleteNode, editor }: ReactNodeViewProps) {
  const noteId = node.attrs.noteId as string | null
  const pageId = node.attrs.pageId as string | null
  const state = useLiveQuery(async () => {
    if (!noteId) return linkTargetState(undefined, undefined, [], null)
    const [note, page, pages] = await Promise.all([
      db.notes.get(noteId),
      pageId ? db.pages.get(pageId) : undefined,
      pageId ? getPages(noteId) : [],
    ])
    return linkTargetState(note, page, pages.map((p) => p.id), pageId)
  }, [noteId, pageId])

  const ok = state?.kind === 'ok'
  const title = state && state.kind !== 'missing' ? state.note?.title || '無題のノート' : 'リンク先'
  const sub = !state
    ? ''
    : state.kind === 'ok'
      ? state.pageNumber
        ? `${state.pageNumber}ページ目`
        : 'ノート'
      : state.kind === 'trash'
        ? 'リンク先がゴミ箱にあります'
        : 'リンク先が見つかりません'

  return (
    <NodeViewWrapper
      className={`note-link${selected ? ' is-selected' : ''}${ok ? '' : ' is-broken'}`}
      contentEditable={false}
      data-drag-handle=""
    >
      <a
        className="note-link-card"
        href={ok && noteId ? href.note(noteId, pageId) : undefined}
        aria-disabled={!ok}
        onClick={(e) => {
          e.preventDefault()
          if (ok && noteId) navigate(href.note(noteId, pageId))
        }}
      >
        <span className="note-link-cover">
          {state && state.kind !== 'missing' && state.note ? (
            <Cover title="" design={state.note.design} bare />
          ) : (
            <Icon name="none" size={18} />
          )}
        </span>
        <span className="note-link-text">
          <span className="note-link-title">{title}</span>
          <span className="note-link-sub">{sub}</span>
        </span>
        {ok && (
          <span className="note-link-go">
            <Icon name="next" size={18} />
          </span>
        )}
      </a>
      {selected && editor.isEditable && (
        <button
          type="button"
          className="icon-btn note-link-remove"
          aria-label="リンクを削除"
          title="リンクを削除"
          onClick={() => deleteNode()}
        >
          <Icon name="close" size={18} />
        </button>
      )}
    </NodeViewWrapper>
  )
}
