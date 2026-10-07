import { columnAligns, hasMergedCells, tableGrid, type Block, type ExportNote, type TableBlock } from './model'

/**
 * 書き出しで、その形式では表せなかったもののお知らせ(書き出したあとに1回だけ出す)。
 * Word・PDF は表の機能(結合・列の幅・配置・見出し)をそのまま再現するので、お知らせはない。
 * Markdown・テキストで表せないものは、近い形にして書き出し、ここで知らせる
 */

export type NoticeFormat = 'docx' | 'md' | 'txt'

function tablesOf(note: ExportNote): TableBlock[] {
  const all: Block[] = note.pages.flatMap((p) => [...p.blocks, ...p.stickies.flatMap((s) => s.blocks)])
  return all.filter((b): b is TableBlock => b.kind === 'table')
}

export function exportNotices(notes: ExportNote[], format: NoticeFormat): string[] {
  if (format === 'docx') return []
  const tables = notes.flatMap(tablesOf)
  const out: string[] = []
  const merged = tables.some(hasMergedCells)
  if (format === 'md') {
    if (merged) out.push('結合したセルは、分けて出しました(文字は左上のセルに入れています)。')
    if (tables.some((t) => t.headerColumn)) out.push('表の見出しの列は、太字にしました。')
    if (tables.some((t) => columnAligns(tableGrid(t.rows)).includes('mixed'))) {
      out.push('列の中で文字の配置が違う表は、その列を左寄せにしました。')
    }
  } else if (merged) {
    out.push('結合したセルは、分けて出しました(文字は左上のマスに入れています)。')
  }
  return out
}
