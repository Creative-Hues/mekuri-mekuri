import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import type { Note, Page } from '../db/db'
import { NoteLinkCard } from './NoteLinkCard'
import { placeCursorAfterBlock } from './blockInsert'

/**
 * 別ノート・別ページへのリンク(カード型。1行として扱う)。
 * 本文には noteId と pageId(ノート全体なら null)だけを保存し、
 * ノート名・ページ番号は表示のたびにデータベースから最新のものを出す
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    noteLink: {
      insertNoteLink: (attrs: { noteId: string; pageId: string | null }) => ReturnType
    }
  }
}

export type LinkTargetState =
  | { kind: 'ok'; note: Note; pageNumber: number | null }
  /** ノートかページがゴミ箱にある */
  | { kind: 'trash'; note: Note | null }
  /** ノートかページが見つからない(完全に削除された) */
  | { kind: 'missing' }

/** リンク先の状態(計算だけの関数) */
export function linkTargetState(
  note: Note | undefined,
  page: Page | undefined,
  livePageIds: string[],
  pageId: string | null,
): LinkTargetState {
  if (!note) return { kind: 'missing' }
  if (note.deletedAt != null) return { kind: 'trash', note }
  if (!pageId) return { kind: 'ok', note, pageNumber: null }
  if (!page || page.noteId !== note.id) return { kind: 'missing' }
  if (page.deletedAt != null) return { kind: 'trash', note }
  const index = livePageIds.indexOf(page.id)
  return index < 0 ? { kind: 'missing' } : { kind: 'ok', note, pageNumber: index + 1 }
}

export const NoteLinkNode = Node.create({
  name: 'noteLink',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      noteId: { default: null, parseHTML: (el) => el.getAttribute('data-note-id') },
      pageId: { default: null, parseHTML: (el) => el.getAttribute('data-page-id') || null },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-note-link]' }]
  },

  renderHTML({ node }) {
    return [
      'div',
      { 'data-note-link': '', 'data-note-id': node.attrs.noteId, 'data-page-id': node.attrs.pageId ?? '' },
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteLinkCard, { as: 'div', className: 'note-link-wrap' })
  },

  addCommands() {
    return {
      insertNoteLink:
        (attrs) =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name, attrs })
            .command(({ tr }) => {
              placeCursorAfterBlock(tr)
              return true
            })
            .run(),
    }
  },
})
