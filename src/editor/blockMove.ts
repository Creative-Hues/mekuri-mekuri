import { Fragment, type Node as PMNode, type NodeType, type Schema } from '@tiptap/pm/model'
import { Transform } from '@tiptap/pm/transform'

/**
 * 行の移動(画面に関係しない計算部分)。
 *
 * 「行」= 段落・見出し・リストの1項目・ToDoの1項目・トグル見出し(中身ごと)。
 * リストの項目の中の段落は、項目ごと動かすので単独では動かさない。
 * 位置(pos)は ProseMirror の位置で、行の「直前」を指す。
 */

const ITEM_TYPES = new Set(['listItem', 'taskItem'])
const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList'])

/** この行は動かせるか */
export function isMovable(node: PMNode, parent: PMNode | null): boolean {
  const t = node.type.name
  if (ITEM_TYPES.has(t) || t === 'toggleHeading') return true
  if (t === 'paragraph' || t === 'heading') return !parent || !ITEM_TYPES.has(parent.type.name)
  return false
}

export interface Block {
  pos: number
  node: PMNode
}

/** pos を含む、いちばん内側の動かせる行 */
export function movableAt(doc: PMNode, pos: number): Block | null {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)))
  const after = $pos.nodeAfter
  if (after && !after.isInline && isMovable(after, $pos.parent)) return { pos: $pos.pos, node: after }
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d)
    if (isMovable(node, $pos.node(d - 1))) return { pos: $pos.before(d), node }
  }
  return null
}

/** ページの中の動かせる行をすべて(文書の順に。入れ子のリスト項目も含む) */
export function movableBlocks(doc: PMNode): Block[] {
  const list: Block[] = []
  doc.descendants((node, pos, parent) => {
    if (isMovable(node, parent)) list.push({ pos, node })
    return !node.isTextblock
  })
  return list
}

/**
 * 選んだ行の位置を整える:正しくない位置を除き、
 * ほかの選んだ行の中にある行(トグル見出しを選んだときの中身など)は外側にまとめ、順に並べる
 */
export function normalizePositions(doc: PMNode, positions: number[]): number[] {
  const blocks = [...new Set(positions)]
    .filter((p) => p >= 0 && p < doc.content.size)
    .map((p) => ({ pos: p, node: doc.nodeAt(p) }))
    .filter((b): b is Block => !!b.node && isMovable(b.node, doc.resolve(b.pos).parent))
    .sort((a, b) => a.pos - b.pos)
  const result: number[] = []
  let coverEnd = -1
  for (const b of blocks) {
    if (b.pos < coverEnd) continue
    result.push(b.pos)
    coverEnd = b.pos + b.node.nodeSize
  }
  return result
}

/** 取り出した行(リスト項目なら、元のリストの種類も覚えておく) */
interface Taken {
  node: PMNode
  listType: NodeType | null
}

/** 空にできない場所に残した仮の空行(あとで不要なら消す)。mapFrom はその時点の変更の数 */
interface Placeholder {
  pos: number
  mapFrom: number
}

/** pos の行を消す。消すと親が空になってしまう場合は、親ごと消すか空の段落を残す */
function removeNodeAt(tr: Transform, pos: number, placeholders: Placeholder[]) {
  const node = tr.doc.nodeAt(pos)
  if (!node) return
  const $p = tr.doc.resolve(pos)
  const parent = $p.parent
  const index = $p.index()
  if (parent.canReplace(index, index + 1)) {
    tr.delete(pos, pos + node.nodeSize)
  } else if (LIST_TYPES.has(parent.type.name) && $p.depth > 0) {
    // リストの最後の1項目:リストごと消す
    removeNodeAt(tr, $p.before(), placeholders)
  } else {
    // ページやトグル見出しの中身は空にできないので、空の段落を残す
    tr.replaceWith(pos, pos + node.nodeSize, tr.doc.type.schema.nodes.paragraph.create())
    placeholders.push({ pos, mapFrom: tr.mapping.maps.length })
  }
}

/** 行を取り出す(positions は normalizePositions 済み・tr.doc の位置) */
function takeBlocks(tr: Transform, positions: number[], placeholders: Placeholder[]): Taken[] {
  const taken: Taken[] = positions.map((pos) => {
    const node = tr.doc.nodeAt(pos)!
    const parent = tr.doc.resolve(pos).parent
    return { node, listType: ITEM_TYPES.has(node.type.name) ? parent.type : null }
  })
  // 後ろから消すと、前の位置がずれない
  for (let i = positions.length - 1; i >= 0; i--) removeNodeAt(tr, positions[i], placeholders)
  return taken
}

/** 入れる場所(親の種類)に合わせて形を変える。合わせられなければ null */
function adapt(taken: Taken[], parentType: NodeType): Fragment | null {
  const schema = parentType.schema
  const parentName = parentType.name
  if (LIST_TYPES.has(parentName)) {
    // リストの中:項目だけ入れられる。ToDoリストと普通のリストの間では項目の種類を変える
    const itemType = parentName === 'taskList' ? schema.nodes.taskItem : schema.nodes.listItem
    const nodes: PMNode[] = []
    for (const t of taken) {
      if (!ITEM_TYPES.has(t.node.type.name)) return null
      if (t.node.type === itemType) {
        nodes.push(t.node)
      } else {
        const attrs = itemType.name === 'taskItem' ? { checked: false } : null
        if (!itemType.validContent(t.node.content)) return null
        nodes.push(itemType.create(attrs, t.node.content, t.node.marks))
      }
    }
    return Fragment.fromArray(nodes)
  }
  // リストの外:続いているリスト項目は、元の種類のリストに包む
  const nodes: PMNode[] = []
  let run: PMNode[] = []
  let runType: NodeType | null = null
  const flush = () => {
    if (run.length && runType) nodes.push(runType.create(null, run))
    run = []
    runType = null
  }
  for (const t of taken) {
    if (ITEM_TYPES.has(t.node.type.name)) {
      const listType =
        t.listType ?? (t.node.type.name === 'taskItem' ? schema.nodes.taskList : schema.nodes.bulletList)
      if (runType && runType !== listType) flush()
      runType = listType
      run.push(t.node)
    } else {
      flush()
      nodes.push(t.node)
    }
  }
  flush()
  return Fragment.fromArray(nodes)
}

/**
 * 取り出した行を、移動先のページの schema の行に作り直す。
 * 画面ではページごとにエディタ(=schema)が別なので、別のページの行はそのままでは入れられない
 * (ProseMirror は行の種類を schema ごとに区別するため)。作り直せなければ null
 */
function toSchema(taken: Taken[], schema: Schema): Taken[] | null {
  try {
    return taken.map((t) =>
      t.node.type.schema === schema
        ? t
        : {
            node: schema.nodeFromJSON(t.node.toJSON()),
            listType: t.listType ? (schema.nodes[t.listType.name] ?? null) : null,
          },
    )
  } catch (e) {
    console.error('行を移動先のページに合わせられませんでした', e)
    return null
  }
}

/**
 * pos に行を入れる。その場所に入れられない形なら、1段ずつ外側へずらして入れる
 * (例:リストの項目と項目の間に見出しは入れられない → リストの後ろへ)。
 * 入れた位置を返す。入れられなければ null
 */
function insertBlocks(tr: Transform, pos: number, taken: Taken[]): number | null {
  const converted = toSchema(taken, tr.doc.type.schema)
  if (!converted) return null
  taken = converted
  let at = pos
  for (let guard = 0; guard < 50; guard++) {
    const $p = tr.doc.resolve(at)
    if ($p.parent.inlineContent) {
      // 文字の途中は指定できないので、その行の後ろにする
      at = $p.after()
      continue
    }
    const frag = adapt(taken, $p.parent.type)
    const index = $p.index()
    if (frag && $p.parent.canReplace(index, index, frag)) {
      tr.insert(at, frag)
      return at
    }
    if ($p.depth === 0) return null
    at = index === 0 ? $p.before() : $p.after()
  }
  return null
}

/** 行を入れたあと、もう要らなくなった仮の空行を消す(同じ場所に行が戻ってきた場合など) */
function dropPlaceholders(tr: Transform, placeholders: Placeholder[]) {
  const positions = placeholders
    .map((ph) => tr.mapping.slice(ph.mapFrom).map(ph.pos, 1))
    .sort((a, b) => b - a)
  for (const pos of positions) {
    const node = tr.doc.nodeAt(pos)
    if (!node || node.type.name !== 'paragraph' || node.content.size > 0) continue
    const $p = tr.doc.resolve(pos)
    const index = $p.index()
    if ($p.parent.childCount > 1 && $p.parent.canReplace(index, index + 1)) tr.delete(pos, pos + node.nodeSize)
  }
}

export interface MoveSource {
  pageId: string
  /** 選んだ行の位置(そのページの文書の位置) */
  positions: number[]
}

export interface MoveResult {
  /** 変わったページの新しい内容 */
  docs: Map<string, PMNode>
  /** 移動先のページで、入れた位置 */
  insertedAt: number
}

/**
 * 行を移動する。
 * - sources:ページの順に並べた「どのページのどの行か」(離れた行・複数ページでもよい)
 * - target:移動先のページと位置
 * 動かせない(移動先が動かす行の中にある、など)ときは null
 */
export function planMove(
  docs: Map<string, PMNode>,
  sources: MoveSource[],
  target: { pageId: string; pos: number },
): MoveResult | null {
  const trs = new Map<string, Transform>()
  const placeholders = new Map<string, Placeholder[]>()
  const trOf = (pageId: string) => {
    let tr = trs.get(pageId)
    if (!tr) {
      const doc = docs.get(pageId)
      if (!doc) throw new Error(`ページ ${pageId} の内容がありません`)
      tr = new Transform(doc)
      trs.set(pageId, tr)
    }
    return tr
  }

  const targetDoc = docs.get(target.pageId)
  if (!targetDoc || target.pos < 0 || target.pos > targetDoc.content.size) return null

  let targetPos = target.pos
  const taken: Taken[] = []
  let any = false
  for (const src of sources) {
    const doc = docs.get(src.pageId)
    if (!doc) continue
    const positions = normalizePositions(doc, src.positions)
    if (!positions.length) continue
    any = true
    if (src.pageId === target.pageId) {
      // 移動先が、動かす行の中にあるときは動かせない
      for (const p of positions) {
        const end = p + doc.nodeAt(p)!.nodeSize
        if (targetPos > p && targetPos < end) return null
      }
    }
    const tr = trOf(src.pageId)
    const before = tr.mapping.maps.length
    const phs = placeholders.get(src.pageId) ?? []
    placeholders.set(src.pageId, phs)
    taken.push(...takeBlocks(tr, positions, phs))
    if (src.pageId === target.pageId) targetPos = tr.mapping.slice(before).map(targetPos, -1)
  }
  if (!any) return null

  const tr = trOf(target.pageId)
  const insertedAt = insertBlocks(tr, targetPos, taken)
  if (insertedAt === null) return null
  const targetPhs = placeholders.get(target.pageId)
  let finalAt = insertedAt
  if (targetPhs?.length) {
    const before = tr.mapping.maps.length
    dropPlaceholders(tr, targetPhs)
    finalAt = tr.mapping.slice(before).map(insertedAt, 1)
  }

  const result = new Map<string, PMNode>()
  for (const [pageId, t] of trs) {
    if (!t.doc.eq(docs.get(pageId)!)) result.set(pageId, t.doc)
  }
  if (result.size === 0) return null
  return { docs: result, insertedAt: finalAt }
}

/**
 * 行を1つ上/下へ(Alt+↑ / Alt+↓)。
 * 同じ並びの中で1つずらす。並びの端では、ひとつ外側(リスト・トグル見出しの外)へ出す
 */
export function planMoveAdjacent(doc: PMNode, pos: number, dir: 'up' | 'down'): { doc: PMNode; insertedAt: number } | null {
  const block = movableAt(doc, pos)
  if (!block) return null
  const $p = doc.resolve(block.pos)
  const parent = $p.parent
  const index = $p.index()
  // 並びの端で外へ出るときの深さ。入れ子のリストなら、外側のリストの項目の前後へ出す
  let outDepth = $p.depth
  if (LIST_TYPES.has(parent.type.name) && outDepth >= 2 && ITEM_TYPES.has($p.node(outDepth - 1).type.name)) {
    outDepth -= 1
  }
  let target: number
  if (dir === 'up') {
    const prev = index > 0 ? parent.child(index - 1) : null
    if (prev && prev.type.name !== 'toggleTitle') target = block.pos - prev.nodeSize
    else if (outDepth > 0) target = $p.before(outDepth)
    else return null
  } else {
    const next = index < parent.childCount - 1 ? parent.child(index + 1) : null
    if (next) target = block.pos + block.node.nodeSize + next.nodeSize
    else if (outDepth > 0) target = $p.after(outDepth)
    else return null
  }
  const id = '_'
  const result = planMove(new Map([[id, doc]]), [{ pageId: id, positions: [block.pos] }], { pageId: id, pos: target })
  if (!result) return null
  return { doc: result.docs.get(id)!, insertedAt: result.insertedAt }
}
