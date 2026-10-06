import { useEffect, useReducer, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { Icon, type IconName } from '../../components/Icon'
import {
  applyLine,
  applyMarker,
  applyTextColor,
  setBody,
  toggleBold,
  toggleBullet,
  toggleHeadingLevel,
  toggleOrdered,
  toggleStrike,
  toggleTodo,
  toggleToggle,
} from '../../editor/format'
import { getLastUsed } from '../../editor/lastUsed'
import {
  LINE_STYLES,
  MARKER_COLORS,
  TEXT_COLORS,
  type LineColorName,
  type LineStyleName,
} from '../../editor/palette'
import { shortcutText, withShortcut } from '../../editor/shortcuts'
import { useKeyboardOpen } from '../../layout/useKeyboardInset'
import type { NoteSession } from './session'

type Panel = 'textColor' | 'marker' | 'line' | null

/**
 * 書式ツールバー。
 * PC:タイトルの下に常に表示。スマホ・タブレット:画面の下に表示し、キーボードが出たらそのすぐ上に来る
 * (アプリ全体の高さを見えている範囲に合わせているため。useKeyboardInset.ts)
 */
export function Toolbar({ session, top }: { session: NoteSession; top: boolean }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const a = session.subscribe(rerender)
    const b = session.history.subscribe(rerender)
    return () => {
      a()
      b()
    }
  }, [session])

  const keyboardOpen = useKeyboardOpen()
  const [panel, setPanel] = useState<Panel>(null)
  const togglePanel = (p: Panel) => setPanel((cur) => (cur === p ? null : p))

  const editor = session.activeEditor
  const usable = !!editor && !editor.isDestroyed
  const active = (name: string, attrs?: Record<string, unknown>) => usable && editor.isActive(name, attrs)

  /** 書式の操作(1回の「元に戻す」で戻せるよう、前後の入力と分ける) */
  const run = (fn: (e: Editor) => void) => {
    if (!editor || editor.isDestroyed) return
    session.history.closeGroup()
    fn(editor)
    session.history.closeGroup()
  }

  const headingActive = (level: 1 | 2 | 3) =>
    active('heading', { level }) || (active('toggleTitle') && active('toggleHeading', { level }))

  const textColor = usable ? (editor.getAttributes('textColor').color as string | undefined) : undefined
  const markerColor = usable ? (editor.getAttributes('marker').color as string | undefined) : undefined
  const lineActive = active('underline')
  const lineAttrs = usable ? editor.getAttributes('underline') : {}
  const last = getLastUsed()
  const lineStyle: LineStyleName = lineActive ? (lineAttrs.style ?? 'solid') : last.lineStyle
  const lineColor: LineColorName = lineActive ? (lineAttrs.color ?? null) : last.lineColor

  const panelView = panel && usable && (
    <div className="toolbar-panel" role="group" aria-label={PANEL_LABEL[panel]}>
      {panel === 'textColor' && (
        <div className="swatches">
          <Swatch label="色なし" selected={!textColor} onClick={() => run((e) => applyTextColor(e, null))}>
            <Icon name="none" size={18} />
          </Swatch>
          {TEXT_COLORS.map((c) => (
            <Swatch
              key={c.name}
              label={c.label}
              selected={textColor === c.name}
              onClick={() => {
                run((e) => applyTextColor(e, c.name))
                setPanel(null)
              }}
            >
              <span className="swatch-a" style={{ color: `var(--tc-${c.name})` }}>
                A
              </span>
            </Swatch>
          ))}
        </div>
      )}
      {panel === 'marker' && (
        <div className="swatches">
          <Swatch label="マーカーなし" selected={!markerColor} onClick={() => run((e) => applyMarker(e, null))}>
            <Icon name="none" size={18} />
          </Swatch>
          {MARKER_COLORS.map((c) => (
            <Swatch
              key={c.name}
              label={c.label}
              selected={markerColor === c.name}
              onClick={() => {
                run((e) => applyMarker(e, c.name))
                setPanel(null)
              }}
            >
              <span className="swatch-fill" style={{ background: `var(--mk-${c.name})` }} />
            </Swatch>
          ))}
        </div>
      )}
      {panel === 'line' && (
        <div className="line-panel">
          <div className="swatches">
            <Swatch label="ラインを外す" selected={!lineActive} onClick={() => run((e) => applyLine(e, null))}>
              <Icon name="none" size={18} />
            </Swatch>
            {LINE_STYLES.map((s) => (
              <Swatch
                key={s.name}
                label={s.label}
                wide
                selected={lineActive && lineStyle === s.name}
                onClick={() => run((e) => applyLine(e, { style: s.name, color: lineColor }))}
              >
                <span className="swatch-line" data-line-style={s.name}>
                  {s.label}
                </span>
              </Swatch>
            ))}
          </div>
          <div className="swatches">
            <Swatch
              label="文字と同じ色"
              selected={lineActive && lineColor === null}
              onClick={() => run((e) => applyLine(e, { style: lineStyle, color: null }))}
            >
              <span className="swatch-dot swatch-dot--ink" />
            </Swatch>
            {TEXT_COLORS.map((c) => (
              <Swatch
                key={c.name}
                label={`${c.label}の線`}
                selected={lineActive && lineColor === c.name}
                onClick={() => run((e) => applyLine(e, { style: lineStyle, color: c.name }))}
              >
                <span className="swatch-dot" style={{ background: `var(--tc-${c.name})` }} />
              </Swatch>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className={`toolbar ${top ? 'toolbar--top' : 'toolbar--bottom'}`} role="toolbar" aria-label="書式">
      {!top && panelView}
      <div className="toolbar-row">
        <Group>
          <TBtn
            label={withShortcut('元に戻す', 'undo')}
            icon="undo"
            disabled={!session.history.canUndo()}
            onClick={() => void session.history.undo()}
          />
          <TBtn
            label={withShortcut('やり直し', 'redo')}
            icon="redo"
            disabled={!session.history.canRedo()}
            onClick={() => void session.history.redo()}
          />
        </Group>
        <Group>
          <TBtn
            label={withShortcut('大見出し', 'h1')}
            text="大"
            active={headingActive(1)}
            disabled={!usable}
            onClick={() => run((e) => toggleHeadingLevel(e, 1))}
          />
          <TBtn
            label={withShortcut('中見出し', 'h2')}
            text="中"
            active={headingActive(2)}
            disabled={!usable}
            onClick={() => run((e) => toggleHeadingLevel(e, 2))}
          />
          <TBtn
            label={withShortcut('小見出し', 'h3')}
            text="小"
            active={headingActive(3)}
            disabled={!usable}
            onClick={() => run((e) => toggleHeadingLevel(e, 3))}
          />
          <TBtn
            label="トグル見出し"
            icon="toggle"
            active={active('toggleHeading')}
            disabled={!usable}
            onClick={() => run(toggleToggle)}
          />
          <TBtn
            label={withShortcut('本文に戻す', 'body')}
            text="本"
            disabled={!usable}
            onClick={() => run(setBody)}
          />
        </Group>
        <Group>
          <TBtn
            label={withShortcut('太字', 'bold')}
            text="B"
            textClass="tb-bold"
            active={active('bold')}
            disabled={!usable}
            onClick={() => run(toggleBold)}
          />
          <TBtn
            label={withShortcut('取り消し線', 'strike')}
            text="S"
            textClass="tb-strike"
            active={active('strike')}
            disabled={!usable}
            onClick={() => run(toggleStrike)}
          />
          <TBtn
            label="文字色"
            active={panel === 'textColor'}
            disabled={!usable}
            onClick={() => togglePanel('textColor')}
          >
            <span className="tb-color" style={{ borderColor: textColor ? `var(--tc-${textColor})` : 'currentColor' }}>
              A
            </span>
          </TBtn>
          <TBtn
            label={`マーカー(最後に使った色を ${shortcutText('marker')} で付け外し)`}
            active={panel === 'marker'}
            disabled={!usable}
            onClick={() => togglePanel('marker')}
          >
            <span className="tb-marker" style={{ background: `var(--mk-${markerColor ?? last.marker})` }}>
              <Icon name="marker" size={18} />
            </span>
          </TBtn>
          <TBtn
            label={`ライン(最後に使った線を ${shortcutText('line')} で付け外し)`}
            active={panel === 'line' || lineActive}
            disabled={!usable}
            onClick={() => togglePanel('line')}
          >
            <span
              className="tb-line"
              data-line-style={lineStyle}
              style={{ textDecorationColor: lineColor ? `var(--tc-${lineColor})` : undefined }}
            >
              U
            </span>
          </TBtn>
        </Group>
        <Group>
          <TBtn
            label={withShortcut('箇条書き', 'bulletList')}
            icon="bullet"
            active={active('bulletList')}
            disabled={!usable}
            onClick={() => run(toggleBullet)}
          />
          <TBtn
            label={withShortcut('番号付きリスト', 'orderedList')}
            icon="ordered"
            active={active('orderedList')}
            disabled={!usable}
            onClick={() => run(toggleOrdered)}
          />
          <TBtn
            label={withShortcut('ToDoリスト', 'taskList')}
            icon="todo"
            active={active('taskList')}
            disabled={!usable}
            onClick={() => run(toggleTodo)}
          />
        </Group>
        {!top && keyboardOpen && (
          <Group>
            <TBtn
              label="キーボードを閉じる"
              icon="keyboardHide"
              onClick={() => {
                setPanel(null)
                ;(document.activeElement as HTMLElement | null)?.blur()
              }}
            />
          </Group>
        )}
      </div>
      {top && panelView}
    </div>
  )
}

const PANEL_LABEL: Record<Exclude<Panel, null>, string> = {
  textColor: '文字色',
  marker: 'マーカー',
  line: 'ライン',
}

function Group({ children }: { children: ReactNode }) {
  return <div className="tb-group">{children}</div>
}

/** 押してもエディタからカーソルが外れない(スマホでキーボードが閉じない)ボタン */
function keepFocus(e: { preventDefault: () => void }) {
  e.preventDefault()
}

function TBtn(props: {
  label: string
  icon?: IconName
  text?: string
  textClass?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children?: ReactNode
}) {
  return (
    <button
      type="button"
      className={`tb-btn${props.active ? ' is-active' : ''}`}
      aria-label={props.label}
      aria-pressed={props.active ?? undefined}
      title={props.label}
      disabled={props.disabled}
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
      onClick={props.onClick}
    >
      {props.children ??
        (props.icon ? <Icon name={props.icon} /> : <span className={props.textClass}>{props.text}</span>)}
    </button>
  )
}

function Swatch(props: {
  label: string
  selected?: boolean
  wide?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={`swatch${props.wide ? ' swatch--wide' : ''}${props.selected ? ' is-selected' : ''}`}
      aria-label={props.label}
      aria-pressed={props.selected}
      title={props.label}
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}
