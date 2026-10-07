import type { JSONContent } from '@tiptap/core'

/** カードに出す行数 */
const PREVIEW_LINES = 4

export interface PreviewLine {
  kind: 'h1' | 'h2' | 'h3' | 'p'
  text: string
}

/** ページ内容から、最初の数行の文字を取り出す(カードの中身用) */
export function previewLines(doc: JSONContent, max = PREVIEW_LINES): PreviewLine[] {
  const lines: PreviewLine[] = []
  const textOf = (n: JSONContent): string =>
    n.type === 'text' ? (n.text ?? '') : (n.content ?? []).map(textOf).join('')
  const walk = (n: JSONContent, heading: PreviewLine['kind'] = 'p') => {
    if (lines.length >= max) return
    if (n.type === 'heading') {
      const level = n.attrs?.level as 1 | 2 | 3
      lines.push({ kind: `h${level}` as PreviewLine['kind'], text: textOf(n) })
      return
    }
    if (n.type === 'toggleHeading') {
      const level = n.attrs?.level as 1 | 2 | 3
      ;(n.content ?? []).forEach((c, i) => walk(c, i === 0 ? (`h${level}` as PreviewLine['kind']) : 'p'))
      return
    }
    if (n.type === 'paragraph' || n.type === 'toggleTitle') {
      const text = textOf(n)
      if (text.trim()) lines.push({ kind: heading, text })
      return
    }
    ;(n.content ?? []).forEach((c) => walk(c))
  }
  walk(doc)
  return lines
}
