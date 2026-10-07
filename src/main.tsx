import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { requestPersist } from './db/persist'
import { purgeExpired } from './db/repo'
import { initTheme } from './theme/theme'
import './styles/base.css'
import './styles/editor.css'
import './styles/note.css'
import './styles/screens.css'
import './styles/sticky.css'
import './styles/cover.css'

// ダークモード(端末に合わせる/ライト/ダーク)
initTheme()

// データを消されにくくするようブラウザに頼む
void requestPersist()

// ゴミ箱に入れてから30日たったノート・ページを完全に削除する
void purgeExpired().catch((e) => console.error('ゴミ箱の整理に失敗しました', e))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
