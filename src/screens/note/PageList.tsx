import { useEffect, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Page } from '../../db/db'
import { Icon } from '../../components/Icon'
import { previewLines, type PreviewLine } from '../../editor/preview'
import type { NoteSession } from './session'

/**
 * ページ一覧。≡ をドラッグして並び替える。
 * カードを押すとそのページへ移動、ゴミ箱で削除、最後の枠でページを追加
 */
export function PageList({
  pages,
  session,
  currentIndex,
  onClose,
  onShow,
  onDelete,
  onAdd,
  onReorder,
}: {
  pages: Page[]
  session: NoteSession
  currentIndex: number
  onClose: () => void
  onShow: (pageId: string) => void
  onDelete: (pageId: string) => void
  onAdd: () => void
  onReorder: (before: string[], after: string[]) => void
}) {
  // ドラッグを離した直後に一覧が古い並びに一瞬戻らないよう、手元でも並びを持つ
  const [ids, setIds] = useState(() => pages.map((p) => p.id))
  useEffect(() => setIds(pages.map((p) => p.id)), [pages])
  const byId = new Map(pages.map((p) => [p.id, p]))

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const before = ids
    const after = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))
    setIds(after)
    onReorder(before, after)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.dialog-backdrop')) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="page-list" role="dialog" aria-modal="true" aria-label="ページ一覧">
      <header className="page-list-header">
        <h2>ページ一覧</h2>
        <span className="page-list-hint">
          <Icon name="grip" size={16} />
          をドラッグして並び替え
        </span>
        <button className="icon-btn" onClick={onClose} aria-label="閉じる" title="閉じる">
          <Icon name="close" />
        </button>
      </header>
      <div className="page-list-scroll">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={rectSortingStrategy}>
            <ol className="page-grid">
              {ids.map((id, i) => {
                const page = byId.get(id)
                if (!page) return null
                return (
                  <PageCard
                    key={id}
                    id={id}
                    number={i + 1}
                    current={i === currentIndex}
                    lines={previewLines(session.initialContent(id, page.content))}
                    canDelete={ids.length > 1}
                    onShow={() => onShow(id)}
                    onDelete={() => onDelete(id)}
                  />
                )
              })}
              <li className="page-card page-card--add">
                <button className="page-card-add" onClick={onAdd}>
                  <Icon name="plus" size={24} />
                  <span>ページを追加</span>
                </button>
              </li>
            </ol>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  )
}

function PageCard(props: {
  id: string
  number: number
  current: boolean
  lines: PreviewLine[]
  canDelete: boolean
  onShow: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.id })

  return (
    <li
      ref={setNodeRef}
      className={`page-card${props.current ? ' is-current' : ''}${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <button className="page-card-body" onClick={props.onShow} aria-label={`${props.number}ページ目を開く`}>
        {props.lines.length === 0 ? (
          <span className="page-card-empty">(白紙)</span>
        ) : (
          props.lines.map((l, i) => (
            <span key={i} className={`page-card-line page-card-line--${l.kind}`}>
              {l.text}
            </span>
          ))
        )}
      </button>
      <div className="page-card-foot">
        <button
          ref={setActivatorNodeRef}
          className="drag-handle"
          aria-label={`${props.number}ページ目を移動`}
          title="ドラッグして並び替え"
          {...attributes}
          {...listeners}
        >
          <Icon name="grip" />
        </button>
        <span className="page-card-number">{props.number}</span>
        <button
          className="icon-btn page-card-delete"
          onClick={props.onDelete}
          disabled={!props.canDelete}
          aria-label={`${props.number}ページ目を削除`}
          title="このページを削除"
        >
          <Icon name="trash" size={18} />
        </button>
      </div>
    </li>
  )
}
