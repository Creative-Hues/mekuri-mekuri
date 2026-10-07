import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { EditorContent, useEditor } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'
import type { Page, Sticky } from '../db/db'
import { buildExtensions, buildStickyExtensions } from '../editor/extensions'
import { mapContent } from '../editor/contentWalk'
import { borderColor, borderWidth, paperColor } from '../design/palette'
import { normalizeDesign } from '../design/defaults'
import { bodyFontFamily } from '../design/cover'
import type { ExportSource } from './load'
import { paginate, type Atom, type Slice } from './paginate'

/**
 * PDF の出力:印刷用の見た目を作り、端末の印刷画面を開く(印刷画面で「PDFとして保存」を選んでもらう)。
 * 画面には出さず、印刷のときだけ表示する(src/styles/print.css)。
 * 紙の背景色・縁・付箋の位置は画面と同じ。トグル見出しは閉じていても中身を出す。ダークモードでも明るい色で印刷する。
 *
 * 紙の分け方(paginate.ts):
 * 1. 印刷と同じ幅で中身を並べて(画面の外・見えない所)、高さと「切ってはいけないもの」の位置を測る
 * 2. 文字の行・画像・表の行などの途中を避けて、紙1枚分ずつに区切る
 * 3. 区切ったそれぞれを、同じ大きさの紙に1枚ずつ描く(紙ごとに中身をずらして、その範囲だけを見せる)
 * 紙を自分で分けるので、ページ番号(「1 / 6」)を紙の縁の内側の下中央に、ずれずに出せる
 */

const NO_HOOKS = { undo: () => {}, redo: () => {}, closeGroup: () => {} }

/** 紙の中の、中身を描く範囲の上の余白(px) */
export const PRINT_TOP = 12
/** 中身を描く範囲の下の余白(px)。ページ番号を出すときは、その分を空ける */
export const printBottom = (pageNumbers: boolean) => (pageNumbers ? 34 : 14)

/** トグル見出しをすべて開いた状態にする(印刷で中身が隠れないように) */
export function openAllToggles(doc: JSONContent): JSONContent {
  return mapContent(doc, (n) => (n.type === 'toggleHeading' ? { ...n, attrs: { ...n.attrs, open: true } } : n))
}

function ReadOnlyEditor({ content, sticky }: { content: JSONContent; sticky?: boolean }) {
  const extensions = useMemo(() => (sticky ? buildStickyExtensions(NO_HOOKS) : buildExtensions(NO_HOOKS)), [sticky])
  const editor = useEditor(
    {
      extensions,
      content: sticky ? content : openAllToggles(content),
      editable: false,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: { attributes: { class: sticky ? 'sticky-editor' : 'page-editor' } },
    },
    [extensions, content],
  )
  return <EditorContent editor={editor} className={sticky ? 'sticky-editor-wrap' : 'page-editor-wrap'} />
}

function PrintSticky({ sticky }: { sticky: Sticky }) {
  return (
    <div
      className={`sticky tone-light sticky--${sticky.color}`}
      style={{
        left: `${sticky.x * 100}%`,
        top: `calc(${sticky.y} * 100cqw)`,
        width: `${sticky.w * 100}%`,
        height: `calc(${sticky.h} * 100cqw)`,
      }}
    >
      <div className="sticky-body">
        <ReadOnlyEditor content={sticky.content} sticky />
      </div>
    </div>
  )
}

/** 1ページ分の中身(本文と付箋) */
function PageContent({ page }: { page: Page }) {
  return (
    <div className="page-content">
      <ReadOnlyEditor content={page.content} />
      {(page.stickies ?? []).map((s) => (
        <PrintSticky key={s.id} sticky={s} />
      ))}
    </div>
  )
}

/** 画像の読み込みが終わるまで待つ(長くても timeout ミリ秒まで) */
async function waitForImages(root: HTMLElement | null, timeout = 10_000): Promise<void> {
  if (!root) return
  const until = Date.now() + timeout
  while (root.querySelector('.image-block.is-loading') && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 50))
  }
  const imgs = Array.from(root.querySelectorAll('img')).filter((img) => img.getAttribute('src'))
  await Promise.all(imgs.map((img) => img.decode().catch(() => {})))
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)))

/** 切ってはいけないもの(行の途中で切れると読めなくなるもの) */
const ATOM_SELECTOR = 'img, .image-block, tr, .note-link, hr, input, .sticky'

/**
 * 並べた中身を測る:高さと、切ってはいけないもの(文字の行・画像・表の行・付箋など)の位置。
 * 位置は中身(.page-content)の上端からの px
 */
export function measureContent(content: HTMLElement): { height: number; atoms: Atom[] } {
  const base = content.getBoundingClientRect().top
  const atoms: Atom[] = []
  const add = (r: { top: number; bottom: number; height: number }) => {
    if (r.height > 0) atoms.push({ top: r.top - base, bottom: r.bottom - base })
  }
  // 文字の行(付箋の中の行は、付箋ごとまとめて扱う)
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent?.trim() || (n.parentElement && n.parentElement.closest('.sticky'))) continue
    range.selectNodeContents(n)
    for (const r of Array.from(range.getClientRects())) add(r)
  }
  content.querySelectorAll(ATOM_SELECTOR).forEach((el) => {
    if (el.matches('.sticky') || !el.closest('.sticky')) add(el.getBoundingClientRect())
  })
  const height = Math.max(content.getBoundingClientRect().height, ...atoms.map((a) => a.bottom), 0)
  return { height, atoms }
}

interface Layout {
  job: number
  /** ページの id → 紙ごとの範囲 */
  slices: Record<string, Slice[]>
}

/**
 * 印刷用の見た目を描き、準備ができたら印刷画面を開く。
 * 印刷画面を閉じたあとも、次に印刷するまで(画面に出ない状態で)残しておく
 * (iPhone では印刷画面が閉じる前に afterprint が来ることがあり、すぐ消すと白紙になるおそれがあるため)
 */
export function PrintView({ source, job, pageNumbers }: { source: ExportSource; job: number; pageNumbers: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<Layout | null>(null)
  const measuring = layout?.job !== job

  // 1. 測る:画面の外に印刷と同じ幅で並べ、画像を待ってから測る
  useLayoutEffect(() => {
    if (!measuring) return
    let cancelled = false
    void (async () => {
      await nextFrame()
      await waitForImages(rootRef.current)
      await nextFrame()
      const root = rootRef.current
      if (cancelled || !root) return
      const probe = root.querySelector<HTMLElement>('[data-print-probe]')
      const pageHeight = (probe?.clientHeight ?? 0) - PRINT_TOP - printBottom(pageNumbers)
      const slices: Record<string, Slice[]> = {}
      root.querySelectorAll<HTMLElement>('[data-print-page]').forEach((el) => {
        const content = el.querySelector<HTMLElement>('.page-content')
        const id = el.dataset.printPage!
        if (!content || !(pageHeight > 0)) {
          slices[id] = [{ start: 0, end: 0 }]
          return
        }
        const { height, atoms } = measureContent(content)
        slices[id] = paginate(height, atoms, pageHeight)
      })
      setLayout({ job, slices })
    })()
    return () => {
      cancelled = true
    }
  }, [job, measuring, pageNumbers])

  // 2. 紙を描いたら、画像を待って印刷画面を開く
  useEffect(() => {
    if (measuring) return
    let cancelled = false
    const appTitle = document.title
    // PDF のファイル名は、ページのタイトル(document.title)から付けられるので、印刷の間だけノート名にする
    const restoreTitle = () => {
      document.title = appTitle
    }
    void (async () => {
      await nextFrame()
      await waitForImages(rootRef.current)
      if (cancelled) return
      document.title = source.model.title
      window.addEventListener('afterprint', restoreTitle, { once: true })
      window.print()
    })()
    return () => {
      cancelled = true
      window.removeEventListener('afterprint', restoreTitle)
      restoreTitle()
    }
    // 測り終えたとき(新しく印刷したとき)だけ印刷画面を開く
  }, [measuring, layout])

  const design = normalizeDesign(source.note.design)
  const paper = paperColor(design.paper)
  const border = borderWidth(design.border.width)
  const paperClass = `tone-${paper?.tone ?? 'light'}`
  const paperStyle = {
    // 本文の書体も画面と同じにする
    '--note-font': bodyFontFamily(design),
    ...(paper ? ({ '--paper': paper.hex } as CSSProperties) : {}),
    ...(border && border.px > 0 ? { border: `${border.px}px solid ${borderColor(design.border.color)?.hex}` } : {}),
  } as CSSProperties

  if (measuring) {
    return createPortal(
      <div className="print-root tone-light is-measuring" ref={rootRef} aria-hidden="true">
        {/* 紙1枚の中の高さを測るための、空の紙 */}
        <section className={`print-sheet ${paperClass}`} style={paperStyle} data-print-probe />
        {source.pages.map((p) => (
          <section
            key={`${job}-${p.id}`}
            className={`print-sheet print-sheet--measure ${paperClass}`}
            style={paperStyle}
            data-print-page={p.id}
          >
            <div className="print-window">
              <PageContent page={p} />
            </div>
          </section>
        ))}
      </div>,
      document.body,
    )
  }

  const sheets = source.pages.flatMap((p) => (layout!.slices[p.id] ?? [{ start: 0, end: 0 }]).map((s) => ({ page: p, s })))
  return createPortal(
    <div className="print-root tone-light" ref={rootRef} aria-hidden="true">
      {sheets.map(({ page, s }, i) => (
        <section key={`${job}-${page.id}-${i}`} className={`print-sheet ${paperClass}`} style={paperStyle}>
          {/* その紙の範囲だけを見せる(中身を上にずらし、範囲の外は隠す) */}
          <div className="print-window" style={{ top: PRINT_TOP, height: Math.max(0, s.end - s.start) }}>
            <div style={{ transform: `translateY(${-s.start}px)` }}>
              <PageContent page={page} />
            </div>
          </div>
          {pageNumbers && (
            <div className="print-number">
              {i + 1} / {sheets.length}
            </div>
          )}
        </section>
      ))}
    </div>,
    document.body,
  )
}
