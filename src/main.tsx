import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { requestPersist } from './db/persist'
import './styles/base.css'
import './styles/editor.css'
import './styles/note.css'
import './styles/screens.css'

// データを消されにくくするようブラウザに頼む
void requestPersist()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
