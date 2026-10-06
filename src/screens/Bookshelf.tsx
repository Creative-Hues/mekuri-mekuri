import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { createNote } from '../db/repo'
import { href, navigate } from '../router'
import { Icon } from '../components/Icon'

/** 本棚:ノートを表紙で並べる(表紙のデザインはフェーズ3) */
export function Bookshelf() {
  const notes = useLiveQuery(() => db.notes.orderBy('order').toArray(), [])

  const create = async () => {
    const note = await createNote()
    navigate(href.note(note.id))
  }

  return (
    <div className="shelf">
      <header className="shelf-header">
        <h1 className="app-title">めくりめくり</h1>
        <a className="icon-btn" href={href.settings()} aria-label="設定" title="設定">
          <Icon name="settings" />
        </a>
      </header>

      <div className="shelf-grid">
        <button className="book book--new" onClick={() => void create()}>
          <span className="book-new-inner">
            <Icon name="plus" size={28} />
            <span>新しいノート</span>
          </span>
        </button>
        {notes?.map((note) => (
          <a key={note.id} className="book" href={href.note(note.id)}>
            <span className="book-cover">
              <span className="book-title">{note.title || '無題のノート'}</span>
            </span>
          </a>
        ))}
      </div>

      {notes && notes.length === 0 && (
        <p className="shelf-empty">「新しいノート」から最初のノートを作りましょう。</p>
      )}
    </div>
  )
}
