import type { Block, ExportNote, Run } from './model'
import { stickyLabel } from './stickyLabel'

/**
 * Markdown(.md)の出力。他のノートアプリへ移す用。
 * 見出し・リスト・表・リンク・太字・取り消し線を出す。色・マーカー・ラインは消える。画像は「[画像]」と書く
 */

/** Markdown の記号として読まれてしまう文字に「\」を付ける */
export function escapeMd(text: string): string {
  return text.replace(/[\\`*_~[\]<>]/g, '\\$&')
}

/** 行の頭で、見出し・リスト・引用として読まれてしまう書き方を防ぐ */
function escapeLineStart(line: string): string {
  return line.replace(/^(\s*)([#>+-]|\d+[.)])(?=\s|$)/, (_m, sp: string, mark: string) =>
    /^\d/.test(mark) ? `${sp}${mark.slice(0, -1)}\\${mark.slice(-1)}` : `${sp}\\${mark}`,
  )
}

/** 太字・取り消し線の記号は、前後に空白があると効かないので、空白を外に出す */
function wrap(text: string, mark: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : text
}

/** Run の並びを Markdown の文字にする。newline:改行(hardBreak)の書き方 */
export function runsToMd(runs: Run[], newline = '\\\n'): string {
  // 同じ装飾・同じリンクが続く Run はまとめる(「**a****b**」のようにならないように)
  const merged: Run[] = []
  for (const r of runs) {
    const last = merged[merged.length - 1]
    if (r.text !== '\n' && last && last.text !== '\n' && !!last.bold === !!r.bold && !!last.strike === !!r.strike && last.href === r.href) {
      last.text += r.text
    } else {
      merged.push({ ...r })
    }
  }
  return merged
    .map((r) => {
      if (r.text === '\n') return newline
      let s = escapeMd(r.text)
      if (r.strike) s = wrap(s, '~~')
      if (r.bold) s = wrap(s, '**')
      if (r.href) s = `[${s}](${r.href.replace(/[()\s]/g, encodeURIComponent)})`
      return s
    })
    .join('')
}

function tableToMd(rows: Extract<Block, { kind: 'table' }>['rows']): string[] {
  if (rows.length === 0) return []
  const cols = Math.max(...rows.map((r) => r.length))
  const cellText = (paragraphs: Run[][]) =>
    paragraphs
      .map((p) => runsToMd(p, '<br>'))
      .join('<br>')
      .replace(/\|/g, '\\|')
  const line = (cells: string[]) => `| ${Array.from({ length: cols }, (_, i) => cells[i] ?? '').join(' | ')} |`
  const [head, ...body] = rows
  // Markdown の表は1行目が見出し行になる
  return [
    line(head.map((c) => cellText(c.paragraphs))),
    line(Array.from({ length: cols }, () => '---')),
    ...body.map((r) => line(r.map((c) => cellText(c.paragraphs)))),
  ]
}

function blocksToMd(blocks: Block[]): string {
  const parts: string[] = []
  // 入れ子のリストの字下げ:深さごとに、親の項目の記号の幅だけ下げる
  const markWidths: number[] = []
  let prevWasList = false

  for (const b of blocks) {
    const isList = b.kind === 'listItem'
    let text: string
    switch (b.kind) {
      case 'heading':
        text = `${'#'.repeat(b.level)} ${runsToMd(b.runs, ' ')}`.trimEnd()
        break
      case 'paragraph':
        text = escapeLineStart(runsToMd(b.runs))
        break
      case 'listItem': {
        const mark = b.list === 'ordered' ? `${b.number}.` : b.list === 'task' ? `- [${b.checked ? 'x' : ' '}]` : '-'
        // ToDo(「- [ ]」)の中身の字下げは「- 」の幅
        if (!b.continued) markWidths[b.depth] = b.list === 'task' ? 2 : mark.length + 1
        markWidths.length = b.depth + 1
        const indent = ' '.repeat(markWidths.slice(0, b.depth).reduce((a, w) => a + w, 0))
        const contentIndent = indent + ' '.repeat(markWidths[b.depth] ?? 2)
        const body = runsToMd(b.runs).split('\n').join(`\n${contentIndent}`)
        text = b.continued ? `${contentIndent}${body}` : `${indent}${mark} ${body}`.trimEnd()
        break
      }
      case 'table':
        text = tableToMd(b.rows).join('\n')
        break
      case 'image':
        text = '[画像]'
        break
      case 'noteLink':
        text = escapeLineStart(escapeMd(b.text))
        break
    }
    if (!isList) markWidths.length = 0
    // リストの項目どうしは詰めて、それ以外は空行で区切る
    if (parts.length > 0) parts.push(isList && prevWasList ? '\n' : '\n\n')
    parts.push(text)
    prevWasList = isList
  }
  return parts.join('')
}

export function toMarkdown(note: ExportNote): string {
  const out: string[] = [`# ${escapeMd(note.title)}`]
  note.pages.forEach((page, i) => {
    if (i > 0) out.push('---')
    const body = blocksToMd(page.blocks)
    if (body.trim()) out.push(body)
    // 付箋は1つずつ「**付箋(色)**」の見出し+引用(>)にする(読み込むときに色を戻せるように)
    for (const s of page.stickies) {
      out.push(`**${stickyLabel(s.color)}**`)
      out.push(
        blocksToMd(s.blocks)
          .split('\n')
          .map((l) => (l ? `> ${l}` : '>'))
          .join('\n'),
      )
    }
  })
  // 行末の空白は消す(改行は「\」で表しているので、空白は意味を持たない)
  return out.join('\n\n').replace(/[ \t]+$/gm, '') + '\n'
}
