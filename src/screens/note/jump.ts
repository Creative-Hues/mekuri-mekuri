import type { NoteSession } from './session'

/**
 * ノート画面の外(検索パネルなど)から、ノート画面に頼むこと。
 * - 今開いているノート:検索の前に、まだ保存していない入力を保存してもらう
 * - 検索結果から移動したとき:見つかった場所を目立たせてもらう
 */

let active: NoteSession | null = null

export function setActiveSession(session: NoteSession | null) {
  active = session
}

/** 開いているノートの、まだ保存していない入力をすぐ保存する */
export async function flushActiveNote(): Promise<void> {
  await active?.flushAll()
}

export interface SearchJump {
  noteId: string
  pageId: string
  query: string
  /** 本文の何番目の一致か(付箋のときは付箋の中で何番目か) */
  occurrence: number
  stickyId: string | null
}

let pending: SearchJump | null = null

export function setPendingJump(jump: SearchJump | null) {
  pending = jump
}

/** そのノート・ページ宛ての移動があれば受け取る(1回だけ) */
export function takePendingJump(noteId: string, pageId: string): SearchJump | null {
  if (!pending || pending.noteId !== noteId || pending.pageId !== pageId) return null
  const j = pending
  pending = null
  return j
}
