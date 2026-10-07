import type { Note } from '../db/db'

/**
 * 本棚の並び。お気に入りの段を上に、その下に通常の段。
 * どちらの段も note.order の小さい順。
 * (画面から切り離した計算だけの関数にして、テストしやすくしている)
 */

export type SectionName = 'favorites' | 'others'

export interface ShelfSections {
  favorites: string[]
  others: string[]
}

/** ノートを段に分ける(ゴミ箱のノートは入れない) */
export function shelfSections(notes: Note[]): ShelfSections {
  const live = notes.filter((n) => n.deletedAt == null).sort((a, b) => a.order - b.order)
  return {
    favorites: live.filter((n) => n.favorite).map((n) => n.id),
    others: live.filter((n) => !n.favorite).map((n) => n.id),
  }
}

/** 本棚全体の並び(お気に入りの段 → 通常の段)。この順に order を振る */
export const fullOrder = (s: ShelfSections): string[] => [...s.favorites, ...s.others]

/**
 * 段の中で、activeId のノートを overId のノートの位置へ動かす。
 * 別の段の上に落とした・どちらかが見つからないときは null(段をまたいだ移動はしない)
 */
export function moveInSection(s: ShelfSections, activeId: string, overId: string): ShelfSections | null {
  if (activeId === overId) return null
  for (const name of ['favorites', 'others'] as const) {
    const list = s[name]
    const from = list.indexOf(activeId)
    const to = list.indexOf(overId)
    if (from < 0) continue
    if (to < 0) return null
    const next = [...list]
    next.splice(from, 1)
    next.splice(to, 0, activeId)
    return { ...s, [name]: next }
  }
  return null
}
