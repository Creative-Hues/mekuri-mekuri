import { useEffect, useReducer, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { Editor } from '@tiptap/core'
import { Icon } from '../../components/Icon'
import { movableAt, movableBlocks, type Block } from '../../editor/blockMove'
import { blockAtPoint, findDropTarget, startBlockDrag } from './BlockDrag'
import type { NoteSession } from './session'

/** 行の左上からのハンドルの位置(px) */
interface Spot {
  pos: number
  top: number
  height: number
}

/** 行の画面上の位置(ページの中身の左上から) */
function spotOf(editor: Editor, block: Block, container: HTMLElement): Spot | null {
  const el = editor.view.nodeDOM(block.pos)
  if (!(el instanceof HTMLElement)) return null
  const r = el.getBoundingClientRect()
  // 閉じたトグル見出しの中など、見えていない行
  if (r.height === 0) return null
  const c = container.getBoundingClientRect()
  return { pos: block.pos, top: r.top - c.top, height: r.height }
}

/**
 * 行の移動のためのハンドルとチェック欄(ページ1枚分)。
 * - ふだん:PCはマウスを乗せた行、スマホはカーソルのある行の左にハンドルを出す
 *   ハンドルをドラッグで移動、長押しで選択モードへ
 * - 選択モード:すべての行の左にチェック欄。選んだ行のハンドルをドラッグすると、選んだ行すべてが動く
 * - 「ここへ移動」の待ち:タップした所へ選んだ行を移動する
 */
export function BlockHandles({
  session,
  pageId,
  containerRef,
  hoverMode,
}: {
  session: NoteSession
  pageId: string
  containerRef: RefObject<HTMLDivElement | null>
  /** マウスを乗せた行にハンドルを出すか(PC)。false ならカーソルのある行(スマホ) */
  hoverMode: boolean
}) {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  /**
   * PC:最後にマウスがあった画面上の位置。
   * 行の位置(番号)ではなくマウスの位置を覚えておき、描くたびにその下の行を探し直す
   * (番号で覚えると、行の移動や入力で番号がずれたり、スクロールでマウスの下の行が変わったりしたとき、
   *  マウスとは別の行にハンドルが出てしまうため)
   */
  const pointRef = useRef<{ x: number; y: number } | null>(null)
  /** ドラッグ中は、押したハンドルが消えないよう、ハンドルを出している行をそのままにする */
  const shownRef = useRef<number | null>(null)

  // 書式・内容・選択の変化や、紙の大きさの変化で描き直す
  useEffect(() => session.subscribe(rerender), [session])
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => rerender())
    ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef])

  // PC:マウスを乗せた行
  useEffect(() => {
    const el = containerRef.current
    if (!el || !hoverMode) return
    const dragging = () => document.body.classList.contains('is-block-dragging')
    const onMove = (e: MouseEvent) => {
      if (dragging()) return
      // ハンドルの上では、そのまま表示しておく
      if ((e.target as HTMLElement).closest('.block-handle')) return
      pointRef.current = { x: e.clientX, y: e.clientY }
      rerender()
    }
    const onLeave = () => {
      if (dragging()) return
      pointRef.current = null
      rerender()
    }
    // マウスを動かさずに紙をスクロールしたときも、マウスの下の行に合わせ直す
    const scroller = el.closest('.paper-scroll')
    const onScroll = () => rerender()
    el.addEventListener('mousemove', onMove)
    el.addEventListener('mouseleave', onLeave)
    scroller?.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('mousemove', onMove)
      el.removeEventListener('mouseleave', onLeave)
      scroller?.removeEventListener('scroll', onScroll)
    }
  }, [containerRef, hoverMode])

  const editor = session.getEditor(pageId)
  const container = containerRef.current
  if (!editor || editor.isDestroyed || !container) return null
  const doc = editor.state.doc
  const { active: selecting, placing } = session.select

  /** ハンドルを押したとき */
  const onHandleDown = (e: ReactPointerEvent, pos: number) => {
    e.preventDefault()
    e.stopPropagation()
    startBlockDrag({
      session,
      event: e,
      sources: () =>
        session.select.active ? session.selectedSources() : [{ pageId, positions: [pos] }],
      onLongPress: session.select.active
        ? undefined
        : () => {
            session.setSelectMode(true)
            session.toggleSelected(pageId, pos, true)
          },
      onMoved: () => {
        if (session.select.active) session.setSelectMode(false)
      },
    })
  }

  const handle = (spot: Spot, label: string) => (
    <button
      key={`h${spot.pos}`}
      type="button"
      className="block-handle drag-handle"
      style={{ top: spot.top }}
      aria-label={label}
      title={selecting ? 'ドラッグして移動' : 'ドラッグして移動・長押しで複数選択'}
      onPointerDown={(e) => onHandleDown(e, spot.pos)}
      onMouseDown={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Icon name="grip" size={18} />
    </button>
  )

  // ---- 選択モード ----
  if (selecting) {
    const spots = movableBlocks(doc)
      .map((b) => spotOf(editor, b, container))
      .filter((s): s is Spot => !!s)
    return (
      <>
        {spots.map((spot) => {
          const on = session.isSelected(pageId, spot.pos)
          return (
            <div key={spot.pos}>
              {on && <div className="block-selected" style={{ top: spot.top, height: spot.height }} />}
              <button
                type="button"
                className={`block-check${on ? ' is-on' : ''}`}
                style={{ top: spot.top }}
                role="checkbox"
                aria-checked={on}
                aria-label={on ? 'この行の選択を外す' : 'この行を選ぶ'}
                onClick={() => session.toggleSelected(pageId, spot.pos)}
              >
                {on && <Icon name="check" size={14} />}
              </button>
              {on && !placing && handle(spot, '選んだ行を移動')}
            </div>
          )
        })}
        {placing && <PlaceOverlay session={session} />}
      </>
    )
  }

  // ---- ふだん ----
  let pos: number | null = null
  if (hoverMode) {
    const point = pointRef.current
    if (document.body.classList.contains('is-block-dragging')) pos = shownRef.current
    else pos = point ? (blockAtPoint(editor, point.x, point.y)?.pos ?? null) : null
    shownRef.current = pos
  } else if (editor.isFocused && session.activePageId === pageId && !session.activeStickyId) {
    pos = movableAt(doc, editor.state.selection.from)?.pos ?? null
  }
  const block = pos !== null && pos < doc.content.size ? movableAt(doc, pos) : null
  const spot = block && block.pos === pos ? spotOf(editor, block, container) : null
  return spot ? handle(spot, 'この行を移動') : null
}

/** 「ここへ移動」:タップした所へ、選んだ行を移動する */
function PlaceOverlay({ session }: { session: NoteSession }) {
  const indicator = useRef<HTMLDivElement>(null)
  const show = (x: number, y: number) => {
    const target = findDropTarget(session, x, y, session.selectedSources())
    const el = indicator.current
    if (!el) return target
    el.hidden = !target
    if (target) {
      el.style.left = `${target.line.x}px`
      el.style.top = `${target.line.y}px`
      el.style.width = `${target.line.width}px`
    }
    return target
  }
  return (
    <div
      className="place-overlay"
      onPointerMove={(e) => show(e.clientX, e.clientY)}
      onPointerLeave={() => indicator.current && (indicator.current.hidden = true)}
      onClick={(e) => {
        const target = show(e.clientX, e.clientY)
        if (!target) return
        void session.moveBlocks(session.selectedSources(), target).then((ok) => {
          if (ok) session.setSelectMode(false)
        })
      }}
    >
      <div ref={indicator} className="drop-indicator" hidden />
    </div>
  )
}
