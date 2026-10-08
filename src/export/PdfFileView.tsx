import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import type { Page } from '../db/db'
import { stamp } from '../backup/export'
import { downloadBlob } from './download'
import type { ExportSource } from './load'
import { safeFileName } from './model'
import { paginate, type Atom, type Slice } from './paginate'
import { buildPdf, type PdfImage } from './pdfFile'
import { isBlankImage } from './blankCheck'
import { PRINT_TOP, PageContent, measureContent, nextFrame, paperOf, printBottom, waitForImages } from './PrintView'

/**
 * iPhone・iPad 用の PDF の出力:印刷画面を使わず、アプリの中で PDF ファイルを作って保存する(理由は device.ts)。
 *
 * 1. 測る:PC の印刷(PrintView.tsx)と同じく、画面の外に幅 186mm で全ページを並べて測り、paginate で区切る
 * 2. 描く:区切りごとに、PC の印刷と同じ紙(186mm × 268mm・ページ番号の位置も同じ)を画面の外に1枚だけ描き、
 *    画像(JPEG)にする。画像にしたら、すぐにその紙と作業用の画像を消してメモリを空ける(画面の外の紙は常に1枚)
 * 3. 全部の紙がそろったら、A4 の PDF にして保存する
 *
 * 内容が欠けた PDF は保存しない:
 * - 描いた紙の中身の高さが、測ったときと違えば止める(区切りがずれて、行が抜けるおそれがあるため)
 * - 中身があるはずの紙が画像にすると空なら、描き直す。それでも空なら止める
 * - 途中で失敗・中断したときは何も保存しない(保存は全部そろったあとの1回だけ)
 */

/** 画像にするときの解像度(紙の px の何倍か) */
const PIXEL_RATIO = 2
/** JPEG の画質 */
const JPEG_QUALITY = 0.9
/** 中身があるはずの紙が空だったとき、描き直す回数 */
const BLANK_RETRIES = 2
/** 紙1枚を画像にするのにかけてよい時間(ミリ秒)。これを過ぎたら止める */
const SHEET_TIMEOUT = 60_000

/** PDF の1枚 */
interface Sheet {
  key: string
  page: Page
  /** paperOf の何番目(ノートの順) */
  source: number
  slice: Slice
  /** ノートの中で何枚目か(0 から)・ノートの紙の枚数 */
  index: number
  total: number
  /** 測ったときの、ページの中身の高さ(描いたときに同じか確かめる) */
  contentHeight: number
  /** 文字・画像など、何か描かれているはずか(空の紙の確認に使う) */
  expectInk: boolean
}

export type PdfResult = { kind: 'saved' } | { kind: 'cancelled' } | { kind: 'failed'; error: unknown }

/** 中身の高さの食い違いをどこまで許すか(px) */
const HEIGHT_TOLERANCE = 1

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 時間内に終わらなければ失敗にする */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/** 作業用の画像(canvas)のメモリを明け渡す(iPhone は canvas に使えるメモリが少ないため、すぐ返す) */
function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0
  canvas.height = 0
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('画像を作れませんでした'))
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject)
      },
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}

/** 紙の画像のうち、中身を見せる範囲(縁・ページ番号を除く)が空か */
function windowIsBlank(canvas: HTMLCanvasElement, sheet: HTMLElement, win: HTMLElement): boolean {
  const s = sheet.getBoundingClientRect()
  const w = win.getBoundingClientRect()
  const ratio = canvas.width / s.width
  // 縁から少し内側を見る
  const inset = 4
  const sx = Math.max(0, Math.floor((w.left - s.left + inset) * ratio))
  const sy = Math.max(0, Math.floor((w.top - s.top) * ratio))
  const sw = Math.min(canvas.width - sx, Math.floor((w.width - inset * 2) * ratio))
  const sh = Math.min(canvas.height - sy, Math.floor(w.height * ratio))
  if (sw <= 0 || sh <= 0) return false
  // 半分の大きさに縮めて調べる(調べるためのメモリを減らす)
  const small = document.createElement('canvas')
  small.width = Math.max(1, Math.round(sw / 2))
  small.height = Math.max(1, Math.round(sh / 2))
  try {
    const ctx = small.getContext('2d')
    if (!ctx) return false
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, small.width, small.height)
    return isBlankImage(ctx.getImageData(0, 0, small.width, small.height).data)
  } finally {
    releaseCanvas(small)
  }
}

/** 2つの範囲が重なっているか */
const overlaps = (a: DOMRect, b: DOMRect) => a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right

/** 本文の一番外側のまとまり(段落・見出し・リスト・表・画像など) */
const blocksOf = (sheet: HTMLElement) => Array.from(sheet.querySelector('.page-editor')?.children ?? []) as HTMLElement[]

/**
 * 紙の写しを作り、この紙に見えないまとまり(見える範囲から離れた段落・リストなど)の中身を省く。
 * 省いたまとまりは高さを残すので、見える部分の位置は変わらない。
 * 画像にする手間はまとまりの数に比例するため、長いページでも紙1枚分の手間で済む。
 * 写しの並びが元の紙と少しでも違えば、写しは使わず元の紙をそのまま使う(内容が欠けないように)
 */
async function trimmedCopy(el: HTMLElement): Promise<{ node: HTMLElement; dispose: () => void }> {
  const original = { node: el, dispose: () => {} }
  const win = el.querySelector<HTMLElement>('.print-window')
  const content = el.querySelector<HTMLElement>('.page-content')
  if (!win || !content || !el.parentElement) return original
  const winRect = win.getBoundingClientRect()
  const blocks = blocksOf(el)
  // 見える範囲から上下 8px 以上離れたものだけを省く
  const drop = blocks.map((b) => {
    const r = b.getBoundingClientRect()
    return r.bottom < winRect.top - 8 || r.top > winRect.bottom + 8
  })
  if (!drop.some(Boolean)) return original

  const copy = el.cloneNode(true) as HTMLElement
  // ToDo のチェックなど、入力欄の状態は写されないので写す
  const inputs = el.querySelectorAll('input')
  copy.querySelectorAll('input').forEach((c, i) => {
    c.checked = inputs[i]?.checked ?? c.checked
  })
  const copies = blocksOf(copy)
  if (copies.length !== blocks.length) return original
  copies.forEach((b, i) => {
    if (!drop[i]) return
    b.style.height = getComputedStyle(blocks[i]).height
    b.replaceChildren()
  })
  el.parentElement.appendChild(copy)
  try {
    await waitForImages(copy)
    const base = el.getBoundingClientRect().top
    const copyBase = copy.getBoundingClientRect().top
    const copyContent = copy.querySelector<HTMLElement>('.page-content')
    const same =
      !!copyContent &&
      Math.abs(copyContent.getBoundingClientRect().height - content.getBoundingClientRect().height) < 0.5 &&
      blocks.every((b, i) => {
        const a = b.getBoundingClientRect()
        const c = copies[i].getBoundingClientRect()
        return Math.abs(a.top - base - (c.top - copyBase)) < 0.5 && Math.abs(a.height - c.height) < 0.5
      })
    if (!same) {
      copy.remove()
      return original
    }
    return { node: copy, dispose: () => copy.remove() }
  } catch (e) {
    copy.remove()
    throw e
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => img.decode().then(() => resolve(img), () => resolve(img))
    img.onerror = () => reject(new Error('紙の画像を読み込めませんでした'))
    img.src = src
  })
}

/**
 * html-to-image で作った SVG を、作業用の画像(canvas)に描く。
 * twice:Safari では、写真入りの紙の1回目は写真が描かれないことがあるため、もう一度読み込んで描き直す
 */
async function svgToCanvas(svg: string, width: number, height: number, twice: boolean): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * PIXEL_RATIO)
  canvas.height = Math.round(height * PIXEL_RATIO)
  try {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('画像を作れませんでした')
    const draw = (img: HTMLImageElement) => {
      // 紙の角(丸い角の外側)は白にする
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    }
    draw(await loadImage(svg))
    if (twice) {
      await sleep(100)
      draw(await loadImage(svg))
    }
    return canvas
  } catch (e) {
    releaseCanvas(canvas)
    throw e
  }
}

export function PdfFileView({
  sources,
  pageNumbers,
  onDone,
}: {
  sources: ExportSource[]
  pageNumbers: boolean
  onDone: (result: PdfResult) => void
}) {
  const measureRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [sheets, setSheets] = useState<Sheet[] | null>(null)
  /** いま画面の外に描いている紙(sheets の何番目か) */
  const [current, setCurrent] = useState<number | null>(null)
  const [done, setDone] = useState(0)
  const cancelled = useRef(false)
  const finished = useRef(false)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  const papers = sources.map(paperOf)

  const finish = (result: PdfResult) => {
    if (finished.current) return
    finished.current = true
    onDoneRef.current(result)
  }

  // 画面を離れたら(ノートを閉じたなど)、作るのをやめる。途中までのものは保存しない
  useEffect(() => {
    cancelled.current = false
    return () => {
      cancelled.current = true
    }
  }, [])

  // 1. 測る(PrintView と同じ)
  useLayoutEffect(() => {
    let stop = false
    void (async () => {
      try {
        await nextFrame()
        await waitForImages(measureRef.current)
        await nextFrame()
        const root = measureRef.current
        if (stop) return
        if (cancelled.current) return finish({ kind: 'cancelled' })
        if (!root) throw new Error('ページの中身を測れませんでした')
        const probe = root.querySelector<HTMLElement>('[data-print-probe]')
        const pageHeight = (probe?.clientHeight ?? 0) - PRINT_TOP - printBottom(pageNumbers)
        if (!(pageHeight > 0)) throw new Error('紙の高さを測れませんでした')
        const measured = new Map<string, { height: number; atoms: Atom[] }>()
        root.querySelectorAll<HTMLElement>('[data-print-page]').forEach((el) => {
          const content = el.querySelector<HTMLElement>('.page-content')
          if (!content) throw new Error('ページの中身を測れませんでした')
          measured.set(el.dataset.printPage!, measureContent(content))
        })
        const list: Sheet[] = []
        sources.forEach((source, n) => {
          const own: Omit<Sheet, 'index' | 'total'>[] = []
          for (const page of source.pages) {
            const m = measured.get(page.id)
            if (!m) throw new Error('ページの中身を測れませんでした')
            for (const slice of paginate(m.height, m.atoms, pageHeight)) {
              own.push({
                key: `${page.id}-${own.length}`,
                page,
                source: n,
                slice,
                contentHeight: m.height,
                expectInk: m.atoms.some((a) => a.bottom > slice.start + 0.5 && a.top < slice.end - 0.5),
              })
            }
          }
          own.forEach((s, i) => list.push({ ...s, index: i, total: own.length }))
        })
        if (list.length === 0) throw new Error('PDF に入れるページがありません')
        // 測るための要素は、ここで消える(次の段階では紙1枚だけを描く)
        setSheets(list)
      } catch (error) {
        finish({ kind: 'failed', error })
      }
    })()
    return () => {
      stop = true
    }
    // 測るのは最初の1回だけ
  }, [])

  // 2. 紙を1枚ずつ描いて画像にし、3. PDF にして保存する
  useEffect(() => {
    if (!sheets) return
    void (async () => {
      const images: PdfImage[] = []
      try {
        // 画像にする部分はライブラリなので、使うときだけ読み込む
        const { toSvg } = await import('html-to-image')
        for (let i = 0; i < sheets.length; i++) {
          if (cancelled.current) return finish({ kind: 'cancelled' })
          const sheet = sheets[i]
          flushSync(() => setCurrent(i))
          const el = await sheetReady(sheet)
          if (cancelled.current) return finish({ kind: 'cancelled' })
          images.push(await withTimeout(snapshot(toSvg, el, sheet), SHEET_TIMEOUT, '紙を画像にできませんでした(時間切れ)'))
          // 描いた紙を消してから次へ(画面の外の紙は常に1枚)
          flushSync(() => {
            setCurrent(null)
            setDone(i + 1)
          })
          // ブラウザがメモリを片付ける時間をとる
          await sleep(30)
        }
        if (cancelled.current) return finish({ kind: 'cancelled' })
        if (images.length !== sheets.length) throw new Error('紙の数が合いません')
        const title = sources.length === 1 ? sources[0].model.title : `めくりめくり(${sources.length}冊)`
        const name =
          sources.length === 1 ? safeFileName(sources[0].model.title, 'pdf') : `mekuri-notes-${stamp(new Date())}.pdf`
        downloadBlob(buildPdf(images, title), name)
        finish({ kind: 'saved' })
      } catch (error) {
        finish({ kind: 'failed', error })
      } finally {
        images.length = 0
      }
    })()
    // 紙の区切りが決まったときに1回だけ動かす
  }, [sheets])

  /** 画面の外に描いた紙が、測ったときと同じ形になるまで待つ。違ったままなら止める */
  async function sheetReady(sheet: Sheet): Promise<HTMLElement> {
    const until = Date.now() + 5_000
    for (;;) {
      await nextFrame()
      const el = stageRef.current?.querySelector<HTMLElement>('.print-sheet')
      const content = el?.querySelector<HTMLElement>('.page-content')
      if (el && content) {
        await waitForImages(el)
        const { height } = measureContent(content)
        if (Math.abs(height - sheet.contentHeight) <= HEIGHT_TOLERANCE) return el
      }
      if (Date.now() > until) throw new Error('紙の中身が、測ったときと違います')
      await sleep(50)
    }
  }

  /** 紙1枚を画像(JPEG)にする */
  async function snapshot(toSvg: typeof import('html-to-image').toSvg, el: HTMLElement, sheet: Sheet): Promise<PdfImage> {
    // この紙に見えない部分を省いた写し(速く・メモリを少なくするため。並びが変わるときは元の紙を使う)
    const { node, dispose } = await trimmedCopy(el)
    try {
      const win = node.querySelector<HTMLElement>('.print-window')
      if (!win) throw new Error('紙の中身が見つかりません')
      const winRect = win.getBoundingClientRect()
      // この紙に見えない画像は入れない(画像の枠の大きさは残るので、並びは変わらない)
      const filter = (n: HTMLElement) => !(n instanceof HTMLImageElement) || overlaps(n.getBoundingClientRect(), winRect)
      const hasImages = Array.from(node.querySelectorAll('img')).some((img) => overlaps(img.getBoundingClientRect(), winRect))
      const rect = node.getBoundingClientRect()
      const width = Math.round(rect.width)
      const height = Math.round(rect.height)
      for (let attempt = 0; ; attempt++) {
        const svg = await toSvg(node, { width, height, skipFonts: true, filter })
        const canvas = await svgToCanvas(svg, width, height, hasImages)
        try {
          if (sheet.expectInk && windowIsBlank(canvas, node, win)) {
            if (attempt < BLANK_RETRIES) {
              await sleep(200)
              continue
            }
            throw new Error('紙を画像にすると空になりました')
          }
          return { jpeg: await canvasToJpeg(canvas), width: canvas.width, height: canvas.height }
        } finally {
          releaseCanvas(canvas)
        }
      }
    } finally {
      dispose()
    }
  }

  /** キャンセル:すぐに閉じる。作っている途中のものは保存しない(保存の前に cancelled を確かめる) */
  const cancel = () => {
    cancelled.current = true
    finish({ kind: 'cancelled' })
  }

  const total = sheets?.length ?? 0
  const sheet = sheets && current !== null ? sheets[current] : null

  return createPortal(
    <>
      {!sheets && (
        <div className="print-root tone-light is-measuring pdf-measure" ref={measureRef} aria-hidden="true">
          {/* 紙1枚の中の高さを測るための、空の紙 */}
          <section className={`print-sheet ${papers[0]?.className ?? 'tone-light'}`} style={papers[0]?.style} data-print-probe />
          {sources.flatMap((source, n) =>
            source.pages.map((p) => (
              <section
                key={p.id}
                className={`print-sheet print-sheet--measure ${papers[n].className}`}
                style={papers[n].style}
                data-print-page={p.id}
              >
                <div className="print-window">
                  <PageContent page={p} />
                </div>
              </section>
            )),
          )}
        </div>
      )}
      {/* 画像にする紙(画面の外に1枚だけ。PC の印刷の紙と同じ作り) */}
      <div className="print-root tone-light pdf-stage" ref={stageRef} aria-hidden="true">
        {sheet && (
          <section key={sheet.key} className={`print-sheet ${papers[sheet.source].className}`} style={papers[sheet.source].style}>
            <div className="print-window" style={{ top: PRINT_TOP, height: Math.max(0, sheet.slice.end - sheet.slice.start) }}>
              <div style={{ transform: `translateY(${-sheet.slice.start}px)` }}>
                <PageContent page={sheet.page} />
              </div>
            </div>
            {pageNumbers && (
              <div className="print-number">
                {sheet.index + 1} / {sheet.total}
              </div>
            )}
          </section>
        )}
      </div>
      <div className="dialog-backdrop">
        <div className="dialog" role="dialog" aria-modal="true" aria-live="polite">
          <h2 className="dialog-title">PDF を作っています</h2>
          <div className="dialog-message">
            <p>{total > 0 ? `${done} / ${total} 枚` : '準備しています…'}</p>
            <p className="export-note">終わると保存の画面が出ます。アプリを閉じずにお待ちください。</p>
          </div>
          <div className="dialog-buttons">
            <button type="button" className="btn btn--plain" onClick={cancel}>
              キャンセル
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
