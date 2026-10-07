import { db, type ImageRecord, type Note, type Page } from '../db/db'
import { getPages } from '../db/repo'
import { linkTargetState } from '../editor/noteLink'
import { collectImageIds, walkContent } from '../editor/contentWalk'
import { buildExportNote, UNTITLED, type ExportNote, type LinkText } from './model'

/**
 * 出力に必要なものをデータベースから読む:
 * ノート・ページ(ゴミ箱を除き並び順どおり)・画像・別ノートへのリンクの表示名
 */

export interface ExportSource {
  note: Note
  pages: Page[]
  model: ExportNote
  images: Map<string, ImageRecord>
}

/** リンクの表示名(カードと同じ:ノート名とページ番号) */
export function linkLabel(state: ReturnType<typeof linkTargetState>): string {
  if (state.kind === 'missing') return 'リンク先が見つかりません'
  const title = state.note?.title.trim() || UNTITLED
  if (state.kind === 'trash') return `${title}(ゴミ箱にあります)`
  return state.pageNumber ? `${title}(${state.pageNumber}ページ目)` : title
}

export async function loadExportSource(noteId: string): Promise<ExportSource | null> {
  const note = await db.notes.get(noteId)
  if (!note) return null
  const pages = await getPages(noteId)

  // 本文と付箋にある、別ノート・別ページへのリンクと画像を集める
  const linkKeys = new Map<string, { noteId: string | null; pageId: string | null }>()
  const imageIds = new Set<string>()
  for (const page of pages) {
    for (const content of [page.content, ...(page.stickies ?? []).map((s) => s.content)]) {
      collectImageIds(content, imageIds)
      walkContent(content, (n) => {
        if (n.type !== 'noteLink') return
        const target = { noteId: n.attrs?.noteId ?? null, pageId: n.attrs?.pageId ?? null }
        linkKeys.set(`${target.noteId}/${target.pageId}`, target)
      })
    }
  }

  const labels = new Map<string, string>()
  for (const [key, { noteId: linkNoteId, pageId }] of linkKeys) {
    if (!linkNoteId) {
      labels.set(key, linkLabel({ kind: 'missing' }))
      continue
    }
    const [linkNote, page, livePages] = await Promise.all([
      db.notes.get(linkNoteId),
      pageId ? db.pages.get(pageId) : undefined,
      pageId ? getPages(linkNoteId) : [],
    ])
    labels.set(key, linkLabel(linkTargetState(linkNote, page, livePages.map((p) => p.id), pageId)))
  }
  const linkText: LinkText = (n, p) => labels.get(`${n}/${p}`) ?? linkLabel({ kind: 'missing' })

  const records = await db.images.bulkGet([...imageIds])
  const images = new Map<string, ImageRecord>()
  records.forEach((r) => r && images.set(r.id, r))

  return { note, pages, model: buildExportNote(note.title, pages, linkText), images }
}
