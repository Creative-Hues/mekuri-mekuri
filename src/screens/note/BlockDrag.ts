import type { Editor } from '@tiptap/core'
import { movableAt, type Block, type MoveSource } from '../../editor/blockMove'
import type { NoteSession } from './session'

/**
 * 行のドラッグ(ハンドルを押したまま動かす)。
 * HTML標準のドラッグはiPhoneで使えないので、Pointer Events で自作している。
 * - 差し込む位置に線を出す
 * - 紙の上下の端では自動でスクロールする
 * - 見開きでは、隣の紙の上に持っていくとそのページへ移動できる
 */

export interface DropTarget {
  pageId: string
  pos: number
  /** 差し込み線を出す位置(画面上の座標) */
  line: { x: number; y: number; width: number }
}

/** これ以上動かしたらドラッグ開始(px) */
const DRAG_START = 6
/** 長押しとみなす時間(ミリ秒) */
const LONG_PRESS = 500
/** 紙の端からこの範囲に来たら自動スクロール(px) */
const EDGE = 48

/**
 * 画面上の (x, y) にある行(ハンドルの表示と、落とす場所の判定の両方で使う)。
 * 左の余白(ハンドルの所)にいても、その高さの行を探せるよう、横位置は文字のある所に寄せる
 */
export function blockAtPoint(editor: Editor, x: number, y: number): Block | null {
  const view = editor.view
  const content = view.dom.getBoundingClientRect()
  const left = content.left + (parseFloat(getComputedStyle(view.dom).paddingLeft) || 0) + 4
  const hit = view.posAtCoords({
    left: Math.min(Math.max(x, left), content.right - 8),
    top: Math.min(Math.max(y, content.top + 1), content.bottom - 1),
  })
  if (!hit) return null
  // inside は「指している所を含む要素」の位置。行と行のすき間やリストの記号の上でも、
  // 次の行ではなく、その要素の行を選ぶために使う(なければ、文字の位置で探す)
  return movableAt(editor.state.doc, hit.inside >= 0 ? hit.inside : hit.pos)
}

/** 画面上の (x, y) に落としたときの移動先。落とせないところなら null */
export function findDropTarget(session: NoteSession, x: number, y: number, sources: MoveSource[]): DropTarget | null {
  for (const [pageId, editor] of session.pageEditors) {
    const scroller = editor.view.dom.closest('.paper-scroll')
    if (!scroller) continue
    const box = scroller.getBoundingClientRect()
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue

    const doc = editor.state.doc
    const last = editor.view.dom.lastElementChild?.getBoundingClientRect()
    // 最後の行より下:ページの末尾へ
    if (last && y > last.bottom) {
      return { pageId, pos: doc.content.size, line: { x: last.left, y: last.bottom + 2, width: last.width } }
    }
    const block = blockAtPoint(editor, x, y)
    if (!block) return null
    const el = editor.view.nodeDOM(block.pos)
    if (!(el instanceof HTMLElement)) return null
    const r = el.getBoundingClientRect()
    // トグル見出しやリストの項目は中身があって背が高いので、上の1行分で前後を決める
    const lineHeight = Math.min(r.height, parseFloat(getComputedStyle(el).lineHeight) || 28)
    const before = y < r.top + (r.height > lineHeight * 1.5 ? lineHeight : r.height) / 2
    const pos = before ? block.pos : block.pos + block.node.nodeSize

    // 動かす行の中には落とせない
    for (const src of sources) {
      if (src.pageId !== pageId) continue
      for (const p of src.positions) {
        const node = doc.nodeAt(p)
        if (node && pos > p && pos < p + node.nodeSize) return null
      }
    }
    return { pageId, pos, line: { x: r.left, y: before ? r.top - 1 : r.bottom + 1, width: r.width } }
  }
  return null
}

/** 差し込み線(画面に1本だけ) */
function createIndicator(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'drop-indicator'
  el.hidden = true
  document.body.append(el)
  return el
}

function showIndicator(el: HTMLDivElement, target: DropTarget | null) {
  if (!target) {
    el.hidden = true
    return
  }
  el.hidden = false
  el.style.left = `${target.line.x}px`
  el.style.top = `${target.line.y}px`
  el.style.width = `${target.line.width}px`
}

/** 指・マウスの近くに出す「◯行を移動」の札 */
function createGhost(label: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'drag-ghost'
  el.textContent = label
  document.body.append(el)
  return el
}

/**
 * ハンドルを押したときに呼ぶ。動かしたらドラッグ、動かさずに長押ししたら onLongPress
 */
export function startBlockDrag(opts: {
  session: NoteSession
  event: Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerId'>
  sources: () => MoveSource[]
  onLongPress?: () => void
  onMoved?: () => void
}) {
  const { session, event } = opts
  const startX = event.clientX
  const startY = event.clientY
  const pointerId = event.pointerId
  let dragging = false
  let sources: MoveSource[] = []
  let target: DropTarget | null = null
  let x = startX
  let y = startY
  let indicator: HTMLDivElement | null = null
  let ghost: HTMLDivElement | null = null
  let frame = 0

  const longPress = opts.onLongPress
    ? setTimeout(() => {
        if (dragging) return
        cleanup()
        opts.onLongPress?.()
      }, LONG_PRESS)
    : null

  // 紙の端にいる間、少しずつスクロールする
  const autoScroll = () => {
    frame = 0
    if (!dragging) return
    for (const [, editor] of session.pageEditors) {
      const scroller = editor.view.dom.closest('.paper-scroll')
      if (!scroller) continue
      const box = scroller.getBoundingClientRect()
      if (x < box.left || x > box.right) continue
      let dy = 0
      if (y < box.top + EDGE) dy = -Math.ceil((box.top + EDGE - y) / 4)
      else if (y > box.bottom - EDGE) dy = Math.ceil((y - (box.bottom - EDGE)) / 4)
      if (dy) {
        scroller.scrollTop += dy
        update()
        frame = requestAnimationFrame(autoScroll)
      }
      return
    }
  }

  const update = () => {
    target = findDropTarget(session, x, y, sources)
    if (indicator) showIndicator(indicator, target)
    if (ghost) ghost.style.transform = `translate(${x + 14}px, ${y + 14}px)`
  }

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return
    x = e.clientX
    y = e.clientY
    if (!dragging) {
      if (Math.hypot(x - startX, y - startY) < DRAG_START) return
      dragging = true
      if (longPress) clearTimeout(longPress)
      sources = opts.sources()
      const count = sources.reduce((n, s) => n + s.positions.length, 0)
      indicator = createIndicator()
      ghost = createGhost(`${count}行を移動`)
      document.body.classList.add('is-block-dragging')
    }
    e.preventDefault()
    update()
    if (!frame) frame = requestAnimationFrame(autoScroll)
  }

  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return
    const wasDragging = dragging
    const drop = target
    cleanup()
    if (wasDragging && drop) {
      void session.moveBlocks(sources, { pageId: drop.pageId, pos: drop.pos }).then((ok) => {
        if (ok) opts.onMoved?.()
      })
    }
  }

  const onCancel = (e: PointerEvent) => {
    if (e.pointerId === pointerId) cleanup()
  }

  function cleanup() {
    if (longPress) clearTimeout(longPress)
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    dragging = false
    indicator?.remove()
    ghost?.remove()
    indicator = ghost = null
    document.body.classList.remove('is-block-dragging')
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
  }

  window.addEventListener('pointermove', onMove, { passive: false })
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
}
