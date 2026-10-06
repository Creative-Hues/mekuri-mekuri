import { useEffect, useReducer, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { Icon, type IconName } from '../../components/Icon'
import type { ToggleLevel } from '../../editor/ToggleHeading'
import type { NoteSession } from './session'

/**
 * 仮のボタン列(フェーズ1用)。
 * フェーズ2で、キーボードのすぐ上に出る正式なツールバーに置き換える。
 */
export function TempToolbar({
  session,
  onAddPage,
  onDeletePage,
}: {
  session: NoteSession
  onAddPage: () => void
  onDeletePage: () => void
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

  const editor = session.activeEditor
  const usable = !!editor && !editor.isDestroyed

  /** 書式の操作(1回の「元に戻す」で戻せるよう、前後の入力と分ける) */
  const run = (fn: (e: Editor) => void) => {
    if (!editor || editor.isDestroyed) return
    session.history.closeGroup()
    fn(editor)
    session.history.closeGroup()
  }

  const inToggleTitle = usable && editor.isActive('toggleTitle')
  const toggleLevel = (): ToggleLevel => {
    if (!editor) return 2
    for (const l of [1, 2, 3] as const) if (editor.isActive('heading', { level: l })) return l
    return 2
  }
  const headingActive = (level: ToggleLevel) =>
    usable &&
    (editor.isActive('heading', { level }) || (inToggleTitle && editor.isActive('toggleHeading', { level })))

  const heading = (level: ToggleLevel) =>
    run((e) => {
      if (e.isActive('toggleTitle')) e.chain().focus().toggleToggleHeading(level).run()
      else e.chain().focus().toggleHeading({ level }).run()
    })

  return (
    <div className="temp-toolbar" role="toolbar" aria-label="書式">
      <div className="temp-toolbar-scroll">
        <Group>
          <TBtn label="大見出し" text="大" active={headingActive(1)} disabled={!usable} onClick={() => heading(1)} />
          <TBtn label="中見出し" text="中" active={headingActive(2)} disabled={!usable} onClick={() => heading(2)} />
          <TBtn label="小見出し" text="小" active={headingActive(3)} disabled={!usable} onClick={() => heading(3)} />
          <TBtn
            label="トグル見出し"
            icon="toggle"
            active={usable && editor.isActive('toggleHeading')}
            disabled={!usable}
            onClick={() => run((e) => e.chain().focus().toggleToggleHeading(toggleLevel()).run())}
          />
        </Group>
        <Group>
          <TBtn
            label="箇条書き"
            icon="bullet"
            active={usable && editor.isActive('bulletList')}
            disabled={!usable}
            onClick={() => run((e) => e.chain().focus().toggleBulletList().run())}
          />
          <TBtn
            label="番号付きリスト"
            icon="ordered"
            active={usable && editor.isActive('orderedList')}
            disabled={!usable}
            onClick={() => run((e) => e.chain().focus().toggleOrderedList().run())}
          />
          <TBtn
            label="ToDoリスト"
            icon="todo"
            active={usable && editor.isActive('taskList')}
            disabled={!usable}
            onClick={() => run((e) => e.chain().focus().toggleTaskList().run())}
          />
        </Group>
        <Group>
          <TBtn
            label="太字"
            text="B"
            textClass="tb-bold"
            active={usable && editor.isActive('bold')}
            disabled={!usable}
            onClick={() => run((e) => e.chain().focus().toggleBold().run())}
          />
          <TBtn
            label="取り消し線"
            text="S"
            textClass="tb-strike"
            active={usable && editor.isActive('strike')}
            disabled={!usable}
            onClick={() => run((e) => e.chain().focus().toggleStrike().run())}
          />
        </Group>
        <Group>
          <TBtn
            label="元に戻す"
            icon="undo"
            disabled={!session.history.canUndo()}
            onClick={() => void session.history.undo()}
          />
          <TBtn
            label="やり直し"
            icon="redo"
            disabled={!session.history.canRedo()}
            onClick={() => void session.history.redo()}
          />
        </Group>
        <Group>
          <TBtn label="ページを追加" icon="pageAdd" onClick={onAddPage} />
          <TBtn label="このページを削除" icon="pageRemove" onClick={onDeletePage} />
        </Group>
      </div>
    </div>
  )
}

function Group({ children }: { children: ReactNode }) {
  return <div className="tb-group">{children}</div>
}

function TBtn(props: {
  label: string
  icon?: IconName
  text?: string
  textClass?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`tb-btn${props.active ? ' is-active' : ''}`}
      aria-label={props.label}
      aria-pressed={props.active ?? undefined}
      title={props.label}
      disabled={props.disabled}
      // 押してもエディタからカーソルが外れない(スマホでキーボードが閉じない)ようにする
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onClick}
    >
      {props.icon ? <Icon name={props.icon} /> : <span className={props.textClass}>{props.text}</span>}
    </button>
  )
}
