import { useSyncExternalStore } from 'react'

// GitHub Pages でも動くよう、URLの # 以降で画面を切り替える
export type Route =
  | { name: 'shelf' }
  /** pageId:開いたらそのページを表示する(ノートへのリンク・検索から) */
  | { name: 'note'; id: string; pageId?: string }
  | { name: 'settings' }
  | { name: 'trash' }

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '')
  const m = path.match(/^\/note\/([^/]+)(?:\/p\/([^/]+))?$/)
  if (m) {
    return m[2]
      ? { name: 'note', id: decodeURIComponent(m[1]), pageId: decodeURIComponent(m[2]) }
      : { name: 'note', id: decodeURIComponent(m[1]) }
  }
  if (path === '/settings') return { name: 'settings' }
  if (path === '/trash') return { name: 'trash' }
  return { name: 'shelf' }
}

let current = parseHash(location.hash)

function subscribe(onChange: () => void) {
  const handler = () => {
    current = parseHash(location.hash)
    onChange()
  }
  window.addEventListener('hashchange', handler)
  return () => window.removeEventListener('hashchange', handler)
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => current)
}

export const href = {
  shelf: () => '#/',
  note: (id: string, pageId?: string | null) =>
    `#/note/${encodeURIComponent(id)}${pageId ? `/p/${encodeURIComponent(pageId)}` : ''}`,
  settings: () => '#/settings',
  trash: () => '#/trash',
}

export function navigate(to: string) {
  if (location.hash !== to) location.hash = to
}

/**
 * 画面を切り替えずに、URL だけ書き換える(ページを表示し終えたあと、URL からページの指定を外す。
 * 同じリンクをもう一度押したときにも移動できるように)
 */
export function replaceHash(to: string) {
  if (location.hash !== to) history.replaceState(history.state, '', to)
}
