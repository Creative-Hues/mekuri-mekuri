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
import { createNote, getShelfNotes, setFavorite, setFavorites, setNoteOrder, trashNotes } from '../db/repo'
import { shelfHistory } from '../history/shelfHistory'
import { fullOrder, moveInSection, shelfSections, type SectionName, type ShelfSections } from '../shelf/order'
import { matchShortcut } from '../editor/shortcuts'
import { href, navigate } from '../router'
import { Icon } from '../components/Icon'
import { Cover } from '../components/Cover'
import { useDialog } from '../components/Dialog'
import { showToast } from '../components/Toast'
import { openSearch } from '../search/openSearch'
import { ButtonTips } from '../help/ButtonTips'
import { useLayoutMode } from '../layout/useLayoutMode'
import { loadExportSource, type ExportSource } from '../export/load'
import { exportNotesFile } from '../export/exportNote'
import { chooseExportFormat, showExportNotices } from '../export/chooseFormat'
import { PrintView } from '../export/PrintView'
import { ShelfHeaderButton, ShelfSelectButton, shelfButtonAttrs } from './shelfButtons'
import { ShelfHelp } from './ShelfHelp'
import { useFileImport } from './FileImport'

/** 入力欄の中にいるか(本棚の Ctrl+Z を横取りしないため) */
const isEditing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

/**
 * 本棚:ノートを表紙で並べる。お気に入りは上の段。≡ をドラッグして段の中で並び替える。
 * 「選ぶ」を押すと選ぶモード:表紙を押して複数のノートを選び、下の帯からまとめて操作する
 * (選ぶモードの間は ≡・星を隠し、表紙を押してもノートは開かない)
 */
export function Bookshelf() {
  const notes = useLiveQuery(getShelfNotes, [])
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => shelfHistory.subscribe(rerender), [])
  const dialog = useDialog()

  // ドラッグを離した直後に古い並びに一瞬戻らないよう、手元でも並びを持つ
  const [local, setLocal] = useState<ShelfSections | null>(null)
  useEffect(() => setLocal(null), [notes])
  const sections = useMemo(() => local ?? shelfSections(notes ?? []), [local, notes])
  const byId = useMemo(() => new Map((notes ?? []).map((n) => [n.id, n])), [notes])
  const layout = useLayoutMode()
  const [helpOpen, setHelpOpen] = useState(false)
  const fileImport = useFileImport()

  // ---- 選ぶモード ----
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  // 本棚にもうないノート(ほかの画面でゴミ箱に入れたなど)は、選んだものから外す
  const picked = useMemo(() => [...selected].filter((id) => byId.has(id)), [selected, byId])
  const pickedNotes = picked.map((id) => byId.get(id)!)
  const allIds = fullOrder(sections)
  const allPicked = allIds.length > 0 && picked.length === allIds.length

  const startSelect = () => {
    setSelected(new Set())
    setSelecting(true)
  }
  const endSelect = () => {
    setSelecting(false)
    setSelected(new Set())
  }
  const togglePick = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // 元に戻す/やり直し(Ctrl+Z / Ctrl+Shift+Z、Macは⌘)・選ぶモードを Esc で終える
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.dialog-backdrop') || isEditing(e.target)) return
      if (e.key === 'Escape' && selecting && !document.querySelector('.overlay-fixed')) {
        endSelect()
        return
      }
      const id = matchShortcut(e)
      if (id === 'undo' || id === 'redo') {
        e.preventDefault()
        void shelfHistory[id]()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selecting])

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

  // ---- まとめての操作 ----

  /** 選んだノートのお気に入りをまとめて付ける/外す */
  const favoriteAll = async (on: boolean) => {
    const before = Object.fromEntries(pickedNotes.map((n) => [n.id, n.favorite]))
    const after = Object.fromEntries(pickedNotes.map((n) => [n.id, on]))
    await setFavorites(after)
    shelfHistory.record({ kind: 'favorites', before, after })
    showToast(on ? `${picked.length}冊をお気に入りにしました` : `${picked.length}冊をお気に入りから外しました`)
  }

  /** 選んだノートをまとめてゴミ箱へ */
  const trashAll = async () => {
    const count = picked.length
    const ok = await dialog.confirm({
      title: 'ノートを削除',
      message: `選んだ${count}冊のノートをゴミ箱に移しますか？30日以内なら、ゴミ箱や本棚の「元に戻す」から戻せます。`,
      okLabel: 'ゴミ箱に移す',
      danger: true,
    })
    if (!ok) return
    const at = Date.now()
    await trashNotes(picked, at)
    shelfHistory.record({ kind: 'trash', noteIds: picked, at })
    endSelect()
    showToast(`${count}冊をゴミ箱に移しました`)
  }

  // PDF(まとめての印刷)
  const [printJob, setPrintJob] = useState<{ sources: ExportSource[]; job: number; pageNumbers: boolean } | null>(null)

  /** 選んだノートをまとめて書き出す */
  const exportAll = async () => {
    const choice = await chooseExportFormat(dialog, picked.length)
    if (!choice) return
    setBusy(true)
    try {
      const sources = (await Promise.all(allIds.filter((id) => selected.has(id)).map(loadExportSource))).filter(
        (s): s is ExportSource => !!s,
      )
      if (sources.length === 0) return
      if (choice.format === 'pdf') {
        setPrintJob((prev) => ({ sources, job: (prev?.job ?? 0) + 1, pageNumbers: choice.pageNumbers }))
        return
      }
      const notices = await exportNotesFile(sources, choice.format)
      await showExportNotices(dialog, choice.format, notices)
    } catch (e) {
      console.error(e)
      await dialog.alert({ message: '書き出しに失敗しました。' })
    } finally {
      setBusy(false)
    }
  }

  const hasFavorites = sections.favorites.length > 0
  const pickedAllFavorite = pickedNotes.length > 0 && pickedNotes.every((n) => n.favorite)
  const none = picked.length === 0

  return (
    <div className={`shelf${selecting ? ' is-selecting' : ''}`}>
      <header className="shelf-header">
        <h1 className="app-title">めくりめくり</h1>
        {/* ボタンの名前・説明は shelfButtons.tsx の一覧から(ヘルプと同じ情報) */}
        <div className="shelf-actions">
          <ShelfHeaderButton btn="undo" onClick={() => void shelfHistory.undo()} disabled={!shelfHistory.canUndo()} />
          <ShelfHeaderButton btn="redo" onClick={() => void shelfHistory.redo()} disabled={!shelfHistory.canRedo()} />
          <ShelfHeaderButton
            btn="select"
            onClick={selecting ? endSelect : startSelect}
            pressed={selecting}
            disabled={!selecting && allIds.length === 0}
          />
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

      {selecting && (
        <p className="shelf-select-hint" role="status">
          {none ? 'まとめて操作するノートの表紙を押して選んでください。' : `${picked.length}冊を選んでいます`}
        </p>
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
            selecting={selecting}
            selected={selected}
            onPick={togglePick}
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
          selecting={selecting}
          selected={selected}
          onPick={togglePick}
          onReorder={(a, o) => void reorder(a, o)}
          onFavorite={(n) => void toggleFavorite(n)}
          first={
            // 選ぶモードの間は、新しいノート・読み込みは出さない(押し間違えないように)
            !selecting && (
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
            )
          }
        />
      </section>

      {notes && notes.length === 0 && (
        <p className="shelf-empty">「新しいノート」から最初のノートを作りましょう。テキスト・Markdown・Word のファイルは「ファイルから読み込む」でノートにできます。</p>
      )}

      {/* 選ぶモードの帯(画面の下に固定) */}
      {selecting && (
        <div className="select-bar" role="toolbar" aria-label="選んだノートの操作">
          <span className="select-bar-count">{picked.length}冊</span>
          <div className="select-bar-buttons">
            <ShelfSelectButton
              select="selectAll"
              label={allPicked ? '選ぶのをやめる' : undefined}
              onClick={() => setSelected(allPicked ? new Set() : new Set(allIds))}
            />
            {pickedAllFavorite ? null : <ShelfSelectButton select="favoriteOn" onClick={() => void favoriteAll(true)} disabled={none} />}
            {pickedNotes.some((n) => n.favorite) && (
              <ShelfSelectButton select="favoriteOff" onClick={() => void favoriteAll(false)} disabled={none} />
            )}
            <ShelfSelectButton select="exportNotes" onClick={() => void exportAll()} disabled={none || busy} />
            <ShelfSelectButton select="trashNotes" onClick={() => void trashAll()} disabled={none} danger />
            <ShelfSelectButton select="done" onClick={endSelect} />
          </div>
        </div>
      )}

      {printJob && <PrintView sources={printJob.sources} job={printJob.job} pageNumbers={printJob.pageNumbers} />}
    </div>
  )
}

/** 本棚の1段(お気に入り/通常)。段の中だけで並び替える */
function ShelfRow({
  section,
  ids,
  byId,
  selecting,
  selected,
  onPick,
  onReorder,
  onFavorite,
  first,
}: {
  section: SectionName
  ids: string[]
  byId: Map<string, Note>
  selecting: boolean
  selected: Set<string>
  onPick: (id: string) => void
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
      <SortableContext items={ids} strategy={rectSortingStrategy} disabled={selecting}>
        <ol className="shelf-grid">
          {first}
          {ids.map((id) => {
            const note = byId.get(id)
            return note ? (
              <BookItem
                key={id}
                note={note}
                selecting={selecting}
                picked={selected.has(id)}
                onPick={() => onPick(id)}
                onFavorite={() => onFavorite(note)}
              />
            ) : null
          })}
        </ol>
      </SortableContext>
    </DndContext>
  )
}

function BookItem({
  note,
  selecting,
  picked,
  onPick,
  onFavorite,
}: {
  note: Note
  selecting: boolean
  picked: boolean
  onPick: () => void
  onFavorite: () => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: note.id, disabled: selecting })
  const title = note.title || '無題のノート'
  return (
    <li
      ref={setNodeRef}
      className={`shelf-item${isDragging ? ' is-dragging' : ''}${picked ? ' is-picked' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {!selecting ? (
        <a className="book" href={href.note(note.id)} aria-label={`「${title}」を開く`} {...shelfButtonAttrs('openNote')}>
          <Cover title={note.title} design={note.design} />
        </a>
      ) : (
        // 選ぶモード:表紙を押すと選ぶ/外す(ノートは開かない)
        <button
          type="button"
          className="book book--pick"
          role="checkbox"
          aria-checked={picked}
          aria-label={`「${title}」を選ぶ`}
          onClick={onPick}
          {...shelfButtonAttrs('selectNote')}
        >
          <Cover title={note.title} design={note.design} />
          <span className="book-check" aria-hidden="true">
            {picked && <Icon name="check" size={16} />}
          </span>
        </button>
      )}
      <div className="book-foot" aria-hidden={selecting}>
        <button
          ref={setActivatorNodeRef}
          className="drag-handle"
          {...shelfButtonAttrs('reorder')}
          aria-label={`「${title}」を移動`}
          title="ドラッグして並び替え"
          {...attributes}
          {...listeners}
          // 選ぶモードの間は隠すので、キーボードでも移らないようにする
          tabIndex={selecting ? -1 : attributes.tabIndex}
        >
          <Icon name="grip" />
        </button>
        <button
          className={`book-star${note.favorite ? ' is-on' : ''}`}
          {...shelfButtonAttrs('favorite')}
          onClick={onFavorite}
          tabIndex={selecting ? -1 : undefined}
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
