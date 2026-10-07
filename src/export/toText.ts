import { plainText, type Block, type ExportNote } from './model'
import { stickyLabel } from './stickyLabel'

/**
 * テキスト(.txt)の出力。文字だけを書き出す(色・装飾・画像は出さない)
 */

/** リストの記号(絵文字にならない普通の文字を使う:U+30FB・U+25A1・U+25A0) */
function listMark(b: Extract<Block, { kind: 'listItem' }>): string {
  if (b.list === 'ordered') return `${b.number}.`
  if (b.list === 'task') return b.checked ? '■' : '□'
  return '・'
}

/** 改行を含む文字の2行目以降にも、字下げを付ける */
const indentLines = (text: string, indent: string) => text.split('\n').join(`\n${indent}`)

function blocksToLines(blocks: Block[]): string[] {
  const lines: string[] = []
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading':
      case 'paragraph':
        lines.push(plainText(b.runs))
        break
      case 'listItem': {
        const indent = '  '.repeat(b.depth)
        const mark = listMark(b)
        const pad = b.continued ? ' '.repeat(mark.length + 1) : `${mark} `
        lines.push(indent + pad + indentLines(plainText(b.runs), indent + ' '.repeat(mark.length + 1)))
        break
      }
      case 'table':
        // 表はタブ区切り(表計算ソフトに貼り付けやすい)。セルの中の改行は空白にする
        for (const row of b.rows) {
          lines.push(row.map((c) => c.paragraphs.map(plainText).join(' ').replace(/\s*\n\s*/g, ' ')).join('\t'))
        }
        break
      case 'noteLink':
        lines.push(b.text)
        break
      case 'image':
        // 文字だけの出力なので、画像は出さない
        break
    }
  }
  return lines
}

export function toText(note: ExportNote): string {
  const out: string[] = [note.title, '']
  note.pages.forEach((page, i) => {
    out.push(`── ${i + 1}ページ ──`, '')
    out.push(...blocksToLines(page.blocks))
    // 付箋は1つずつ「【付箋(色)】」の見出しを付ける(読み込むときに色を戻せるように)
    for (const s of page.stickies) {
      out.push('', `【${stickyLabel(s.color)}】`)
      out.push(...blocksToLines(s.blocks))
    }
    out.push('')
  })
  // 行末の空白と、最後の余分な空行を取る
  return (
    out
      .map((l) => l.replace(/[ \t]+$/, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  )
}
