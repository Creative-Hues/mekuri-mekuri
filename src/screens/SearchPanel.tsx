import { useEffect, useMemo, useRef, useState } from 'react'
import { db, type Note, type Page } from '../db/db'
import { getShelfNotes } from '../db/repo'
import { fullOrder, shelfSections } from '../shelf/order'
import { searchNotes, type SearchHit } from '../search/search'
import { href, navigate } from '../router'
import { flushActiveNote, setPendingJump } from './note/jump'
import { Icon } from '../components/Icon'
import { Cover } from '../components/Cover'

/** 1冊のノートで一覧に出す件数(それ以上は「ほか N件」) */
const HITS_PER_NOTE = 12

/** 全ノート検索(本棚・ノート画面の検索ボタン、Ctrl+F / ⌘+F) */
export function SearchPanel({ onClose }: { onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [data, setData] = useState<{ notes: Note[]; pages: Page[] } | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // 開いたときに、書きかけの内容を保存してから全ノートを読み込む
  useEffect(() => {
    let cancelled = false
    void (async () => {
      await flushActiveNote()
      const [shelf, pages] = await Promise.all([getShelfNotes(), db.pages.toArray()])
      const byId = new Map(shelf.map((n) => [n.id, n]))
      const notes = fullOrder(shelfSections(shelf)).map((id) => byId.get(id)!)
      if (!cancelled) setData({ notes, pages })
    })()
    inputRef.current?.focus()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.dialog-backdrop')) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 入力が止まってから探す(1文字ごとに全ノートを探さない)
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150)
    return () => clearTimeout(t)
  }, [query])

  const results = useMemo(
    () => (data && debounced.trim() ? searchNotes(data.notes, data.pages, debounced) : []),
    [data, debounced],
  )
  const total = results.reduce((n, r) => n + r.hits.length + (r.titleMatch ? 1 : 0), 0)

  const openHit = (note: Note, hit: SearchHit) => {
    setPendingJump({
      noteId: note.id,
      pageId: hit.pageId,
      query: debounced,
      occurrence: hit.occurrence,
      stickyId: hit.stickyId,
    })
    navigate(href.note(note.id, hit.pageId))
    onClose()
  }

  const openNote = (note: Note) => {
    navigate(href.note(note.id))
    onClose()
  }

  return (
    <div className="search-backdrop" onClick={onClose}>
      <div className="search" role="dialog" aria-modal="true" aria-label="全ノート検索" onClick={(e) => e.stopPropagation()}>
        <div className="search-bar">
          <Icon name="search" />
          <input
            ref={inputRef}
            className="search-input"
            type="search"
            enterKeyHint="search"
            placeholder="すべてのノートから探す"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="探す言葉"
          />
          <button className="icon-btn" onClick={onClose} aria-label="閉じる" title="閉じる">
            <Icon name="close" />
          </button>
        </div>

        <div className="search-scroll" aria-live="polite">
          {!data && <p className="search-note">読み込んでいます…</p>}
          {data && debounced.trim() && results.length === 0 && (
            <p className="search-note">「{debounced.trim()}」は見つかりませんでした。</p>
          )}
          {data && !debounced.trim() && (
            <p className="search-note">タイトル・本文・見出し・表・付箋の文字から探します。</p>
          )}
          {results.length > 0 && <p className="search-count">{total}件</p>}
          {results.map(({ note, titleMatch, hits }) => {
            const open = expanded.has(note.id)
            const shown = open ? hits : hits.slice(0, HITS_PER_NOTE)
            return (
              <section key={note.id} className="search-note-group">
                <button className="search-note-title" onClick={() => openNote(note)}>
                  <span className="search-cover">
                    <Cover title="" design={note.design} bare />
                  </span>
                  <span className={titleMatch ? 'is-match' : ''}>{note.title || '無題のノート'}</span>
                </button>
                <ul className="search-hits">
                  {shown.map((hit, i) => (
                    <li key={i}>
                      <button className="search-hit" onClick={() => openHit(note, hit)}>
                        <span className="search-hit-where">
                          {hit.pageNumber}ページ{hit.stickyId ? '・付箋' : ''}
                        </span>
                        <span className="search-hit-text">
                          {hit.snippet.before}
                          <mark>{hit.snippet.match}</mark>
                          {hit.snippet.after}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {hits.length > shown.length && (
                  <button
                    className="search-more"
                    onClick={() => setExpanded((s) => new Set(s).add(note.id))}
                  >
                    ほか{hits.length - shown.length}件を表示
                  </button>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
