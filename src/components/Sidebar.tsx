import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { createNote } from '../db/repo'
import { href, navigate } from '../router'
import { APP_VERSION } from '../version'
import { Icon } from './Icon'

/** ノート一覧(PCは常に表示、タブレットは開閉式) */
export function Sidebar({ currentId, onNavigate }: { currentId?: string; onNavigate?: () => void }) {
  const notes = useLiveQuery(() => db.notes.orderBy('order').toArray(), [])

  const create = async () => {
    const note = await createNote()
    navigate(href.note(note.id))
    onNavigate?.()
  }

  return (
    <nav className="sidebar" aria-label="ノート一覧">
      <div className="sidebar-head">
        <a className="sidebar-app" href={href.shelf()} onClick={onNavigate}>
          めくりめくり
        </a>
        <a className="icon-btn" href={href.settings()} onClick={onNavigate} aria-label="設定" title="設定">
          <Icon name="settings" />
        </a>
      </div>
      <button className="sidebar-new" onClick={() => void create()}>
        <Icon name="plus" size={18} />
        新しいノート
      </button>
      <ul className="sidebar-list">
        {notes?.map((note) => (
          <li key={note.id}>
            <a
              className={`sidebar-item${note.id === currentId ? ' is-current' : ''}`}
              href={href.note(note.id)}
              onClick={onNavigate}
              aria-current={note.id === currentId ? 'page' : undefined}
            >
              {note.title || '無題のノート'}
            </a>
          </li>
        ))}
      </ul>
      <div className="sidebar-version">v{APP_VERSION}</div>
    </nav>
  )
}
