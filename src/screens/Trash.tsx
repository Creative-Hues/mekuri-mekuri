import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  TRASH_DAYS,
  daysLeft,
  emptyTrash,
  getTrash,
  purgeExpired,
  purgeMany,
  purgeNote,
  purgePage,
  restorePages,
  setNotesDeletedAt,
} from '../db/repo'
import { shelfHistory } from '../history/shelfHistory'
import { previewLines } from '../editor/preview'
import { href } from '../router'
import { Icon } from '../components/Icon'
import { Cover } from '../components/Cover'
import { useDialog } from '../components/Dialog'
import { showToast } from '../components/Toast'

/** 選んだものの目印(ノートとページで id がぶつからないように分ける) */
const noteKey = (id: string) => `n:${id}`
const pageKey = (id: string) => `p:${id}`

/**
 * ゴミ箱:削除したノート・ページ。30日たつと自動で完全に削除される。
 * 「選ぶ」で複数を選び、まとめて元に戻す・完全に削除できる。
 * 元に戻したものは本棚の「元に戻す」でゴミ箱へ戻せる(完全に削除は取り消せない)
 */
export function Trash() {
  const dialog = useDialog()
  const trash = useLiveQuery(getTrash, [])
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // 開いたときにも、期限の過ぎたものを片付ける
  useEffect(() => {
    void purgeExpired().catch((e) => console.error('ゴミ箱の整理に失敗しました', e))
  }, [])

  // ゴミ箱にもうないもの(元に戻した・期限で消えた)は、選んだものから外す
  const allKeys = useMemo(
    () => (trash ? [...trash.notes.map((n) => noteKey(n.id)), ...trash.pages.map(({ page }) => pageKey(page.id))] : []),
    [trash],
  )
  const picked = allKeys.filter((k) => selected.has(k))
  const pickedNotes = (trash?.notes ?? []).filter((n) => selected.has(noteKey(n.id)))
  const pickedPages = (trash?.pages ?? []).filter(({ page }) => selected.has(pageKey(page.id))).map(({ page }) => page)
  const allPicked = allKeys.length > 0 && picked.length === allKeys.length

  const endSelect = () => {
    setSelecting(false)
    setSelected(new Set())
  }
  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  useEffect(() => {
    if (!selecting) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.dialog-backdrop')) endSelect()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selecting])

  const confirmPurge = (what: string) =>
    dialog.confirm({
      title: '完全に削除',
      message: `${what}を完全に削除しますか？この操作は取り消せません。`,
      okLabel: '完全に削除する',
      danger: true,
    })

  const empty = async () => {
    const ok = await dialog.confirm({
      title: 'ゴミ箱を空にする',
      message: 'ゴミ箱の中のノート・ページをすべて完全に削除しますか？この操作は取り消せません。',
      okLabel: '空にする',
      danger: true,
    })
    if (ok) await emptyTrash()
  }

  /**
   * ノート・ページを元に戻し、本棚の履歴に記録する(本棚の「元に戻す」で、同じ日時のままゴミ箱へ戻る)
   */
  const restore = async (notes: { id: string; deletedAt: number | null }[], pageIds: string[]) => {
    const noteDates = Object.fromEntries(notes.filter((n) => n.deletedAt != null).map((n) => [n.id, n.deletedAt!]))
    await setNotesDeletedAt(Object.fromEntries(Object.keys(noteDates).map((id) => [id, null])))
    const pages = await restorePages(pageIds)
    shelfHistory.record({ kind: 'restore', notes: noteDates, pages })
    return Object.keys(noteDates).length + pages.length
  }

  const restorePicked = async () => {
    const n = await restore(pickedNotes, pickedPages.map((p) => p.id))
    endSelect()
    showToast(`${n}件を元に戻しました`)
  }

  const purgePicked = async () => {
    const what = [
      pickedNotes.length ? `${pickedNotes.length}冊のノート` : '',
      pickedPages.length ? `${pickedPages.length}枚のページ` : '',
    ]
      .filter(Boolean)
      .join('と')
    if (!(await confirmPurge(`選んだ${what}`))) return
    await purgeMany(
      pickedNotes.map((n) => n.id),
      pickedPages.map((p) => p.id),
    )
    endSelect()
    showToast(`${picked.length}件を完全に削除しました`)
  }

  const isEmpty = trash && trash.notes.length === 0 && trash.pages.length === 0

  /** 選ぶモードのときは、行を押すと選ぶ/外す */
  const rowProps = (key: string, label: string) =>
    selecting
      ? {
          role: 'checkbox' as const,
          'aria-checked': selected.has(key),
          'aria-label': `${label}を選ぶ`,
          tabIndex: 0,
          onClick: () => toggle(key),
          onKeyDown: (e: ReactKeyboardEvent) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault()
              toggle(key)
            }
          },
        }
      : {}

  const check = (key: string) =>
    selecting && (
      <span className={`trash-check${selected.has(key) ? ' is-on' : ''}`} aria-hidden="true">
        {selected.has(key) && <Icon name="check" size={14} />}
      </span>
    )

  return (
    <div className={`settings trash${selecting ? ' is-selecting' : ''}`}>
      <header className="settings-header">
        <a className="icon-btn" href={href.shelf()} aria-label="本棚へ戻る" title="本棚へ戻る">
          <Icon name="back" />
        </a>
        <h1>ゴミ箱</h1>
        {trash && !isEmpty && (
          <>
            <button
              type="button"
              className={`icon-btn${selecting ? ' is-on' : ''}`}
              aria-pressed={selecting}
              aria-label="選ぶ"
              title="複数選んで、まとめて元に戻す・完全に削除"
              onClick={() => (selecting ? endSelect() : setSelecting(true))}
            >
              <Icon name="select" />
            </button>
            {!selecting && (
              <button className="btn btn--danger trash-empty-btn" onClick={() => void empty()}>
                ゴミ箱を空にする
              </button>
            )}
          </>
        )}
      </header>

      <p className="settings-note trash-intro">
        {selecting
          ? 'まとめて操作するノート・ページを押して選んでください。'
          : `削除したノート・ページは、${TRASH_DAYS}日たつと自動で完全に削除されます。それまでは元に戻せます。`}
      </p>

      {isEmpty && <p className="trash-none">ゴミ箱は空です。</p>}

      {trash && trash.notes.length > 0 && (
        <section className="settings-section">
          <h2>ノート</h2>
          <ul className="trash-list">
            {trash.notes.map((note) => {
              const title = note.title || '無題のノート'
              const key = noteKey(note.id)
              return (
                <li key={note.id} className={`trash-item${selected.has(key) ? ' is-picked' : ''}`} {...rowProps(key, `「${title}」`)}>
                  {check(key)}
                  <span className="trash-cover">
                    <Cover title={note.title} design={note.design} />
                  </span>
                  <span className="trash-info">
                    <span className="trash-title">{title}</span>
                    <span className="trash-days">あと{daysLeft(note.deletedAt!)}日で完全に削除</span>
                  </span>
                  {!selecting && (
                    <span className="trash-buttons">
                      <button className="btn btn--plain" onClick={() => void restore([note], [])}>
                        <Icon name="restore" size={18} />
                        元に戻す
                      </button>
                      <button
                        className="icon-btn"
                        aria-label="完全に削除"
                        title="完全に削除"
                        onClick={async () => {
                          if (await confirmPurge(`「${title}」`)) await purgeNote(note.id)
                        }}
                      >
                        <Icon name="close" />
                      </button>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {trash && trash.pages.length > 0 && (
        <section className="settings-section">
          <h2>ページ</h2>
          <ul className="trash-list">
            {trash.pages.map(({ page, note }) => {
              const first = previewLines(page.content, 1)[0]?.text
              const key = pageKey(page.id)
              return (
                <li key={page.id} className={`trash-item${selected.has(key) ? ' is-picked' : ''}`} {...rowProps(key, 'このページ')}>
                  {check(key)}
                  <span className="trash-info">
                    <span className="trash-title">{first || '(白紙のページ)'}</span>
                    <span className="trash-from">
                      「{note.title || '無題のノート'}」の{(page.deletedIndex ?? 0) + 1}ページ目
                    </span>
                    <span className="trash-days">あと{daysLeft(page.deletedAt!)}日で完全に削除</span>
                  </span>
                  {!selecting && (
                    <span className="trash-buttons">
                      <button className="btn btn--plain" onClick={() => void restore([], [page.id])}>
                        <Icon name="restore" size={18} />
                        元に戻す
                      </button>
                      <button
                        className="icon-btn"
                        aria-label="完全に削除"
                        title="完全に削除"
                        onClick={async () => {
                          if (await confirmPurge('このページ')) await purgePage(page.id)
                        }}
                      >
                        <Icon name="close" />
                      </button>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {selecting && (
        <div className="select-bar" role="toolbar" aria-label="選んだものの操作">
          <span className="select-bar-count">{picked.length}件</span>
          <div className="select-bar-buttons">
            <button
              type="button"
              className="select-bar-btn"
              onClick={() => setSelected(allPicked ? new Set() : new Set(allKeys))}
            >
              <Icon name="check" size={18} />
              <span>{allPicked ? '選ぶのをやめる' : 'すべて選ぶ'}</span>
            </button>
            <button type="button" className="select-bar-btn" disabled={picked.length === 0} onClick={() => void restorePicked()}>
              <Icon name="restore" size={18} />
              <span>元に戻す</span>
            </button>
            <button
              type="button"
              className="select-bar-btn is-danger"
              disabled={picked.length === 0}
              onClick={() => void purgePicked()}
            >
              <Icon name="trash" size={18} />
              <span>完全に削除</span>
            </button>
            <button type="button" className="select-bar-btn" onClick={endSelect}>
              <Icon name="close" size={18} />
              <span>完了</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
