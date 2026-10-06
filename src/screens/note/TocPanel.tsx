import { useEffect } from 'react'
import type { Page } from '../../db/db'
import { Icon } from '../../components/Icon'
import { collectHeadings } from '../../editor/toc'
import type { NoteSession } from './session'

/**
 * 目次。ノート全体の見出し(大・中・小・トグル見出し)をページ順に並べる。
 * 項目を押すと、そのページの見出しへ移動する。
 * PCは右から出るパネル、スマホは下から出るシート
 */
export function TocPanel({
  pages,
  session,
  side,
  onClose,
  onJump,
}: {
  pages: Page[]
  session: NoteSession
  /** 右から出すか(PC)。false なら下から出す */
  side: boolean
  onClose: () => void
  onJump: (pageId: string, index: number) => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 未保存の最新の内容から集める
  const sections = pages
    .map((p, i) => ({ page: p, number: i + 1, items: collectHeadings(session.initialContent(p.id, p.content)) }))
    .filter((s) => s.items.length > 0)

  return (
    <div className="toc-backdrop" onClick={onClose}>
      <nav
        className={`toc ${side ? 'toc--side' : 'toc--sheet'}`}
        aria-label="目次"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="toc-header">
          <h2>目次</h2>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる" title="閉じる">
            <Icon name="close" />
          </button>
        </header>
        <div className="toc-scroll">
          {sections.length === 0 ? (
            <p className="toc-empty">
              見出しがありません。大見出し・中見出し・小見出し・トグル見出しを付けると、ここに並びます。
            </p>
          ) : (
            sections.map((s) => (
              <section key={s.page.id} className="toc-section">
                <h3 className="toc-page">{s.number}ページ</h3>
                <ul className="toc-list">
                  {s.items.map((item) => (
                    <li key={item.index}>
                      <button
                        type="button"
                        className={`toc-item toc-item--${item.level}`}
                        onClick={() => onJump(s.page.id, item.index)}
                      >
                        {item.toggle && <Icon name="toggle" size={14} />}
                        <span>{item.text || '(見出しの文字がありません)'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </nav>
    </div>
  )
}
