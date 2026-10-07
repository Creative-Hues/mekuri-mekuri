import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Note } from '../../db/db'
import { getPages, getShelfNotes } from '../../db/repo'
import { previewLines } from '../../editor/preview'
import { fullOrder, shelfSections } from '../../shelf/order'
import { Icon } from '../../components/Icon'
import { Cover } from '../../components/Cover'

/**
 * ノート・ページへのリンクを入れるときの選択画面。
 * まずノートを選び、次に「ノート全体」かページを選ぶ
 */
export function NoteLinkPicker({
  currentNoteId,
  side,
  onPick,
  onClose,
}: {
  currentNoteId: string
  side: boolean
  onPick: (target: { noteId: string; pageId: string | null }) => void
  onClose: () => void
}) {
  const [note, setNote] = useState<Note | null>(null)
  const notes = useLiveQuery(async () => {
    const shelf = await getShelfNotes()
    const byId = new Map(shelf.map((n) => [n.id, n]))
    return fullOrder(shelfSections(shelf)).map((id) => byId.get(id)!)
  }, [])
  const pages = useLiveQuery(async () => (note ? getPages(note.id) : []), [note])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (note) setNote(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [note, onClose])

  return (
    <div className="toc-backdrop" onClick={onClose}>
      <nav
        className={`toc picker ${side ? 'toc--side' : 'toc--sheet'}`}
        aria-label="ノートへのリンク"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="toc-header">
          {note && (
            <button className="icon-btn" onClick={() => setNote(null)} aria-label="ノートを選び直す" title="戻る">
              <Icon name="back" />
            </button>
          )}
          <h2>{note ? note.title || '無題のノート' : 'リンクするノート'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる" title="閉じる">
            <Icon name="close" />
          </button>
        </header>
        <div className="toc-scroll">
          {!note ? (
            <ul className="picker-list">
              {notes?.map((n) => (
                <li key={n.id}>
                  <button className="picker-item" onClick={() => setNote(n)}>
                    <span className="picker-cover">
                      <Cover title="" design={n.design} bare />
                    </span>
                    <span className="picker-title">{n.title || '無題のノート'}</span>
                    {n.id === currentNoteId && <span className="picker-tag">このノート</span>}
                    <Icon name="next" size={18} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="picker-list">
              <li>
                <button className="picker-item" onClick={() => onPick({ noteId: note.id, pageId: null })}>
                  <Icon name="book" />
                  <span className="picker-title">ノート全体(1ページ目を開く)</span>
                </button>
              </li>
              {pages?.map((p, i) => (
                <li key={p.id}>
                  <button className="picker-item" onClick={() => onPick({ noteId: note.id, pageId: p.id })}>
                    <span className="picker-page">{i + 1}</span>
                    <span className="picker-title">{previewLines(p.content, 1)[0]?.text || '(白紙)'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </nav>
    </div>
  )
}
