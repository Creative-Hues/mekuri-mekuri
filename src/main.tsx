import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { requestPersist } from './db/persist'
import { purgeExpired } from './db/repo'
import { cleanupImages } from './images/store'
import { initTheme } from './theme/theme'
import { initTextSize } from './theme/textSize'
import { initLineStyles } from './editor/lineStyles'
import './styles/base.css'
import './styles/editor.css'
import './styles/note.css'
import './styles/screens.css'
import './styles/sticky.css'
import './styles/cover.css'
import './styles/blocks.css'
import './styles/search.css'
import './styles/print.css'

// ダークモード(自動=端末に合わせる/ライト/ダーク)
initTheme()

// 文字サイズ(ノートの中身の文字の大きさ。端末ごとの設定)
initTextSize()

// ライン(波線・点線・二重線)を SVG で描く CSS を入れる(PDF でもくっきり出るように)
initLineStyles()

// データを消されにくくするようブラウザに頼む
void requestPersist()

// ゴミ箱に入れてから30日たったノート・ページを完全に削除し、
// そのあと使われていない画像を片付ける(使われていない状態が30日続いたものだけ消す)
void purgeExpired()
  .then(() => cleanupImages())
  .catch((e) => console.error('ゴミ箱・画像の整理に失敗しました', e))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
