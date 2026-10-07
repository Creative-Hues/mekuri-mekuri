import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { db, type Page } from '../src/db/db'
import { createNote, getPages, insertPage, reorderPages, savePageContent } from '../src/db/repo'
import { buildExtensions } from '../src/editor/extensions'
import { createSticky } from '../src/editor/sticky'
import { NoteSession } from '../src/screens/note/session'

// ノート画面の状態(NoteSession)を通した、行の移動・付箋・元に戻す/やり直しのテスト
// (本物のエディタと IndexedDB を使って、保存まで確かめる)

const para = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const docOf = (...lines: string[]) => ({ type: 'doc', content: lines.map(para) })
/** ページの行の文字 */
const linesOf = (json: { content?: { content?: { text?: string }[] }[] }) =>
  (json.content ?? []).map((b) => (b.content ?? []).map((t) => t.text).join(''))

let editors: Editor[] = []
let shown: string[] = []

beforeEach(async () => {
  await db.notes.clear()
  await db.pages.clear()
  shown = []
})
afterEach(() => {
  editors.forEach((e) => e.destroy())
  editors = []
})

/** ページ3枚(1枚目だけエディタを作る=画面に出ている、2・3枚目は画面外)のノート */
async function setup() {
  const note = await createNote('テスト')
  await insertPage(note.id, 1)
  await insertPage(note.id, 2)
  let pages = await getPages(note.id)
  await savePageContent(pages[0].id, docOf('A1', 'A2', 'A3'))
  await savePageContent(pages[1].id, docOf('B1'))
  await savePageContent(pages[2].id, docOf('C1'))
  pages = await getPages(note.id)

  const session = new NoteSession(note.id, {
    showPage: (id) => shown.push(id),
    removePage: async () => null,
    trashPage: async () => null,
    restorePage: async () => {},
    rename: async () => {},
    setDesign: async () => {},
    reorderPages: (ids) => reorderPages(note.id, ids),
  })
  session.syncPages(pages)

  const editor = new Editor({
    extensions: buildExtensions({
      undo: () => void session.history.undo(),
      redo: () => void session.history.redo(),
      closeGroup: () => session.history.closeGroup(),
    }),
    content: pages[0].content,
  })
  // ページのエディタと同じように、変更を履歴と保存へつなぐ
  editor.on('transaction', ({ transaction }) => {
    if (transaction.docChanged && !session.history.isApplying) {
      session.history.recordText(pages[0].id, transaction.before, editor.state.doc)
    }
  })
  editor.on('update', () => session.changed(pages[0].id, editor.getJSON()))
  editors.push(editor)
  session.register(pages[0].id, editor)
  return { session, editor, pages: pages as Page[] }
}

const stored = async (id: string) => linesOf((await db.pages.get(id))!.content as never)

describe('行の移動(ノート画面の状態を通して)', () => {
  it('画面外のページへ移動すると、両方のページが保存され、1回の「元に戻す」で両方戻る', async () => {
    const { session, editor, pages } = await setup()
    const [a, b] = pages
    const doc = editor.state.doc
    const posA2 = doc.child(0).nodeSize // 2行目の位置
    const ok = await session.moveBlocks([{ pageId: a.id, positions: [posA2] }], {
      pageId: b.id,
      pos: session.getDoc(b.id)!.content.size,
    })
    expect(ok).toBe(true)
    expect(linesOf(editor.getJSON() as never)).toEqual(['A1', 'A3'])
    expect(await stored(a.id)).toEqual(['A1', 'A3'])
    expect(await stored(b.id)).toEqual(['B1', 'A2'])

    await session.history.undo()
    expect(linesOf(editor.getJSON() as never)).toEqual(['A1', 'A2', 'A3'])
    expect(await stored(a.id)).toEqual(['A1', 'A2', 'A3'])
    expect(await stored(b.id)).toEqual(['B1'])

    await session.history.redo()
    expect(await stored(a.id)).toEqual(['A1', 'A3'])
    expect(await stored(b.id)).toEqual(['B1', 'A2'])
  })

  it('移動のあとに文字を書いても、移動と入力は別々に元に戻せる', async () => {
    const { session, editor, pages } = await setup()
    const a = pages[0]
    await session.moveBlocks([{ pageId: a.id, positions: [0] }], { pageId: a.id, pos: editor.state.doc.content.size })
    expect(linesOf(editor.getJSON() as never)).toEqual(['A2', 'A3', 'A1'])
    editor.commands.insertContentAt(1, 'X')
    expect(linesOf(editor.getJSON() as never)).toEqual(['XA2', 'A3', 'A1'])
    await session.history.undo()
    expect(linesOf(editor.getJSON() as never)).toEqual(['A2', 'A3', 'A1'])
    await session.history.undo()
    expect(linesOf(editor.getJSON() as never)).toEqual(['A1', 'A2', 'A3'])
  })

  it('Alt+↓:カーソルのある行を1つ下へ。元に戻すで戻る', async () => {
    const { session, editor, pages } = await setup()
    editor.commands.setTextSelection(2) // 「A1」の中
    expect(session.moveAdjacent(editor, pages[0].id, 'down')).toBe(true)
    expect(linesOf(editor.getJSON() as never)).toEqual(['A2', 'A1', 'A3'])
    // カーソルは動かした行についていく
    expect(editor.state.selection.$from.parent.textContent).toBe('A1')
    await session.history.undo()
    expect(linesOf(editor.getJSON() as never)).toEqual(['A1', 'A2', 'A3'])
  })

  it('選択モード:離れた行を選んで別のページの先頭へ', async () => {
    const { session, editor, pages } = await setup()
    const [a, , c] = pages
    const doc = editor.state.doc
    session.setSelectMode(true)
    expect(editor.isEditable).toBe(false) // 選択モード中は書けない
    session.toggleSelected(a.id, 0)
    session.toggleSelected(a.id, doc.child(0).nodeSize + doc.child(1).nodeSize) // 3行目
    expect(session.selectedCount).toBe(2)
    const ok = await session.moveBlocks(session.selectedSources(), { pageId: c.id, pos: 0 })
    expect(ok).toBe(true)
    session.setSelectMode(false)
    expect(editor.isEditable).toBe(true)
    expect(session.selectedCount).toBe(0)
    expect(await stored(a.id)).toEqual(['A2'])
    expect(await stored(c.id)).toEqual(['A1', 'A3', 'C1'])
  })

  it('選択を外すと数が減る', async () => {
    const { session, pages } = await setup()
    session.setSelectMode(true)
    session.toggleSelected(pages[0].id, 0)
    session.toggleSelected(pages[0].id, 0)
    expect(session.selectedCount).toBe(0)
  })
})

describe('付箋(ノート画面の状態を通して)', () => {
  it('追加・移動・色・削除がそれぞれ1回ずつ元に戻せ、保存もされる', async () => {
    const { session, pages } = await setup()
    const pageId = pages[1].id // 画面外のページでもよい
    const s = createSticky('yellow', 0.5)

    session.updateStickies(pageId, (list) => [...list, s])
    session.updateStickies(pageId, (list) => list.map((x) => ({ ...x, x: 0.1, y: 0.2 })))
    session.updateStickies(pageId, (list) => list.map((x) => ({ ...x, color: 'blue' as const })))
    session.updateStickies(pageId, () => [])
    await session.flushAll()
    expect((await db.pages.get(pageId))!.stickies).toEqual([])

    await session.history.undo() // 削除を戻す
    expect(session.getStickies(pageId)).toHaveLength(1)
    expect(session.getStickies(pageId)[0].color).toBe('blue')
    await session.history.undo() // 色を戻す
    expect(session.getStickies(pageId)[0].color).toBe('yellow')
    await session.history.undo() // 移動を戻す
    expect(session.getStickies(pageId)[0]).toMatchObject({ x: s.x, y: s.y })
    await session.history.undo() // 追加を戻す
    expect(session.getStickies(pageId)).toEqual([])
    expect((await db.pages.get(pageId))!.stickies).toEqual([])

    await session.history.redo()
    expect((await db.pages.get(pageId))!.stickies).toHaveLength(1)
  })

  it('同じ付箋への続けての文字入力は、1回の「元に戻す」にまとまる', async () => {
    const { session, pages } = await setup()
    const pageId = pages[0].id
    const s = createSticky('yellow', 0)
    session.updateStickies(pageId, (list) => [...list, s])
    const typed = (text: string) =>
      session.updateStickies(
        pageId,
        (list) => list.map((x) => ({ ...x, content: { type: 'doc', content: [para(text)] } })),
        `text:${s.id}`,
      )
    typed('あ')
    typed('あい')
    typed('あいう')
    await session.history.undo()
    expect(session.getStickies(pageId)[0].content).toEqual(s.content) // 入力の前まで一度に戻る
    await session.history.undo()
    expect(session.getStickies(pageId)).toEqual([])
  })

  it('付箋はページと一緒に保存され、ページの本文は変わらない', async () => {
    const { session, pages } = await setup()
    const pageId = pages[2].id
    session.updateStickies(pageId, (list) => [...list, createSticky('green', 0.3)])
    await session.flush(pageId)
    const page = (await db.pages.get(pageId))!
    expect(page.stickies).toHaveLength(1)
    expect(page.stickies[0].color).toBe('green')
    expect(linesOf(page.content as never)).toEqual(['C1'])
  })
})

describe('見開きで、両方のページにエディタがあるとき(実際の画面と同じ)', () => {
  // 不具合:左のページの行を右のページへドラッグすると、差し込む線は出るのに、離すと元に戻っていた
  // (ページごとにエディタの schema が別なので、行を入れられなかった)
  it('左のページの行を、右のページへ移動できる。元に戻す/やり直しもできる', async () => {
    const { session, editor: left, pages } = await setup()
    const [a, b] = pages
    const right = new Editor({
      extensions: buildExtensions({ undo() {}, redo() {}, closeGroup() {} }),
      content: (await db.pages.get(b.id))!.content,
    })
    editors.push(right)
    session.register(b.id, right)
    expect(left.schema).not.toBe(right.schema)

    const posA2 = left.state.doc.child(0).nodeSize
    const ok = await session.moveBlocks([{ pageId: a.id, positions: [posA2] }], {
      pageId: b.id,
      pos: right.state.doc.content.size,
    })
    expect(ok).toBe(true)
    expect(linesOf(left.getJSON() as never)).toEqual(['A1', 'A3'])
    expect(linesOf(right.getJSON() as never)).toEqual(['B1', 'A2'])
    expect(await stored(b.id)).toEqual(['B1', 'A2'])

    // 移した行を、右のページのエディタでそのまま編集できる
    right.commands.insertContentAt(right.state.doc.content.size - 1, '!')
    expect(linesOf(right.getJSON() as never)).toEqual(['B1', 'A2!'])

    await session.history.undo()
    expect(linesOf(left.getJSON() as never)).toEqual(['A1', 'A2', 'A3'])
    expect(linesOf(right.getJSON() as never)).toEqual(['B1'])
    await session.history.redo()
    expect(linesOf(right.getJSON() as never)).toEqual(['B1', 'A2'])
  })
})
