import { useEffect, useState } from 'react'
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

  useBackupReminder()

  // 画面が変わったら開閉式の一覧は閉じる
  useEffect(() => setDrawerOpen(false), [route])

  let screen
  if (route.name === 'note') {
    screen = (
      <NoteView
        key={route.id}
        noteId={route.id}
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
      <UpdateBanner />
    </div>
  )
}

/** 起動時、前回のバックアップから7日たっていたら案内する */
function useBackupReminder() {
  const dialog = useDialog()
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!(await shouldRemindBackup()) || cancelled) return
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
      <span>新しいバージョンがあります</span>
      <button className="btn btn--primary" onClick={() => void updateServiceWorker(true)}>
        更新する
      </button>
      <button className="btn btn--plain" onClick={() => setNeedRefresh(false)}>
        あとで
      </button>
    </div>
  )
}
