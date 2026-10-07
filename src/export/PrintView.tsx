import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { EditorContent, useEditor } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'
import type { Page, Sticky } from '../db/db'
import { buildExtensions, buildStickyExtensions } from '../editor/extensions'
import { mapContent } from '../editor/contentWalk'
import { borderColor, borderWidth, paperColor } from '../design/palette'
import { normalizeDesign } from '../design/defaults'
import type { ExportSource } from './load'

/**
 * PDF の出力:印刷用の見た目を作り、端末の印刷画面を開く(印刷画面で「PDFとして保存」を選んでもらう)。
 * 画面には出さず、印刷のときだけ表示する(src/styles/print.css)。
 * 紙の背景色・縁・付箋の位置は画面と同じ。トグル見出しは閉じていても中身を出す。ダークモードでも明るい色で印刷する
 */

const NO_HOOKS = { undo: () => {}, redo: () => {}, closeGroup: () => {} }

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

function PrintPage({ page, paperClass, paperStyle }: { page: Page; paperClass: string; paperStyle: CSSProperties }) {
  return (
    <section className="print-page">
      <div className={`print-paper ${paperClass}`} style={paperStyle}>
        <div className="page-content">
          <ReadOnlyEditor content={page.content} />
          {(page.stickies ?? []).map((s) => (
            <PrintSticky key={s.id} sticky={s} />
          ))}
        </div>
      </div>
    </section>
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

/**
 * 印刷用の見た目を描き、準備ができたら印刷画面を開く。
 * 印刷画面を閉じたあとも、次に印刷するまで(画面に出ない状態で)残しておく
 * (iPhone では印刷画面が閉じる前に afterprint が来ることがあり、すぐ消すと白紙になるおそれがあるため)
 */
export function PrintView({ source, job }: { source: ExportSource; job: number }) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const appTitle = document.title
    // PDF のファイル名は、ページのタイトル(document.title)から付けられるので、印刷の間だけノート名にする
    const restoreTitle = () => {
      document.title = appTitle
    }
    void (async () => {
      // 描画が終わるのを待ってから、画像を待つ
      await new Promise((r) => requestAnimationFrame(() => r(null)))
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
    // job が変わったとき(もう一度印刷したとき)だけ印刷画面を開く
  }, [job])

  const design = normalizeDesign(source.note.design)
  const paper = paperColor(design.paper)
  const border = borderWidth(design.border.width)
  const paperClass = `tone-${paper?.tone ?? 'light'}`
  const paperStyle: CSSProperties = {
    ...(paper ? ({ '--paper': paper.hex } as CSSProperties) : {}),
    ...(border && border.px > 0 ? { border: `${border.px}px solid ${borderColor(design.border.color)?.hex}` } : {}),
  }

  return createPortal(
    <div className="print-root tone-light" ref={rootRef} aria-hidden="true">
      {source.pages.map((p) => (
        <PrintPage key={`${job}-${p.id}`} page={p} paperClass={paperClass} paperStyle={paperStyle} />
      ))}
    </div>,
    document.body,
  )
}
