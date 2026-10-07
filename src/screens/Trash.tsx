import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  TRASH_DAYS,
  daysLeft,
  emptyTrash,
  getTrash,
  purgeExpired,
  purgeNote,
  purgePage,
  restoreNote,
  restorePage,
} from '../db/repo'
import { previewLines } from '../editor/preview'
import { href } from '../router'
import { Icon } from '../components/Icon'
import { Cover } from '../components/Cover'
import { useDialog } from '../components/Dialog'

/** ゴミ箱:削除したノート・ページ。30日たつと自動で完全に削除される */
export function Trash() {
  const dialog = useDialog()
  const trash = useLiveQuery(getTrash, [])

  // 開いたときにも、期限の過ぎたものを片付ける
  useEffect(() => {
    void purgeExpired().catch((e) => console.error('ゴミ箱の整理に失敗しました', e))
  }, [])

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

  const isEmpty = trash && trash.notes.length === 0 && trash.pages.length === 0

  return (
    <div className="settings trash">
      <header className="settings-header">
        <a className="icon-btn" href={href.shelf()} aria-label="本棚へ戻る" title="本棚へ戻る">
          <Icon name="back" />
        </a>
        <h1>ゴミ箱</h1>
        {trash && !isEmpty && (
          <button className="btn btn--danger trash-empty-btn" onClick={() => void empty()}>
            ゴミ箱を空にする
          </button>
        )}
      </header>

      <p className="settings-note trash-intro">
        削除したノート・ページは、{TRASH_DAYS}日たつと自動で完全に削除されます。それまでは元に戻せます。
      </p>

      {isEmpty && <p className="trash-none">ゴミ箱は空です。</p>}

      {trash && trash.notes.length > 0 && (
        <section className="settings-section">
          <h2>ノート</h2>
          <ul className="trash-list">
            {trash.notes.map((note) => (
              <li key={note.id} className="trash-item">
                <span className="trash-cover">
                  <Cover title={note.title} design={note.design} />
                </span>
                <span className="trash-info">
                  <span className="trash-title">{note.title || '無題のノート'}</span>
                  <span className="trash-days">あと{daysLeft(note.deletedAt!)}日で完全に削除</span>
                </span>
                <span className="trash-buttons">
                  <button className="btn btn--plain" onClick={() => void restoreNote(note.id)}>
                    <Icon name="restore" size={18} />
                    元に戻す
                  </button>
                  <button
                    className="icon-btn"
                    aria-label="完全に削除"
                    title="完全に削除"
                    onClick={async () => {
                      if (await confirmPurge(`「${note.title || '無題のノート'}」`)) await purgeNote(note.id)
                    }}
                  >
                    <Icon name="close" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {trash && trash.pages.length > 0 && (
        <section className="settings-section">
          <h2>ページ</h2>
          <ul className="trash-list">
            {trash.pages.map(({ page, note }) => {
              const first = previewLines(page.content, 1)[0]?.text
              return (
                <li key={page.id} className="trash-item">
                  <span className="trash-info">
                    <span className="trash-title">{first || '(白紙のページ)'}</span>
                    <span className="trash-from">
                      「{note.title || '無題のノート'}」の{(page.deletedIndex ?? 0) + 1}ページ目
                    </span>
                    <span className="trash-days">あと{daysLeft(page.deletedAt!)}日で完全に削除</span>
                  </span>
                  <span className="trash-buttons">
                    <button className="btn btn--plain" onClick={() => void restorePage(page.id)}>
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
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
