import { describe, expect, it } from 'vitest'
import { getSchema, type JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { buildExtensions } from '../src/editor/extensions'
import { movableAt, movableBlocks, normalizePositions, planMove, planMoveAdjacent } from '../src/editor/blockMove'

// 行の移動(計算部分)のテスト

const schema = getSchema(buildExtensions({ undo() {}, redo() {}, closeGroup() {} }))

// ---- 文書を組み立てる小道具 ----
const txt = (t: string): JSONContent[] => (t ? [{ type: 'text', text: t }] : [])
const p = (t: string): JSONContent => ({ type: 'paragraph', content: txt(t) })
const h = (level: number, t: string): JSONContent => ({ type: 'heading', attrs: { level }, content: txt(t) })
const li = (t: string, ...nested: JSONContent[]): JSONContent => ({ type: 'listItem', content: [p(t), ...nested] })
const ti = (t: string, checked = false): JSONContent => ({ type: 'taskItem', attrs: { checked }, content: [p(t)] })
const ul = (...items: JSONContent[]): JSONContent => ({ type: 'bulletList', content: items })
const ol = (...items: JSONContent[]): JSONContent => ({ type: 'orderedList', attrs: { start: 1, type: null }, content: items })
const tl = (...items: JSONContent[]): JSONContent => ({ type: 'taskList', content: items })
const toggle = (title: string, ...body: JSONContent[]): JSONContent => ({
  type: 'toggleHeading',
  attrs: { level: 2, open: true },
  content: [{ type: 'toggleTitle', content: txt(title) }, ...body],
})
const doc = (...blocks: JSONContent[]): PMNode => schema.nodeFromJSON({ type: 'doc', content: blocks })

/** その文字の行の位置(リスト項目・トグル見出しは、最初の行の文字で探す) */
function at(d: PMNode, text: string): number {
  const found = movableBlocks(d).filter((b) => b.node.firstChild?.textContent === text || b.node.textContent === text)
  if (!found.length) throw new Error(`行「${text}」が見つかりません`)
  return found[found.length - 1].pos
}
/** 行の後ろの位置 */
const afterOf = (d: PMNode, text: string) => at(d, text) + d.nodeAt(at(d, text))!.nodeSize

/** 1ページの中で動かす */
function moveIn(d: PMNode, texts: string[], target: number): PMNode | null {
  const r = planMove(new Map([['a', d]]), [{ pageId: 'a', positions: texts.map((t) => at(d, t)) }], {
    pageId: 'a',
    pos: target,
  })
  return r ? r.docs.get('a')! : null
}

/** 結果が schema に合っているか(壊れた文書を作っていないか)も確かめる */
function expectDoc(actual: PMNode | null | undefined, expected: PMNode) {
  expect(actual).toBeTruthy()
  actual!.check()
  expect(actual!.toJSON()).toEqual(expected.toJSON())
}

describe('動かせる行の判定', () => {
  it('段落・見出し・リスト項目・ToDo・トグル見出しは動かせる。リスト項目の中の段落は項目ごと', () => {
    const d = doc(p('A'), h(1, 'B'), ul(li('C')), tl(ti('D')), toggle('E', p('F')))
    const names = movableBlocks(d).map((b) => b.node.type.name)
    expect(names).toEqual(['paragraph', 'heading', 'listItem', 'taskItem', 'toggleHeading', 'paragraph'])
  })

  it('文字の途中の位置から、その行を探せる', () => {
    const d = doc(p('A'), ul(li('BB')))
    const inside = at(d, 'BB') + 3 // 項目の中の段落の文字の中
    expect(movableAt(d, inside)?.node.type.name).toBe('listItem')
  })

  it('トグル見出しの見出し部分では、トグル見出し全体が対象', () => {
    const d = doc(toggle('T', p('X')))
    expect(movableAt(d, 3)?.node.type.name).toBe('toggleHeading')
  })

  it('トグル見出しとその中身を両方選んだら、外側だけにまとめる', () => {
    const d = doc(toggle('T', p('X')), p('Y'))
    expect(normalizePositions(d, [at(d, 'X'), at(d, 'T')])).toEqual([at(d, 'T')])
  })
})

describe('同じページの中での移動', () => {
  it('段落を後ろへ', () => {
    const d = doc(p('A'), p('B'), p('C'))
    expectDoc(moveIn(d, ['A'], afterOf(d, 'C')), doc(p('B'), p('C'), p('A')))
  })

  it('段落を前へ', () => {
    const d = doc(p('A'), p('B'), p('C'))
    expectDoc(moveIn(d, ['C'], at(d, 'A')), doc(p('C'), p('A'), p('B')))
  })

  it('離れた行をまとめて動かすと、元の順のまま並ぶ', () => {
    const d = doc(p('A'), p('B'), p('C'), p('D'), p('E'))
    expectDoc(moveIn(d, ['D', 'B'], afterOf(d, 'E')), doc(p('A'), p('C'), p('E'), p('B'), p('D')))
  })

  it('リストの項目の並び替え', () => {
    const d = doc(ul(li('A'), li('B'), li('C')))
    expectDoc(moveIn(d, ['A'], afterOf(d, 'B')), doc(ul(li('B'), li('A'), li('C'))))
  })

  it('リストの項目をリストの外へ出すと、同じ種類のリストになる', () => {
    const d = doc(ol(li('A'), li('B')), p('X'))
    expectDoc(moveIn(d, ['B'], afterOf(d, 'X')), doc(ol(li('A')), p('X'), ol(li('B'))))
  })

  it('リストの最後の1項目を出すと、空のリストは残らない', () => {
    const d = doc(ul(li('A')), p('X'))
    expectDoc(moveIn(d, ['A'], afterOf(d, 'X')), doc(p('X'), ul(li('A'))))
  })

  it('ToDoの項目を普通のリストへ入れると、普通の項目になる(逆も)', () => {
    const d = doc(ul(li('A')), tl(ti('T', true)))
    expectDoc(moveIn(d, ['T'], afterOf(d, 'A')), doc(ul(li('A'), li('T'))))
    const d2 = doc(ul(li('A')), tl(ti('T')))
    expectDoc(moveIn(d2, ['A'], afterOf(d2, 'T')), doc(tl(ti('T'), ti('A'))))
  })

  it('リストの項目の間に見出しを入れようとすると、リストの後ろに入る', () => {
    const d = doc(h(2, 'H'), ul(li('A'), li('B')))
    expectDoc(moveIn(d, ['H'], afterOf(d, 'A')), doc(ul(li('A'), li('B')), h(2, 'H')))
  })

  it('トグル見出しの中へ入れられる', () => {
    const d = doc(toggle('T', p('X')), p('Y'))
    expectDoc(moveIn(d, ['Y'], afterOf(d, 'X')), doc(toggle('T', p('X'), p('Y'))))
  })

  it('トグル見出しの中身が1行だけのとき、その行を出しても見出しは消えず空の行が残る', () => {
    const d = doc(toggle('T', p('X')), p('Y'))
    expectDoc(moveIn(d, ['X'], afterOf(d, 'Y')), doc(toggle('T', p('')), p('Y'), p('X')))
  })

  it('トグル見出しは中身ごと動く', () => {
    const d = doc(p('A'), toggle('T', p('X'), p('Z')))
    expectDoc(moveIn(d, ['T'], at(d, 'A')), doc(toggle('T', p('X'), p('Z')), p('A')))
  })

  it('1行だけのページで、その行を同じ場所に落としても何も変わらない(空の行が増えない)', () => {
    const d = doc(p('A'))
    expect(moveIn(d, ['A'], 0)).toBeNull()
    expect(moveIn(d, ['A'], d.content.size)).toBeNull()
  })

  it('トグル見出しを自分の中へは動かせない', () => {
    const d = doc(toggle('T', p('X')))
    expect(moveIn(d, ['T'], afterOf(d, 'X'))).toBeNull()
  })

  it('同じ場所へ落としたら何もしない', () => {
    const d = doc(p('A'), p('B'))
    expect(moveIn(d, ['A'], at(d, 'B'))).toBeNull()
    expect(moveIn(d, ['A'], 0)).toBeNull()
  })

  it('文字の装飾は動かしても残る', () => {
    const d = schema.nodeFromJSON({
      type: 'doc',
      content: [
        p('A'),
        { type: 'paragraph', content: [{ type: 'text', text: '色', marks: [{ type: 'textColor', attrs: { color: 'red' } }] }] },
      ],
    })
    const r = moveIn(d, ['色'], 0)!
    expect(r.firstChild!.firstChild!.marks.map((m) => m.type.name)).toEqual(['textColor'])
  })
})

describe('別のページへの移動', () => {
  it('元のページから消え、移動先のページに入る(どちらも結果に入る)', () => {
    const a = doc(p('A1'), p('A2'), p('A3'))
    const b = doc(p('B1'))
    const r = planMove(new Map([['a', a], ['b', b]]), [{ pageId: 'a', positions: [at(a, 'A1'), at(a, 'A3')] }], {
      pageId: 'b',
      pos: b.content.size,
    })!
    expectDoc(r.docs.get('a'), doc(p('A2')))
    expectDoc(r.docs.get('b'), doc(p('B1'), p('A1'), p('A3')))
  })

  it('先頭へ入れる', () => {
    const a = doc(p('A1'), p('A2'))
    const b = doc(p('B1'))
    const r = planMove(new Map([['a', a], ['b', b]]), [{ pageId: 'a', positions: [at(a, 'A2')] }], { pageId: 'b', pos: 0 })!
    expectDoc(r.docs.get('b'), doc(p('A2'), p('B1')))
    expect(r.insertedAt).toBe(0)
  })

  it('ページの行を全部出すと、元のページには空の行が1つ残る', () => {
    const a = doc(p('A1'))
    const b = doc(p('B1'))
    const r = planMove(new Map([['a', a], ['b', b]]), [{ pageId: 'a', positions: [0] }], { pageId: 'b', pos: 0 })!
    expectDoc(r.docs.get('a'), doc(p('')))
  })

  it('複数のページから選んだ行を、ページの順にまとめて動かす', () => {
    const a = doc(p('A1'), p('A2'))
    const b = doc(p('B1'), p('B2'))
    const c = doc(p('C1'))
    const r = planMove(
      new Map([['a', a], ['b', b], ['c', c]]),
      [
        { pageId: 'a', positions: [at(a, 'A2')] },
        { pageId: 'b', positions: [at(b, 'B1')] },
      ],
      { pageId: 'c', pos: c.content.size },
    )!
    expectDoc(r.docs.get('a'), doc(p('A1')))
    expectDoc(r.docs.get('b'), doc(p('B2')))
    expectDoc(r.docs.get('c'), doc(p('C1'), p('A2'), p('B1')))
  })

  it('移動先のページの行も一緒に選んでいてもよい', () => {
    const a = doc(p('A1'))
    const b = doc(p('B1'), p('B2'), p('B3'))
    const r = planMove(
      new Map([['a', a], ['b', b]]),
      [
        { pageId: 'a', positions: [0] },
        { pageId: 'b', positions: [at(b, 'B3')] },
      ],
      { pageId: 'b', pos: at(b, 'B2') },
    )!
    expectDoc(r.docs.get('b'), doc(p('B1'), p('A1'), p('B3'), p('B2')))
  })
})

describe('1行ずつ上下へ(Alt+↑ / Alt+↓)', () => {
  it('上へ・下へ', () => {
    const d = doc(p('A'), p('B'), p('C'))
    expectDoc(planMoveAdjacent(d, at(d, 'B') + 1, 'up')?.doc, doc(p('B'), p('A'), p('C')))
    expectDoc(planMoveAdjacent(d, at(d, 'B') + 1, 'down')?.doc, doc(p('A'), p('C'), p('B')))
  })

  it('ページの先頭・末尾ではそれ以上動かない', () => {
    const d = doc(p('A'), p('B'))
    expect(planMoveAdjacent(d, 1, 'up')).toBeNull()
    expect(planMoveAdjacent(d, at(d, 'B') + 1, 'down')).toBeNull()
  })

  it('リストの項目はリストの中で動き、端ではリストの外へ出る', () => {
    const d = doc(p('X'), ul(li('A'), li('B')))
    expectDoc(planMoveAdjacent(d, at(d, 'B') + 2, 'up')?.doc, doc(p('X'), ul(li('B'), li('A'))))
    expectDoc(planMoveAdjacent(d, at(d, 'A') + 2, 'up')?.doc, doc(p('X'), ul(li('A')), ul(li('B'))))
  })

  it('入れ子のリストの端では、外側のリストの項目として出る', () => {
    const d = doc(ul(li('A', ul(li('A1'))), li('B')))
    expectDoc(planMoveAdjacent(d, at(d, 'A1') + 2, 'down')?.doc, doc(ul(li('A'), li('A1'), li('B'))))
  })

  it('トグル見出しの中身の先頭で上へ → トグル見出しの前へ出る', () => {
    const d = doc(p('A'), toggle('T', p('X'), p('Y')))
    expectDoc(planMoveAdjacent(d, at(d, 'X') + 1, 'up')?.doc, doc(p('A'), p('X'), toggle('T', p('Y'))))
  })

  it('動かした行の位置を返す(カーソルを行に置き直すため)', () => {
    const d = doc(p('A'), p('B'))
    const r = planMoveAdjacent(d, at(d, 'B') + 1, 'up')!
    expect(r.insertedAt).toBe(0)
    expect(r.doc.nodeAt(r.insertedAt)?.textContent).toBe('B')
  })
})

describe('ページごとにエディタの schema が別々のとき(実際の画面と同じ)', () => {
  // 画面では、ページごとにエディタを作るので schema もページごとに別物になる。
  // 不具合:左のページの行を右のページへドラッグすると、移動できず元の場所に戻っていた
  const schemaB = getSchema(buildExtensions({ undo() {}, redo() {}, closeGroup() {} }))
  const docB = (...blocks: JSONContent[]) => schemaB.nodeFromJSON({ type: 'doc', content: blocks })

  it('別の schema のページへ、段落を移動できる', () => {
    const a = doc(p('A1'), p('A2'))
    const b = docB(p('B1'))
    expect(a.type.schema).not.toBe(b.type.schema)
    const r = planMove(new Map([['a', a], ['b', b]]), [{ pageId: 'a', positions: [at(a, 'A2')] }], {
      pageId: 'b',
      pos: b.content.size,
    })
    expect(r).not.toBeNull()
    expect(r!.docs.get('a')!.toJSON()).toEqual(doc(p('A1')).toJSON())
    const movedB = r!.docs.get('b')!
    movedB.check()
    // 入れたあとの行は、移動先のページの schema のもの(そのページのエディタで使える)
    expect(movedB.type.schema).toBe(schemaB)
    expect(movedB.lastChild!.type).toBe(schemaB.nodes.paragraph)
    expect(movedB.toJSON()).toEqual(docB(p('B1'), p('A2')).toJSON())
  })

  it('別の schema のページへ、リストの項目・トグル見出し・装飾つきの行を移動できる', () => {
    const colored = {
      type: 'paragraph',
      content: [{ type: 'text', text: '色', marks: [{ type: 'textColor', attrs: { color: 'red' } }] }],
    }
    const a = doc(ol(li('L1'), li('L2')), toggle('T', p('X')), colored)
    const b = docB(p('B1'))
    const r = planMove(
      new Map([['a', a], ['b', b]]),
      [{ pageId: 'a', positions: [at(a, 'L2'), at(a, 'T'), at(a, '色')] }],
      { pageId: 'b', pos: 0 },
    )
    expect(r).not.toBeNull()
    const movedB = r!.docs.get('b')!
    movedB.check()
    expect(movedB.toJSON()).toEqual(docB(ol(li('L2')), toggle('T', p('X')), colored, p('B1')).toJSON())
  })

  it('別の schema のリストの中へ、リストの項目を入れられる', () => {
    const a = doc(ul(li('A')))
    const b = docB(ul(li('B1'), li('B2')))
    const posB1End = b.firstChild!.firstChild!.nodeSize + 1 // B1 の後ろ(リストの中)
    const r = planMove(new Map([['a', a], ['b', b]]), [{ pageId: 'a', positions: [at(a, 'A')] }], {
      pageId: 'b',
      pos: posB1End,
    })
    expect(r).not.toBeNull()
    expect(r!.docs.get('b')!.toJSON()).toEqual(docB(ul(li('B1'), li('A'), li('B2'))).toJSON())
  })
})
