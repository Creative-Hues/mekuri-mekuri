import { useLiveQuery } from 'dexie-react-hooks'
import { createNote, getShelfNotes } from '../db/repo'
import { fullOrder, shelfSections } from '../shelf/order'
import { href, navigate } from '../router'
import { APP_VERSION } from '../version'
import { Icon } from './Icon'
import { openSearch } from '../search/openSearch'
import { withShortcut } from '../editor/shortcuts'

/** ノート一覧(PCは常に表示、タブレットは開閉式)。並びは本棚と同じ(お気に入りが先) */
export function Sidebar({ currentId, onNavigate }: { currentId?: string; onNavigate?: () => void }) {
  const notes = useLiveQuery(getShelfNotes, [])
  const byId = new Map((notes ?? []).map((n) => [n.id, n]))
  const ordered = fullOrder(shelfSections(notes ?? [])).map((id) => byId.get(id)!)

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
        <span className="sidebar-head-actions">
          <button
            className="icon-btn"
            onClick={() => {
              onNavigate?.()
              openSearch()
            }}
            aria-label="全ノート検索"
            title={withShortcut('全ノート検索', 'search')}
          >
            <Icon name="search" />
          </button>
          <a className="icon-btn" href={href.settings()} onClick={onNavigate} aria-label="設定" title="設定">
            <Icon name="settings" />
          </a>
        </span>
      </div>
      <button className="sidebar-new" onClick={() => void create()}>
        <Icon name="plus" size={18} />
        新しいノート
      </button>
      <ul className="sidebar-list">
        {ordered.map((note) => (
          <li key={note.id}>
            <a
              className={`sidebar-item${note.id === currentId ? ' is-current' : ''}`}
              href={href.note(note.id)}
              onClick={onNavigate}
              aria-current={note.id === currentId ? 'page' : undefined}
            >
              <span className="sidebar-item-title">{note.title || '無題のノート'}</span>
              {note.favorite && (
                <span className="sidebar-star" aria-label="お気に入り">
                  <Icon name="star" size={14} filled />
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
      <a className="sidebar-trash" href={href.trash()} onClick={onNavigate}>
        <Icon name="trash" size={18} />
        ゴミ箱
      </a>
      <div className="sidebar-version">v{APP_VERSION}</div>
    </nav>
  )
}
