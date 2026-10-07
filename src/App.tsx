import { useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useRoute } from './router'
import { useLayoutMode } from './layout/useLayoutMode'
import { Bookshelf } from './screens/Bookshelf'
import { Settings } from './screens/Settings'
import { Trash } from './screens/Trash'
import { NoteView } from './screens/note/NoteView'
import { Sidebar } from './components/Sidebar'
import { DialogProvider, useDialog } from './components/Dialog'
import { shouldRemindBackup, snoozeBackupReminder } from './backup/reminder'
import { exportBackup } from './backup/export'
import { SearchPanel } from './screens/SearchPanel'
import { OPEN_SEARCH_EVENT } from './search/openSearch'
import { matchShortcut } from './editor/shortcuts'
import { Onboarding } from './screens/Onboarding'
import { finishOnboarding, OPEN_ONBOARDING_EVENT, shouldShowOnboarding } from './onboarding/onboarding'

export function App() {
  return (
    <DialogProvider>
      <Shell />
    </DialogProvider>
  )
}

function Shell() {
  const route = useRoute()
  const layout = useLayoutMode()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(false)

  useStartupGuide(() => setOnboardingOpen(true))
  usePreventFileDrop()

  // 画面が変わったら開閉式の一覧は閉じる
  useEffect(() => setDrawerOpen(false), [route])

  // 全ノート検索:検索ボタン(OPEN_SEARCH_EVENT)と Ctrl+F / ⌘+F
  useEffect(() => {
    const open = () => {
      setDrawerOpen(false)
      setSearchOpen(true)
    }
    const onKey = (e: KeyboardEvent) => {
      if (matchShortcut(e) !== 'search' || document.querySelector('.dialog-backdrop')) return
      e.preventDefault()
      open()
    }
    window.addEventListener(OPEN_SEARCH_EVENT, open)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener(OPEN_SEARCH_EVENT, open)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // 設定画面の「使い方を見る」
  useEffect(() => {
    const open = () => setOnboardingOpen(true)
    window.addEventListener(OPEN_ONBOARDING_EVENT, open)
    return () => window.removeEventListener(OPEN_ONBOARDING_EVENT, open)
  }, [])

  let screen
  if (route.name === 'note') {
    screen = (
      <NoteView
        key={route.id}
        noteId={route.id}
        target={route.pageId ? route : null}
        onToggleSidebar={layout.sidebar === 'toggle' ? () => setDrawerOpen((o) => !o) : undefined}
      />
    )
  } else if (route.name === 'settings') {
    screen = <Settings />
  } else if (route.name === 'trash') {
    screen = <Trash />
  } else {
    screen = <Bookshelf />
  }

  const currentId = route.name === 'note' ? route.id : undefined
  const showFixed = layout.sidebar === 'fixed' && route.name !== 'shelf'

  return (
    <div className={`app${showFixed ? ' has-sidebar' : ''}`}>
      {showFixed && <Sidebar currentId={currentId} />}
      {layout.sidebar === 'toggle' && drawerOpen && (
        <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <Sidebar currentId={currentId} onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}
      <main className="app-main">{screen}</main>
      {searchOpen && <SearchPanel onClose={() => setSearchOpen(false)} />}
      {onboardingOpen && (
        <Onboarding
          onClose={() => {
            setOnboardingOpen(false)
            void finishOnboarding()
          }}
        />
      )}
      <UpdateBanner />
    </div>
  )
}

/**
 * 起動時の案内:
 * 新しく使い始める人には使い方説明を出す。それ以外は、前回のバックアップから7日たっていたら案内する。
 * 使い方説明の判定は、バックアップ案内の判定(初回起動の日時を記録する)より先に行う
 */
function useStartupGuide(showOnboarding: () => void) {
  const dialog = useDialog()
  const showRef = useRef(showOnboarding)
  showRef.current = showOnboarding
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const first = await shouldShowOnboarding()
      const remind = await shouldRemindBackup()
      if (cancelled) return
      if (first) {
        showRef.current()
        return
      }
      if (!remind) return
      const yes = await dialog.choose({
        title: 'バックアップしますか？',
        message: '前回のバックアップから7日以上たちました。ノートを守るため、バックアップファイルを書き出しておきましょう。',
        cancelValue: false,
        buttons: [
          { label: 'あとで', value: false, kind: 'plain' },
          { label: 'バックアップする', value: true, kind: 'primary' },
        ],
      })
      if (yes) await exportBackup()
      else await snoozeBackupReminder()
    })()
    return () => {
      cancelled = true
    }
  }, [dialog])
}

/**
 * ファイルをエディタの外(余白・付箋など)に落としたとき、ブラウザがその画像を開いて
 * アプリの画面から離れてしまうのを防ぐ(本文のエディタに落とした画像は imagePaste.ts で受け取る)
 */
function usePreventFileDrop() {
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
    const inEditor = (e: DragEvent) => e.target instanceof Element && !!e.target.closest('.page-editor')
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e) || inEditor(e)) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'none'
    }
    const onDrop = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])
}

/** 新しいバージョンがあるときのお知らせ(勝手には切り替えない) */
function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError: (e) => console.error('Service Worker の登録に失敗しました', e),
  })
  if (!needRefresh) return null
  return (
    <div className="update-banner" role="status">
      <span className="update-banner-text">新しいバージョンがあります</span>
      <div className="update-banner-actions">
        <button className="btn btn--plain" onClick={() => setNeedRefresh(false)}>
          あとで
        </button>
        <button className="btn btn--primary" onClick={() => void updateServiceWorker(true)}>
          更新する
        </button>
      </div>
    </div>
  )
}
