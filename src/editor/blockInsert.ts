import { NodeSelection, TextSelection, type Transaction } from '@tiptap/pm/state'

/**
 * 画像・ノートへのリンクを入れたあと、カーソルをそのすぐ下の行に置く。
 * (入れた直後は画像そのものが選ばれた状態になり、続けて入力・挿入すると画像が置き換わってしまうため)
 * 下に文字の行がなければ、空の行を足す
 */
export function placeCursorAfterBlock(tr: Transaction) {
  const sel = tr.selection
  if (!(sel instanceof NodeSelection)) return
  const end = sel.to
  const next = tr.doc.resolve(end).nodeAfter
  if (!next || !next.isTextblock) tr.insert(end, tr.doc.type.schema.nodes.paragraph.create())
  tr.setSelection(TextSelection.create(tr.doc, end + 1))
}
