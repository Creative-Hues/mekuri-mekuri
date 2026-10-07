import { useEffect, useMemo, useReducer, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Note } from '../db/db'
import { createNote, getShelfNotes, setFavorite, setNoteOrder } from '../db/repo'
import { shelfHistory } from '../history/shelfHistory'
import { fullOrder, moveInSection, shelfSections, type SectionName, type ShelfSections } from '../shelf/order'
import { matchShortcut } from '../editor/shortcuts'
import { href, navigate } from '../router'
import { Icon } from '../components/Icon'
import { Cover } from '../components/Cover'
import { openSearch } from '../search/openSearch'
import { ButtonTips } from '../help/ButtonTips'
import { useLayoutMode } from '../layout/useLayoutMode'
import { ShelfHeaderButton, shelfButtonAttrs } from './shelfButtons'
import { ShelfHelp } from './ShelfHelp'
import { useFileImport } from './FileImport'

/** 入力欄の中にいるか(本棚の Ctrl+Z を横取りしないため) */
const isEditing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

/** 本棚:ノートを表紙で並べる。お気に入りは上の段。≡ をドラッグして段の中で並び替える */
export function Bookshelf() {
  const notes = useLiveQuery(getShelfNotes, [])
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => shelfHistory.subscribe(rerender), [])

  // ドラッグを離した直後に古い並びに一瞬戻らないよう、手元でも並びを持つ
  const [local, setLocal] = useState<ShelfSections | null>(null)
  useEffect(() => setLocal(null), [notes])
  const sections = useMemo(() => local ?? shelfSections(notes ?? []), [local, notes])
  const byId = useMemo(() => new Map((notes ?? []).map((n) => [n.id, n])), [notes])
  const layout = useLayoutMode()
  const [helpOpen, setHelpOpen] = useState(false)
  const fileImport = useFileImport()

  // 元に戻す/やり直し(Ctrl+Z / Ctrl+Shift+Z、Macは⌘)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.dialog-backdrop') || isEditing(e.target)) return
      const id = matchShortcut(e)
      if (id === 'undo' || id === 'redo') {
        e.preventDefault()
        void shelfHistory[id]()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const create = async () => {
    const note = await createNote()
    navigate(href.note(note.id))
  }

  const reorder = async (activeId: string, overId: string) => {
    const next = moveInSection(sections, activeId, overId)
    if (!next) return
    setLocal(next)
    const before = fullOrder(sections)
    const after = fullOrder(next)
    await setNoteOrder(after)
    shelfHistory.record({ kind: 'order', before, after })
  }

  const toggleFavorite = async (note: Note) => {
    await setFavorite(note.id, !note.favorite)
    shelfHistory.record({ kind: 'favorite', noteId: note.id, before: note.favorite, after: !note.favorite })
  }

  const hasFavorites = sections.favorites.length > 0

  return (
    <div className="shelf">
      <header className="shelf-header">
        <h1 className="app-title">めくりめくり</h1>
        {/* ボタンの名前・説明は shelfButtons.tsx の一覧から(ヘルプと同じ情報) */}
        <div className="shelf-actions">
          <ShelfHeaderButton btn="undo" onClick={() => void shelfHistory.undo()} disabled={!shelfHistory.canUndo()} />
          <ShelfHeaderButton btn="redo" onClick={() => void shelfHistory.redo()} disabled={!shelfHistory.canRedo()} />
          <ShelfHeaderButton btn="search" onClick={openSearch} />
          <ShelfHeaderButton btn="trash" href={href.trash()} />
          <ShelfHeaderButton btn="settings" href={href.settings()} />
          <ShelfHeaderButton btn="help" onClick={() => setHelpOpen(true)} />
        </div>
      </header>

      {/* マウスを乗せた・長押ししたボタンの名前 */}
      <ButtonTips scope=".shelf" />

      {/* ファイルの読み込み(選ぶ画面・ドロップの案内・読み込み中の表示) */}
      {fileImport.elements}

      {helpOpen && (
        // 本棚はスクロールするので、ヘルプは画面に固定した枠の中に出す
        <div className="overlay-fixed">
          <ShelfHelp side={layout.toolbarTop} mouse={layout.toolbarTop} onClose={() => setHelpOpen(false)} />
        </div>
      )}

      {hasFavorites && (
        <section className="shelf-section" aria-label="お気に入り">
          <h2 className="shelf-label">
            <Icon name="star" size={16} filled />
            お気に入り
          </h2>
          <ShelfRow
            section="favorites"
            ids={sections.favorites}
            byId={byId}
            onReorder={(a, o) => void reorder(a, o)}
            onFavorite={(n) => void toggleFavorite(n)}
          />
        </section>
      )}

      <section className="shelf-section" aria-label="ノート">
        {hasFavorites && <h2 className="shelf-label">ノート</h2>}
        <ShelfRow
          section="others"
          ids={sections.others}
          byId={byId}
          onReorder={(a, o) => void reorder(a, o)}
          onFavorite={(n) => void toggleFavorite(n)}
          first={
            <>
              <li className="shelf-item">
                <button className="book book--new" onClick={() => void create()} {...shelfButtonAttrs('newNote')}>
                  <span className="book-new-inner">
                    <Icon name="plus" size={28} />
                    <span>新しいノート</span>
                  </span>
                </button>
              </li>
              <li className="shelf-item">
                <button
                  className="book book--new"
                  onClick={fileImport.open}
                  disabled={fileImport.busy}
                  {...shelfButtonAttrs('importFile')}
                >
                  <span className="book-new-inner">
                    <Icon name="upload" size={28} />
                    <span>ファイルから<br />読み込む</span>
                  </span>
                </button>
              </li>
            </>
          }
        />
      </section>

      {notes && notes.length === 0 && (
        <p className="shelf-empty">「新しいノート」から最初のノートを作りましょう。テキスト・Markdown・Word のファイルは「ファイルから読み込む」でノートにできます。</p>
      )}
    </div>
  )
}

/** 本棚の1段(お気に入り/通常)。段の中だけで並び替える */
function ShelfRow({
  section,
  ids,
  byId,
  onReorder,
  onFavorite,
  first,
}: {
  section: SectionName
  ids: string[]
  byId: Map<string, Note>
  onReorder: (activeId: string, overId: string) => void
  onFavorite: (note: Note) => void
  first?: ReactNode
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) onReorder(String(active.id), String(over.id))
  }
  return (
    <DndContext id={`shelf-${section}`} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <ol className="shelf-grid">
          {first}
          {ids.map((id) => {
            const note = byId.get(id)
            return note ? <BookItem key={id} note={note} onFavorite={() => onFavorite(note)} /> : null
          })}
        </ol>
      </SortableContext>
    </DndContext>
  )
}

function BookItem({ note, onFavorite }: { note: Note; onFavorite: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: note.id })
  const title = note.title || '無題のノート'
  return (
    <li
      ref={setNodeRef}
      className={`shelf-item${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <a className="book" href={href.note(note.id)} aria-label={`「${title}」を開く`} {...shelfButtonAttrs('openNote')}>
        <Cover title={note.title} design={note.design} />
      </a>
      <div className="book-foot">
        <button
          ref={setActivatorNodeRef}
          className="drag-handle"
          {...shelfButtonAttrs('reorder')}
          aria-label={`「${title}」を移動`}
          title="ドラッグして並び替え"
          {...attributes}
          {...listeners}
        >
          <Icon name="grip" />
        </button>
        <button
          className={`book-star${note.favorite ? ' is-on' : ''}`}
          {...shelfButtonAttrs('favorite')}
          onClick={onFavorite}
          aria-pressed={note.favorite}
          aria-label={note.favorite ? `「${title}」をお気に入りから外す` : `「${title}」をお気に入りにする`}
          title={note.favorite ? 'お気に入りから外す' : 'お気に入りにする'}
        >
          <Icon name="star" size={18} filled={note.favorite} />
        </button>
      </div>
    </li>
  )
}
