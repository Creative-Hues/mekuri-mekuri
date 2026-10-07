import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { Icon } from '../../components/Icon'
import { MARKER_COLORS, type MarkerColorName } from '../../editor/palette'
import { CELL_MENU_EVENT, selectCell, setCellBackground, type CellMenuDetail } from '../../editor/table'
import type { NoteSession } from './session'

/**
 * 表のセルのメニュー(セルを長押し・右クリック・ツールバーの「表」ボタン)。
 * 背景色・行/列の挿入と削除・表の削除
 */
export function TableMenu({ session }: { session: NoteSession }) {
  const [menu, setMenu] = useState<CellMenuDetail | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  /** 開いた時刻(開いた直後のタップでは閉じないようにする) */
  const openedAt = useRef(0)

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<CellMenuDetail>).detail
      // メニューの「挿入・削除」は、カーソルのあるセルを基準にするので、カーソルをそのセルに置く
      selectCell(detail.editor, detail.cellPos)
      openedAt.current = Date.now()
      setMenu(detail)
    }
    window.addEventListener(CELL_MENU_EVENT, onOpen)
    return () => window.removeEventListener(CELL_MENU_EVENT, onOpen)
  }, [])

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu])

  // 画面からはみ出さない位置に出す
  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const margin = 8
    setPos({
      left: Math.max(margin, Math.min(menu.x, window.innerWidth - r.width - margin)),
      top: Math.max(margin, Math.min(menu.y + 8, window.innerHeight - r.height - margin)),
    })
  }, [menu])

  if (!menu || menu.editor.isDestroyed) return null
  const editor = menu.editor
  const can = editor.can()

  /** 操作は1回の「元に戻す」で戻せるよう、前後の入力と分ける */
  const run = (fn: (e: Editor) => void) => {
    session.history.closeGroup()
    selectCell(editor, menu.cellPos)
    fn(editor)
    session.history.closeGroup()
    setMenu(null)
  }
  const setBg = (color: MarkerColorName | null) =>
    run((e) => {
      const tr = e.state.tr
      if (setCellBackground(tr, menu.cellPos, color)) e.view.dispatch(tr)
    })
  const current = editor.state.doc.nodeAt(menu.cellPos)?.attrs.bg as string | null | undefined

  return (
    <>
      <div
        className="popover-backdrop"
        onClick={() => {
          if (Date.now() - openedAt.current > 400) setMenu(null)
        }}
      />
      <div ref={ref} className="popover table-menu" role="menu" style={pos}>
        <div className="popover-label">セルの色</div>
        <div className="swatches">
          <button
            className={`swatch${!current ? ' is-selected' : ''}`}
            aria-label="色なし"
            title="色なし"
            onClick={() => setBg(null)}
          >
            <Icon name="none" size={18} />
          </button>
          {MARKER_COLORS.map((c) => (
            <button
              key={c.name}
              className={`swatch${current === c.name ? ' is-selected' : ''}`}
              aria-label={c.label}
              title={c.label}
              onClick={() => setBg(c.name)}
            >
              <span className="swatch-fill" style={{ background: `var(--mk-${c.name})` }} />
            </button>
          ))}
        </div>
        <div className="popover-label">行</div>
        <div className="popover-row">
          <button onClick={() => run((e) => e.commands.addRowBefore())}>上に挿入</button>
          <button onClick={() => run((e) => e.commands.addRowAfter())}>下に挿入</button>
          <button className="is-danger" disabled={!can.deleteRow()} onClick={() => run((e) => e.commands.deleteRow())}>
            削除
          </button>
        </div>
        <div className="popover-label">列</div>
        <div className="popover-row">
          <button onClick={() => run((e) => e.commands.addColumnBefore())}>左に挿入</button>
          <button onClick={() => run((e) => e.commands.addColumnAfter())}>右に挿入</button>
          <button
            className="is-danger"
            disabled={!can.deleteColumn()}
            onClick={() => run((e) => e.commands.deleteColumn())}
          >
            削除
          </button>
        </div>
        <button className="popover-wide is-danger" onClick={() => run((e) => e.commands.deleteTable())}>
          <Icon name="trash" size={18} />
          表を削除
        </button>
      </div>
    </>
  )
}
