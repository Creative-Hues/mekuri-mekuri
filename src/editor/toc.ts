import type { JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * 目次(画面に関係しない部分)。
 * 見出し(大・中・小)とトグル見出しを、ページの中の順に集める。
 * 目次の項目は「そのページの何番目の見出しか」(index)で見出しを指す。
 * JSON とエディタの文書は同じ順にたどるので、番号が一致する
 */

export interface TocItem {
  /** 1〜3(大・中・小) */
  level: number
  text: string
  /** ページの中で何番目の見出しか(0から) */
  index: number
  /** トグル見出しか */
  toggle: boolean
}

const isHeadingType = (name: string | undefined) => name === 'heading' || name === 'toggleHeading'

function textOf(n: JSONContent): string {
  return n.type === 'text' ? (n.text ?? '') : (n.content ?? []).map(textOf).join('')
}

/** ページ内容から見出しを集める */
export function collectHeadings(doc: JSONContent): TocItem[] {
  const items: TocItem[] = []
  const walk = (n: JSONContent) => {
    if (n.type === 'heading') {
      items.push({ level: Number(n.attrs?.level) || 1, text: textOf(n).trim(), index: items.length, toggle: false })
      return
    }
    if (n.type === 'toggleHeading') {
      const title = n.content?.[0]
      items.push({
        level: Number(n.attrs?.level) || 1,
        text: title ? textOf(title).trim() : '',
        index: items.length,
        toggle: true,
      })
    }
    ;(n.content ?? []).forEach(walk)
  }
  walk(doc)
  return items
}

/** index 番目の見出しの位置。なければ null */
export function findHeadingPos(doc: PMNode, index: number): number | null {
  let count = 0
  let found: number | null = null
  doc.descendants((node, pos) => {
    if (found !== null) return false
    if (isHeadingType(node.type.name)) {
      if (count === index) {
        found = pos
        return false
      }
      count++
    }
    return !node.isTextblock
  })
  return found
}

/** pos の見出しを見えるようにするために開く必要がある、閉じたトグル見出しの位置 */
export function closedTogglesAround(doc: PMNode, pos: number): number[] {
  const $pos = doc.resolve(pos)
  const list: number[] = []
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d)
    if (node.type.name === 'toggleHeading' && !node.attrs.open) list.push($pos.before(d))
  }
  return list
}
