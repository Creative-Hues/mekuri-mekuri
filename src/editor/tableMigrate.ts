import type { JSONContent } from '@tiptap/core'

/**
 * 表の見出しの持ち方の移し替え(スキーマ v6、アプリ 1.3.0〜)。
 *
 * v5 までは、見出しは「見出しセル(tableHeader)」という種類のセルで持っていた
 * (このアプリでは作らず、ほかのアプリから貼り付けた表にだけあった)。
 * v6 からは、表の設定 headerRow(1行目を見出し)・headerColumn(1列目を見出し)で持つ。
 * 行や列を入れ替えても「1行目が見出し」のままにするため。
 *
 * - tableHeader はすべて tableCell にする(色などの attrs はそのまま)
 * - 1行目がすべて tableHeader だった表は headerRow: true
 * - 2行以上あり、各行の最初のセルがすべて tableHeader だった表は headerColumn: true
 * - 何度通しても同じ結果。変える所のない内容は、同じオブジェクトをそのまま返す
 *
 * DB の移し替え(db.ts)・バックアップファイルの読み込み(format.ts)・貼り付け(table.ts)で同じ関数を使う。
 */

const isHeader = (n: JSONContent | undefined) => n?.type === 'tableHeader'

/** 表1つを v6 の形にする */
function upgradeTable(table: JSONContent): JSONContent {
  const rows = table.content ?? []
  const hasHeaderCell = rows.some((r) => (r.content ?? []).some(isHeader))
  const attrs = table.attrs ?? {}
  // 見出しの設定がまだない表だけ、見出しセルから判定する
  const needAttrs = typeof attrs.headerRow !== 'boolean' || typeof attrs.headerColumn !== 'boolean'
  if (!hasHeaderCell && !needAttrs) return table

  // 見出しセルがあれば、その並びから見出しの設定を決める(すでに見出しにしている設定は残す)。
  // 貼り付けた表は、読み込んだ時点で設定が false になっているので、見出しセルを優先して判定する
  const firstRow = rows[0]?.content ?? []
  const headerRow = attrs.headerRow === true || (firstRow.length > 0 && firstRow.every(isHeader))
  const headerColumn = attrs.headerColumn === true || (rows.length >= 2 && rows.every((r) => isHeader(r.content?.[0])))

  return {
    ...table,
    attrs: { ...attrs, headerRow, headerColumn },
    content: hasHeaderCell
      ? rows.map((r) =>
          (r.content ?? []).some(isHeader)
            ? { ...r, content: (r.content ?? []).map((c) => (isHeader(c) ? { ...c, type: 'tableCell' } : c)) }
            : r,
        )
      : table.content,
  }
}

/** ページ内容(または付箋の内容)の中の表をすべて v6 の形にする */
export function upgradeTablesToV6(content: JSONContent): JSONContent {
  if (!content || typeof content !== 'object') return content
  if (content.type === 'table') return upgradeTable(content)
  if (!Array.isArray(content.content)) return content
  let changed = false
  const next = content.content.map((child) => {
    const c = upgradeTablesToV6(child)
    if (c !== child) changed = true
    return c
  })
  return changed ? { ...content, content: next } : content
}
