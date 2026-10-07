import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Command } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { Icon } from '../../components/Icon'
import { MARKER_COLORS } from '../../editor/palette'
import { TABLE_MENU_EVENT, type TableMenuDetail } from '../../editor/table'
import {
  clearCells,
  deleteLine,
  duplicateLine,
  insertLine,
  lineIsSimple,
  mergeSelectedCells,
  selectedCellPositions,
  setCellsAlign,
  setCellsBackground,
  setHeader,
  splitSelectedCell,
  tableAt,
  tablePosOfCell,
  type CellAlign,
} from '../../editor/tableOps'
import type { NoteSession } from './session'

const ALIGNS: { value: CellAlign; label: string }[] = [
  { value: 'left', label: '左' },
  { value: 'center', label: '中央' },
  { value: 'right', label: '右' },
]

/**
 * 表のメニュー。
 * - 行・列のつまみを押したとき:その行・列の 挿入・複製・削除・(1行目・1列目なら)見出し、と色・配置
 * - セル(PC の右クリック・ツールバーの「表」ボタン・丸いつまみで範囲を選んだあと):
 *   選んだセルの 色・配置・結合/分割・中身を消す、表の見出し・表の削除
 * 操作は1回の「元に戻す」で戻るよう、前後の入力と分ける
 */
export function TableMenu({ session }: { session: NoteSession }) {
  const [menu, setMenu] = useState<TableMenuDetail | null>(null)
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  /** 開いた時刻(開いた直後のタップでは閉じないようにする) */
  const openedAt = useRef(0)

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<TableMenuDetail>).detail
      const { editor, cellPos } = detail
      // 右クリックしたセルが、選んでいる範囲の外なら、そのセルにカーソルを移す
      if (detail.kind === 'cell' && cellPos !== null && !selectedCellPositions(editor.state).includes(cellPos)) {
        editor.commands.setTextSelection(Math.min(cellPos + 2, editor.state.doc.content.size))
      }
      openedAt.current = Date.now()
      setMenu(detail)
    }
    window.addEventListener(TABLE_MENU_EVENT, onOpen)
    return () => window.removeEventListener(TABLE_MENU_EVENT, onOpen)
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
  const state = editor.state
  const table = tableAt(state.doc, menu.tablePos)
  if (!table) return null

  /** 操作して閉じる(keep:閉じずに続けて選べる操作。色・配置) */
  const run = (cmd: Command, keep = false) => {
    session.history.closeGroup()
    cmd(editor.state, editor.view.dispatch)
    session.history.closeGroup()
    if (keep) rerender()
    else setMenu(null)
  }
  const can = (cmd: Command) => cmd(state)

  const cells = selectedCellPositions(state)
  const first = cells.length > 0 ? state.doc.nodeAt(cells[0]) : null
  const allSame = (key: string) =>
    first && cells.every((p) => (state.doc.nodeAt(p)?.attrs[key] ?? null) === (first.attrs[key] ?? null))
  const currentBg = allSame('bg') ? ((first?.attrs.bg as string | null) ?? null) : undefined
  const currentAlign = allSame('align') ? ((first?.attrs.align as string | null) ?? 'left') : undefined
  const isRange = state.selection instanceof CellSelection && cells.length > 1

  const { kind, index } = menu
  const isLine = kind === 'row' || kind === 'col'
  const lineName = kind === 'row' ? '行' : '列'
  const headerRow = !!table.node.attrs.headerRow
  const headerColumn = !!table.node.attrs.headerColumn

  return (
    <>
      <div
        className="popover-backdrop"
        onClick={() => {
          if (Date.now() - openedAt.current > 400) setMenu(null)
        }}
      />
      <div ref={ref} className="popover table-menu" role="menu" style={pos}>
        {isLine && (
          <>
            <div className="popover-label">
              {index + 1}
              {kind === 'row' ? '行目' : '列目'}
            </div>
            <div className="popover-row">
              <button onClick={() => run(insertLine(menu.tablePos, kind, index, 'before'))}>
                {kind === 'row' ? '上に挿入' : '左に挿入'}
              </button>
              <button onClick={() => run(insertLine(menu.tablePos, kind, index, 'after'))}>
                {kind === 'row' ? '下に挿入' : '右に挿入'}
              </button>
            </div>
            <div className="popover-row">
              <button
                disabled={!lineIsSimple(table, kind, index)}
                title={lineIsSimple(table, kind, index) ? undefined : `結合したセルのある${lineName}は複製できません`}
                onClick={() => run(duplicateLine(menu.tablePos, kind, index))}
              >
                複製
              </button>
              <button
                className="is-danger"
                disabled={!can(deleteLine(menu.tablePos, kind, index))}
                onClick={() => run(deleteLine(menu.tablePos, kind, index))}
              >
                <Icon name="trash" size={16} />
                削除
              </button>
            </div>
            {index === 0 && (
              <HeaderToggle
                label={kind === 'row' ? '1行目を見出しにする' : '1列目を見出しにする'}
                on={kind === 'row' ? headerRow : headerColumn}
                onChange={(on) => run(setHeader(menu.tablePos, kind, on), true)}
              />
            )}
          </>
        )}

        <div className="popover-label">{isLine ? `この${lineName}のセルの色` : isRange ? '選んだセルの色' : 'セルの色'}</div>
        <div className="swatches">
          <button
            className={`swatch${currentBg === null ? ' is-selected' : ''}`}
            aria-label="色なし"
            title="色なし"
            onClick={() => run(setCellsBackground(null), true)}
          >
            <Icon name="none" size={18} />
          </button>
          {MARKER_COLORS.map((c) => (
            <button
              key={c.name}
              className={`swatch${currentBg === c.name ? ' is-selected' : ''}`}
              aria-label={c.label}
              title={c.label}
              onClick={() => run(setCellsBackground(c.name), true)}
            >
              <span className="swatch-fill" style={{ background: `var(--mk-${c.name})` }} />
            </button>
          ))}
        </div>

        <div className="popover-label">文字の配置</div>
        <div className="popover-row" role="radiogroup" aria-label="文字の配置">
          {ALIGNS.map((a) => (
            <button
              key={a.value}
              role="radio"
              aria-checked={currentAlign === a.value}
              className={currentAlign === a.value ? 'is-on' : ''}
              onClick={() => run(setCellsAlign(a.value), true)}
            >
              {a.label}
            </button>
          ))}
        </div>

        {!isLine && (
          <>
            {(can(mergeSelectedCells) || can(splitSelectedCell) || isRange) && (
              <>
                <div className="popover-label">セル</div>
                <div className="popover-row">
                  {can(mergeSelectedCells) && <button onClick={() => run(mergeSelectedCells)}>結合</button>}
                  {can(splitSelectedCell) && <button onClick={() => run(splitSelectedCell)}>分割</button>}
                  {isRange && <button onClick={() => run(clearCells)}>中身を消す</button>}
                </div>
              </>
            )}
            <div className="popover-label">見出し</div>
            <HeaderToggle
              label="1行目を見出しにする"
              on={headerRow}
              onChange={(on) => run(setHeader(menu.tablePos, 'row', on), true)}
            />
            <HeaderToggle
              label="1列目を見出しにする"
              on={headerColumn}
              onChange={(on) => run(setHeader(menu.tablePos, 'col', on), true)}
            />
            <button
              className="popover-wide is-danger"
              onClick={() =>
                run((s, d) => {
                  const node = s.doc.nodeAt(menu.tablePos)
                  if (!node) return false
                  d?.(s.tr.delete(menu.tablePos, menu.tablePos + node.nodeSize))
                  return true
                })
              }
            >
              <Icon name="trash" size={18} />
              表を削除
            </button>
          </>
        )}
      </div>
    </>
  )
}

function HeaderToggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`popover-wide table-menu-toggle${on ? ' is-on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <span className="table-menu-check">{on && <Icon name="check" size={14} />}</span>
      {label}
    </button>
  )
}

/** ツールバーの「表」ボタン:カーソル(または選んだ範囲)のセルのメニューを出す */
export function openCellMenuAtSelection(editor: Editor) {
  const { state, view } = editor
  const cells = selectedCellPositions(state)
  if (cells.length === 0) return
  const tablePos = tablePosOfCell(state.doc, cells[0])
  if (tablePos === null) return
  const r = view.coordsAtPos(state.selection.head)
  window.dispatchEvent(
    new CustomEvent<TableMenuDetail>(TABLE_MENU_EVENT, {
      detail: { editor, kind: 'cell', tablePos, index: 0, cellPos: null, x: r.left, y: r.bottom },
    }),
  )
}
