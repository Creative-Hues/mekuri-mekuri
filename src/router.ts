import { useSyncExternalStore } from 'react'

// GitHub Pages でも動くよう、URLの # 以降で画面を切り替える
export type Route = { name: 'shelf' } | { name: 'note'; id: string } | { name: 'settings' } | { name: 'trash' }

function parse(hash: string): Route {
  const path = hash.replace(/^#/, '')
  const m = path.match(/^\/note\/([^/]+)$/)
  if (m) return { name: 'note', id: decodeURIComponent(m[1]) }
  if (path === '/settings') return { name: 'settings' }
  if (path === '/trash') return { name: 'trash' }
  return { name: 'shelf' }
}

let current = parse(location.hash)

function subscribe(onChange: () => void) {
  const handler = () => {
    current = parse(location.hash)
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
  note: (id: string) => `#/note/${encodeURIComponent(id)}`,
  settings: () => '#/settings',
  trash: () => '#/trash',
}

export function navigate(to: string) {
  if (location.hash !== to) location.hash = to
}
