import type { JSONContent } from '@tiptap/core'

/**
 * ページ内容(TipTap の JSON)をたどる・書き換える関数。
 * 画像の参照集め・バックアップの読み込み時の ID の振り直し・検索などで使う
 */

/** すべてのノードを順にたどる */
export function walkContent(node: JSONContent | undefined, fn: (n: JSONContent) => void) {
  if (!node) return
  fn(node)
  node.content?.forEach((c) => walkContent(c, fn))
}

/** ノードを書き換えた新しい JSON を返す(元の JSON は変えない) */
export function mapContent(node: JSONContent, fn: (n: JSONContent) => JSONContent): JSONContent {
  const mapped = fn({ ...node })
  return mapped.content ? { ...mapped, content: mapped.content.map((c) => mapContent(c, fn)) } : mapped
}

/** 本文で使っている画像の id */
export function collectImageIds(node: JSONContent | undefined, into = new Set<string>()): Set<string> {
  walkContent(node, (n) => {
    if (n.type === 'image' && typeof n.attrs?.imageId === 'string') into.add(n.attrs.imageId)
  })
  return into
}

/**
 * 画像・ノートへのリンクの参照先の id を書き換える(バックアップを「追加」で読み込むとき)。
 * 表にない id はそのまま
 */
export function remapContentIds(
  node: JSONContent,
  ids: { images: Map<string, string>; notes: Map<string, string>; pages: Map<string, string> },
): JSONContent {
  return mapContent(node, (n) => {
    if (n.type === 'image' && typeof n.attrs?.imageId === 'string' && ids.images.has(n.attrs.imageId)) {
      return { ...n, attrs: { ...n.attrs, imageId: ids.images.get(n.attrs.imageId) } }
    }
    if (n.type === 'noteLink' && n.attrs) {
      const attrs = { ...n.attrs }
      if (typeof attrs.noteId === 'string' && ids.notes.has(attrs.noteId)) attrs.noteId = ids.notes.get(attrs.noteId)
      if (typeof attrs.pageId === 'string' && ids.pages.has(attrs.pageId)) attrs.pageId = ids.pages.get(attrs.pageId)
      return { ...n, attrs }
    }
    return n
  })
}
