import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { Icon } from '../../components/Icon'
import {
  applyLine,
  applyMarker,
  applyTextColor,
  canUseHeadings,
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
import { withShortcut } from '../../editor/shortcuts'
import { Glyph, tipProps } from '../../help/buttons'
import { toolbarButton, type ToolbarButtonId } from './noteButtons'
import { useKeyboardOpen } from '../../layout/useKeyboardInset'
import type { NoteSession } from './session'
import { useDialog } from '../../components/Dialog'
import { insertTable, isInTable } from '../../editor/table'
import { openCellMenuAtSelection } from './TableMenu'
import { insertImageFiles } from '../../editor/image'
import { LINK_DIALOG_EVENT, type LinkDialogDetail } from '../../editor/webLink'

type Panel = 'textColor' | 'marker' | 'line' | 'insert' | null

/**
 * 書式ツールバー。
 * PC:タイトルの下に常に表示。スマホ・タブレット:画面の下に表示し、キーボードが出たらそのすぐ上に来る
 * (アプリ全体の高さを見えている範囲に合わせているため。useKeyboardInset.ts)
 */
export function Toolbar({
  session,
  top,
  onAddSticky,
  onMoveToPage,
  onInsertNoteLink,
}: {
  session: NoteSession
  top: boolean
  onAddSticky: () => void
  /** 選択モードの「別のページへ」 */
  onMoveToPage: () => void
  /** ノート・ページへのリンクを入れる(選ぶ画面を出す) */
  onInsertNoteLink: (editor: Editor) => void
}) {
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
  const dialog = useDialog()
  const fileRef = useRef<HTMLInputElement>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const togglePanel = (p: Panel) => setPanel((cur) => (cur === p ? null : p))

  const editor = session.activeEditor
  const usable = !!editor && !editor.isDestroyed
  /** 見出しを使えるか(付箋の中では使えない) */
  const headings = usable && canUseHeadings(editor)
  const active = (name: string, attrs?: Record<string, unknown>) => usable && editor.isActive(name, attrs)

  /** 書式の操作(1回の「元に戻す」で戻せるよう、前後の入力と分ける) */
  const run = (fn: (e: Editor) => void) => {
    if (!editor || editor.isDestroyed) return
    session.history.closeGroup()
    fn(editor)
    session.history.closeGroup()
  }

  /** 表・画像・ノートへのリンクを入れられるか(付箋の中・表の中には入れない) */
  const blocks = usable && !!editor.schema.nodes.table && !isInTable(editor)
  const inTable = usable && isInTable(editor)

  /** 画像を選んだとき:縮小して保存し、カーソルの位置に入れる */
  const onImage = async (file: File) => {
    if (!editor || editor.isDestroyed) return
    await insertImageFiles(editor, [file], {
      closeGroup: () => session.history.closeGroup(),
      alert: (message) => dialog.alert({ message }),
    })
  }

  /** カーソル(または選んだ範囲)のセルのメニューを出す */
  const openCellMenu = () => {
    if (editor && !editor.isDestroyed) openCellMenuAtSelection(editor)
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
      {panel === 'insert' && (
        <div className="swatches insert-panel">
          <Swatch
            label="表"
            wide
            disabled={!blocks}
            onClick={() => {
              run(insertTable)
              setPanel(null)
            }}
          >
            <Icon name="table" size={18} />
            <span>表</span>
          </Swatch>
          <Swatch
            label="画像"
            wide
            disabled={!blocks}
            onClick={() => {
              setPanel(null)
              fileRef.current?.click()
            }}
          >
            <Icon name="image" size={18} />
            <span>画像</span>
          </Swatch>
          <Swatch
            label={withShortcut('Webリンク', 'link')}
            wide
            onClick={() => {
              setPanel(null)
              window.dispatchEvent(new CustomEvent<LinkDialogDetail>(LINK_DIALOG_EVENT, { detail: { editor } }))
            }}
          >
            <Icon name="link" size={18} />
            <span>Webリンク</span>
          </Swatch>
          <Swatch
            label="ノート・ページへのリンク"
            wide
            disabled={!blocks}
            onClick={() => {
              setPanel(null)
              onInsertNoteLink(editor)
            }}
          >
            <Icon name="book" size={18} />
            <span>ノートへのリンク</span>
          </Swatch>
        </div>
      )}
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

  if (session.select.active) {
    return <SelectBar session={session} top={top} onMoveToPage={onMoveToPage} />
  }

  return (
    <div className={`toolbar ${top ? 'toolbar--top' : 'toolbar--bottom'}`} role="toolbar" aria-label="書式">
      {!top && panelView}
      <div className="toolbar-row">
        <Group>
          <TBtn
            btn="undo"
            disabled={!session.history.canUndo()}
            onClick={() => void session.history.undo()}
          />
          <TBtn
            btn="redo"
            disabled={!session.history.canRedo()}
            onClick={() => void session.history.redo()}
          />
        </Group>
        <Group>
          <TBtn
            btn="h1"
            active={headingActive(1)}
            disabled={!headings}
            onClick={() => run((e) => toggleHeadingLevel(e, 1))}
          />
          <TBtn
            btn="h2"
            active={headingActive(2)}
            disabled={!headings}
            onClick={() => run((e) => toggleHeadingLevel(e, 2))}
          />
          <TBtn
            btn="h3"
            active={headingActive(3)}
            disabled={!headings}
            onClick={() => run((e) => toggleHeadingLevel(e, 3))}
          />
          <TBtn
            btn="toggle"
            active={active('toggleHeading')}
            disabled={!headings}
            onClick={() => run(toggleToggle)}
          />
          <TBtn
            btn="body"
            disabled={!headings}
            onClick={() => run(setBody)}
          />
        </Group>
        <Group>
          <TBtn
            btn="bold"
            active={active('bold')}
            disabled={!usable}
            onClick={() => run(toggleBold)}
          />
          <TBtn
            btn="strike"
            active={active('strike')}
            disabled={!usable}
            onClick={() => run(toggleStrike)}
          />
          <TBtn
            btn="textColor"
            active={panel === 'textColor'}
            disabled={!usable}
            onClick={() => togglePanel('textColor')}
          >
            <span className="tb-color" style={{ borderColor: textColor ? `var(--tc-${textColor})` : 'currentColor' }}>
              A
            </span>
          </TBtn>
          <TBtn
            btn="marker"
            active={panel === 'marker'}
            disabled={!usable}
            onClick={() => togglePanel('marker')}
          >
            <span className="tb-marker" style={{ background: `var(--mk-${markerColor ?? last.marker})` }}>
              <Icon name="marker" size={18} />
            </span>
          </TBtn>
          <TBtn
            btn="line"
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
            btn="bulletList"
            active={active('bulletList')}
            disabled={!usable}
            onClick={() => run(toggleBullet)}
          />
          <TBtn
            btn="orderedList"
            active={active('orderedList')}
            disabled={!usable}
            onClick={() => run(toggleOrdered)}
          />
          <TBtn
            btn="taskList"
            active={active('taskList')}
            disabled={!usable}
            onClick={() => run(toggleTodo)}
          />
        </Group>
        <Group>
          <TBtn
            btn="insert"
            active={panel === 'insert'}
            disabled={!usable}
            onClick={() => togglePanel('insert')}
          />
          {inTable && <TBtn btn="tableMenu" onClick={openCellMenu} />}
          <TBtn btn="sticky" onClick={onAddSticky} />
          <TBtn
            btn="select"
            onClick={() => {
              setPanel(null)
              session.setSelectMode(true)
            }}
          />
        </Group>
        {!top && keyboardOpen && (
          <Group>
            <TBtn
              btn="keyboardHide"
              onClick={() => {
                setPanel(null)
                ;(document.activeElement as HTMLElement | null)?.blur()
              }}
            />
          </Group>
        )}
      </div>
      {top && panelView}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void onImage(file)
        }}
      />
    </div>
  )
}

const PANEL_LABEL: Record<Exclude<Panel, null>, string> = {
  textColor: '文字色',
  marker: 'マーカー',
  line: 'ライン',
  insert: '挿入',
}

function Group({ children }: { children: ReactNode }) {
  return <div className="tb-group">{children}</div>
}

/** 押してもエディタからカーソルが外れない(スマホでキーボードが閉じない)ボタン */
function keepFocus(e: { preventDefault: () => void }) {
  e.preventDefault()
}

/**
 * ツールバーのボタン。名前・見た目・ショートカットは noteButtons.tsx の一覧から取る(ヘルプと同じ情報)。
 * children:今の色など、その時々で見た目が変わるボタンだけ使う
 */
function TBtn(props: {
  btn: ToolbarButtonId
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children?: ReactNode
}) {
  const def = toolbarButton(props.btn)
  return (
    <button
      type="button"
      className={`tb-btn${props.active ? ' is-active' : ''}`}
      {...tipProps(def)}
      aria-pressed={props.active ?? undefined}
      disabled={props.disabled}
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
      onClick={props.onClick}
    >
      {props.children ?? <Glyph glyph={def.glyph} />}
    </button>
  )
}

function Swatch(props: {
  label: string
  selected?: boolean
  wide?: boolean
  disabled?: boolean
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
      disabled={props.disabled}
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

/**
 * 選択モードのバー(ツールバーの代わりに出す)。
 * 選んだ行を「ここへ移動」(次にタップした所へ)・「別のページへ」移動する
 */
function SelectBar({
  session,
  top,
  onMoveToPage,
}: {
  session: NoteSession
  top: boolean
  onMoveToPage: () => void
}) {
  const count = session.selectedCount
  const placing = session.select.placing
  return (
    <div
      className={`toolbar select-bar ${top ? 'toolbar--top' : 'toolbar--bottom'}`}
      role="toolbar"
      aria-label="行の選択"
    >
      <div className="select-bar-row">
        <span className="select-bar-text" aria-live="polite">
          {placing ? '移動先をタップしてください' : count ? `${count}行を選択中` : '動かしたい行を選んでください'}
        </span>
        {placing ? (
          <button type="button" className="btn btn--plain" onClick={() => session.setPlacing(false)}>
            戻る
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!count}
              onClick={() => session.setPlacing(true)}
            >
              ここへ移動
            </button>
            <button type="button" className="btn btn--plain" disabled={!count} onClick={onMoveToPage}>
              別のページへ
            </button>
            <button type="button" className="btn btn--plain" onClick={() => session.setSelectMode(false)}>
              やめる
            </button>
          </>
        )}
      </div>
    </div>
  )
}
