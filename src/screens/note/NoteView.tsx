import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { deleteNote, deletePage, getPages, insertPage, renameNote, reorderPages } from '../../db/repo'
import { useLayoutMode } from '../../layout/useLayoutMode'
import { useKeyboardOpen } from '../../layout/useKeyboardInset'
import { matchShortcut, withShortcut } from '../../editor/shortcuts'
import { href, navigate } from '../../router'
import { Icon } from '../../components/Icon'
import { useDialog } from '../../components/Dialog'
import { NoteSession } from './session'
import { PageEditor } from './PageEditor'
import { Toolbar } from './Toolbar'
import { PageList } from './PageList'

/** 表示中のページの前後、これだけの範囲はエディタを作っておく(スワイプ先がすぐ表示されるように) */
const MOUNT_BEHIND = 2
const MOUNT_AHEAD = 3

/** 入力欄・エディタの中にいるか(矢印キーでページを送らないため) */
function isEditing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

export function NoteView({
  noteId,
  onToggleSidebar,
}: {
  noteId: string
  /** タブレットで一覧を開閉する(一覧を出さない画面では undefined) */
  onToggleSidebar?: () => void
}) {
  const layout = useLayoutMode()
  const keyboardOpen = useKeyboardOpen() && !layout.toolbarTop
  const dialog = useDialog()
  const [pageListOpen, setPageListOpen] = useState(false)
  const note = useLiveQuery(() => db.notes.get(noteId), [noteId], null)
  const pages = useLiveQuery(() => getPages(noteId), [noteId])

  const scrollerRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef(pages)
  pagesRef.current = pages
  /** 今いちばん左に見えているページの番号(0から) */
  const [current, setCurrent] = useState(0)
  const currentRef = useRef(0)
  currentRef.current = current
  /** ページ一覧が更新されたあとに表示したいページ */
  const pendingShow = useRef<{ pageId: string; focus: boolean } | null>(null)
  const [focusPageId, setFocusPageId] = useState<string | null>(null)

  const perView = layout.spread ? 2 : 1

  // ---- ページ送り ----

  const scrollToIndex = useCallback(
    (index: number, smooth = true) => {
      const el = scrollerRef.current
      if (!el) return
      const width = el.clientWidth / perView
      const start = Math.max(0, index - (index % perView))
      el.scrollTo({ left: start * width, behavior: smooth ? 'smooth' : 'instant' })
      setCurrent(start)
    },
    [perView],
  )

  const showPage = useCallback(
    (pageId: string, focus = false) => {
      const index = pagesRef.current?.findIndex((p) => p.id === pageId) ?? -1
      if (index < 0) {
        // まだ一覧に反映されていない(追加した直後など)→反映後に表示する
        pendingShow.current = { pageId, focus }
        return
      }
      scrollToIndex(index)
      if (focus) setFocusPageId(pageId)
    },
    [scrollToIndex],
  )

  // ページ一覧が更新されたら、待っていたページを表示する
  useEffect(() => {
    const want = pendingShow.current
    if (!want || !pages) return
    if (pages.some((p) => p.id === want.pageId)) {
      pendingShow.current = null
      showPage(want.pageId, want.focus)
    }
  }, [pages, showPage])

  // スクロール位置から、今見えているページを求める
  const onScroll = () => {
    const el = scrollerRef.current
    if (!el) return
    const width = el.clientWidth / perView
    const index = Math.round(el.scrollLeft / width)
    if (index !== currentRef.current) setCurrent(index)
  }

  // 画面の向き・幅が変わったら、見ていたページの位置に合わせ直す
  useLayoutEffect(() => {
    scrollToIndex(currentRef.current, false)
    const el = scrollerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => scrollToIndex(currentRef.current, false))
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollToIndex])

  const pageCount = pages?.length ?? 0
  const go = useCallback(
    (delta: number) => {
      // 最後の「ページを追加」の枠まで送れるようにする
      const max = pageCount
      const next = Math.min(max, Math.max(0, currentRef.current + delta * perView))
      scrollToIndex(next)
    },
    [pageCount, perView, scrollToIndex],
  )

  // ---- 元に戻す/やり直しと保存 ----

  // 画面の向きが変わっても最新の showPage を使うため ref 経由で呼ぶ
  const showPageRef = useRef(showPage)
  showPageRef.current = showPage

  const session = useMemo(
    () =>
      new NoteSession(noteId, {
        showPage: (pageId) => showPageRef.current(pageId),
        removePage: async (pageId) => {
          await sessionRef.current?.flush(pageId)
          const removed = await deletePage(pageId)
          sessionRef.current?.forget(pageId)
          return removed?.page ?? null
        },
        restorePage: async (page, index) => {
          await insertPage(noteId, index, page)
          showPageRef.current(page.id)
        },
        rename: async (title) => {
          await renameNote(noteId, title)
        },
        reorderPages: async (pageIds) => {
          await reorderPages(noteId, pageIds)
        },
      }),
    [noteId],
  )
  const sessionRef = useRef(session)
  sessionRef.current = session

  // 追加したページにカーソルを置く(エディタができるまで少し待つ)
  useEffect(() => {
    if (!focusPageId) return
    let tries = 0
    let timer: ReturnType<typeof setTimeout>
    const tryFocus = () => {
      const editor = session.getEditor(focusPageId)
      if (editor && !editor.isDestroyed) {
        editor.commands.focus('end', { scrollIntoView: false })
        setFocusPageId(null)
      } else if (tries++ < 20) {
        timer = setTimeout(tryFocus, 50)
      } else {
        setFocusPageId(null)
      }
    }
    tryFocus()
    return () => clearTimeout(timer)
  }, [focusPageId, session])

  // アプリを閉じる・別のアプリに切り替えるときは、すぐ保存する
  useEffect(() => {
    const flush = () => void session.flushAll()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [session])

  // ノートを開き直したら最初のページから
  useEffect(() => {
    setCurrent(0)
    scrollerRef.current?.scrollTo({ left: 0, behavior: 'instant' })
  }, [noteId])

  // キーボード:← → でページ送り(編集中は除く)、エディタの外でのショートカット
  // (エディタの中のショートカットは editor/extensions.ts で処理する)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.dialog-backdrop')) return
      const shortcut = matchShortcut(e)
      if ((shortcut === 'undo' || shortcut === 'redo') && !isEditing(e.target)) {
        e.preventDefault()
        void session.history[shortcut]()
        return
      }
      if (shortcut === 'pageList') {
        e.preventDefault()
        setPageListOpen((o) => !o)
        return
      }
      if (document.querySelector('.page-list')) return
      const mod = e.ctrlKey || e.metaKey
      if (isEditing(e.target) || mod || e.altKey) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        go(1)
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        go(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, session])

  // ---- ページの追加・削除 ----

  const addPage = async (index: number) => {
    const page = await insertPage(noteId, index)
    session.history.recordAddPage(page, index)
    session.activePageId = page.id
    showPage(page.id, true)
  }

  /** ページを削除する(ページ一覧から) */
  const removePage = async (pageId: string) => {
    const list = pagesRef.current ?? []
    if (list.length <= 1) {
      await dialog.alert({ message: '最後の1ページは削除できません。' })
      return
    }
    const target = list.find((p) => p.id === pageId)
    if (!target) return
    const number = list.indexOf(target) + 1
    const ok = await dialog.confirm({
      title: 'ページを削除',
      message: `${number}ページ目を削除しますか？(削除しても「元に戻す」で戻せます)`,
      okLabel: '削除する',
      danger: true,
    })
    if (!ok) return
    await session.flush(target.id)
    const removed = await deletePage(target.id)
    session.forget(target.id)
    if (removed) session.history.recordDeletePage(removed.page, removed.index)
    if (session.activePageId === target.id) session.activePageId = null
    session.emit()
  }

  /** ページ一覧で並び替えたとき */
  const onReorder = async (before: string[], after: string[]) => {
    await reorderPages(noteId, after)
    session.history.recordPageOrder(before, after)
  }

  // ---- タイトル ----

  const [titleDraft, setTitleDraft] = useState('')
  const titleFocused = useRef(false)
  const titleBefore = useRef('')
  useEffect(() => {
    if (note && !titleFocused.current) setTitleDraft(note.title)
  }, [note])

  const commitTitle = async () => {
    titleFocused.current = false
    const before = titleBefore.current
    const after = titleDraft.trim()
    setTitleDraft(after)
    if (before !== after) {
      await renameNote(noteId, after)
      session.history.recordRename(before, after)
    }
  }

  // ---- ノートの削除 ----

  const removeNote = async () => {
    const ok = await dialog.confirm({
      title: 'ノートを削除',
      message: `「${note?.title || '無題のノート'}」を削除しますか？この操作は取り消せません。`,
      okLabel: '削除する',
      danger: true,
    })
    if (!ok) return
    await session.flushAll()
    await deleteNote(noteId)
    navigate(href.shelf())
  }

  // ---- 表示 ----

  if (note === undefined) {
    return (
      <div className="empty-state">
        <p>ノートが見つかりません。</p>
        <a className="btn btn--primary" href={href.shelf()}>
          本棚へ
        </a>
      </div>
    )
  }

  const lastIndex = pageCount // 「ページを追加」の枠
  const spreadNumber = Math.floor(current / perView) + 1
  const spreadTotal = Math.floor(lastIndex / perView) + 1
  const pageLabel =
    current >= pageCount
      ? '新しいページ'
      : perView === 2 && current + 1 < pageCount
        ? `${current + 1}–${current + 2} / ${pageCount}`
        : `${current + 1} / ${pageCount}`

  return (
    <div
      className={`note-view${layout.spread ? ' is-spread' : ' is-single'}${layout.toolbarTop ? '' : ' has-bottom-toolbar'}${keyboardOpen ? ' is-keyboard' : ''}`}
    >
      <header className="note-header">
        {layout.sidebar !== 'fixed' && (
          <a className="icon-btn" href={href.shelf()} aria-label="本棚へ戻る" title="本棚へ戻る">
            <Icon name="back" />
          </a>
        )}
        {onToggleSidebar && (
          <button className="icon-btn" onClick={onToggleSidebar} aria-label="ノート一覧" title="ノート一覧">
            <Icon name="menu" />
          </button>
        )}
        <input
          className="note-title-input"
          value={titleDraft}
          placeholder="無題のノート"
          aria-label="ノートのタイトル"
          onFocus={() => {
            titleFocused.current = true
            titleBefore.current = note?.title ?? ''
          }}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => void commitTitle()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
        <button
          className="icon-btn"
          onClick={() => setPageListOpen(true)}
          aria-label="ページ一覧"
          title={withShortcut('ページ一覧', 'pageList')}
        >
          <Icon name="pages" />
        </button>
        <button className="icon-btn" onClick={() => void removeNote()} aria-label="ノートを削除" title="ノートを削除">
          <Icon name="trash" />
        </button>
      </header>

      {layout.toolbarTop && <Toolbar session={session} top />}

      <div className="pages-area">
        {layout.arrows && (
          <button
            className="page-arrow page-arrow--prev"
            onClick={() => go(-1)}
            disabled={current <= 0}
            aria-label="前のページ"
          >
            <Icon name="prev" size={24} />
          </button>
        )}

        <div className="pages-scroller" ref={scrollerRef} onScroll={onScroll}>
          {pages?.map((page, i) => {
            const mounted = i >= current - MOUNT_BEHIND && i <= current + perView - 1 + MOUNT_AHEAD
            return (
              <section
                key={page.id}
                className={`page-slot${perView === 2 ? (i % 2 === 0 ? ' slot-left' : ' slot-right') : ''}`}
                aria-label={`${i + 1}ページ目`}
              >
                <div className="paper">
                  <div className="paper-scroll">
                    {mounted ? (
                      <PageEditor
                        session={session}
                        pageId={page.id}
                        storedContent={page.content}
                      />
                    ) : (
                      <div className="page-placeholder" />
                    )}
                  </div>
                  <div className="page-number">{i + 1}</div>
                </div>
              </section>
            )
          })}
          {pages && (
            <section
              className={`page-slot add-slot${perView === 2 ? (pageCount % 2 === 0 ? ' slot-left' : ' slot-right') : ''}`}
            >
              <button className="add-page-btn" onClick={() => void addPage(pageCount)}>
                <Icon name="plus" size={28} />
                <span>ページを追加</span>
              </button>
            </section>
          )}
        </div>

        {layout.arrows && (
          <button
            className="page-arrow page-arrow--next"
            onClick={() => go(1)}
            disabled={spreadNumber >= spreadTotal}
            aria-label="次のページ"
          >
            <Icon name="next" size={24} />
          </button>
        )}
      </div>

      <footer className="note-footer" aria-live="polite">
        {pageLabel}
      </footer>

      {!layout.toolbarTop && <Toolbar session={session} top={false} />}

      {pageListOpen && pages && (
        <PageList
          pages={pages}
          session={session}
          currentIndex={current}
          onClose={() => setPageListOpen(false)}
          onShow={(pageId) => {
            setPageListOpen(false)
            showPage(pageId)
          }}
          onDelete={(pageId) => void removePage(pageId)}
          onAdd={() => {
            setPageListOpen(false)
            void addPage(pageCount)
          }}
          onReorder={(before, after) => void onReorder(before, after)}
        />
      )}
    </div>
  )
}
