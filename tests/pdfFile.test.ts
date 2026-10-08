import { describe, expect, it } from 'vitest'
import { PDF_IMAGE, PDF_MARGIN, PDF_PAGE, buildPdfParts, type PdfImage } from '../src/export/pdfFile'
import { isBlankImage } from '../src/export/blankCheck'
import { isAppleMobile } from '../src/export/device'

// iPhone・iPad のアプリ内での PDF 作り(1.3.1〜):PDF ファイルの組み立て・空の紙の確認・端末の判定

/** 部品をつないだ PDF のバイト列と、文字として読んだもの(画像のデータは latin1 のまま) */
function joined(parts: Uint8Array[]) {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const bytes = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    bytes.set(p, at)
    at += p.length
  }
  return { bytes, text: Buffer.from(bytes).toString('latin1') }
}

/** 中身が分かるだけの、にせの JPEG */
const fakeJpeg = (n: number): PdfImage => ({
  jpeg: new Uint8Array([0xff, 0xd8, n, 1, 2, 3, 0xff, 0xd9]),
  width: 1406,
  height: 2026,
})

describe('PDF ファイルの組み立て(pdfFile)', () => {
  it('紙の数だけページがあり、順番どおりに画像が入る', () => {
    const { text } = joined(buildPdfParts([fakeJpeg(1), fakeJpeg(2), fakeJpeg(3)], 'ノート'))
    expect(text.startsWith('%PDF-1.4\n')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(text).toContain('/Count 3')
    expect(text.match(/\/Type \/Page /g)).toHaveLength(3)
    expect(text.match(/\/Subtype \/Image/g)).toHaveLength(3)
    // 画像の順(にせの JPEG の3バイト目)
    const order = [...text.matchAll(/stream\n\xff\xd8(.)/g)].map((m) => m[1].charCodeAt(0))
    expect(order).toEqual([1, 2, 3])
    expect(text).toContain('/Width 1406 /Height 2026')
  })

  it('紙は A4、画像は余白 12mm の内側(186mm × 268mm)に置く', () => {
    const { text } = joined(buildPdfParts([fakeJpeg(1)]))
    const mm = 72 / 25.4
    expect(PDF_PAGE.width).toBeCloseTo(210 * mm)
    expect(PDF_PAGE.height).toBeCloseTo(297 * mm)
    expect(text).toContain(`/MediaBox [0 0 595.28 841.89]`)
    const m = text.match(/q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm \/Im0 Do Q/)!
    const [w, h, x, y] = m.slice(1).map(Number)
    expect(w).toBeCloseTo(PDF_IMAGE.width, 1)
    expect(h).toBeCloseTo(PDF_IMAGE.height, 1)
    expect(x).toBeCloseTo(PDF_MARGIN, 1)
    // 上の余白が 12mm(PC の印刷と同じく、紙の上から置く。下は 297 − 12 − 268 = 17mm 空く)
    expect(PDF_PAGE.height - (y + h)).toBeCloseTo(PDF_MARGIN, 1)
    expect(y).toBeCloseTo(17 * mm, 1)
  })

  it('目次(xref)の位置が、それぞれの書き始めと合っている', () => {
    const { text } = joined(buildPdfParts([fakeJpeg(1), fakeJpeg(2)], 'テスト'))
    const startxref = Number(text.match(/startxref\n(\d+)\n/)![1])
    expect(text.slice(startxref, startxref + 4)).toBe('xref')
    const rows = text.slice(startxref).split('\n').slice(2)
    const count = Number(text.slice(startxref).split('\n')[1].split(' ')[1])
    expect(count).toBe(1 + 3 + 2 * 3)
    for (let id = 1; id < count; id++) {
      const offset = Number(rows[id].slice(0, 10))
      expect(text.slice(offset, offset + `${id} 0 obj`.length)).toBe(`${id} 0 obj`)
    }
  })

  it('画像の長さ(Length)が実際のデータと同じ', () => {
    const img = fakeJpeg(7)
    const { text } = joined(buildPdfParts([img]))
    expect(text).toContain(`/DCTDecode /Length ${img.jpeg.length} >>`)
  })

  it('日本語のタイトルを入れられる', () => {
    const { text } = joined(buildPdfParts([fakeJpeg(1)], 'あ'))
    expect(text).toContain('/Title <FEFF3042>')
  })

  it('紙がないときは作らない(空の PDF を保存しない)', () => {
    expect(() => buildPdfParts([])).toThrow()
  })
})

/** w × h の画像の点の色を作る(すべて bg の色) */
function image(w: number, h: number, bg: [number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set([...bg, 255], i * 4)
  return data
}
function paint(data: Uint8ClampedArray, w: number, x: number, y: number, size: number, color: [number, number, number]) {
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) data.set([...color, 255], ((y + dy) * w + x + dx) * 4)
}

describe('空の紙の確認(blankCheck)', () => {
  it('紙の色だけなら空', () => {
    expect(isBlankImage(image(100, 100, [255, 255, 255]))).toBe(true)
  })

  it('文字(濃い色の点)が少しでもあれば空ではない', () => {
    const data = image(100, 100, [255, 255, 255])
    paint(data, 100, 10, 10, 4, [43, 51, 64])
    expect(isBlankImage(data)).toBe(false)
  })

  it('濃い紙(黒板など)に明るい文字でも正しく判定する', () => {
    const data = image(100, 100, [40, 60, 50])
    expect(isBlankImage(data)).toBe(true)
    paint(data, 100, 50, 50, 4, [240, 240, 240])
    expect(isBlankImage(data)).toBe(false)
  })

  it('紙の色とほとんど同じ色のむら(にじみ)だけなら空', () => {
    const data = image(100, 100, [255, 255, 255])
    paint(data, 100, 0, 0, 20, [250, 248, 250])
    expect(isBlankImage(data)).toBe(true)
  })

  it('点が1つ2つ(ごみ)なら空とみなす', () => {
    const data = image(100, 100, [255, 255, 255])
    paint(data, 100, 3, 3, 1, [0, 0, 0])
    expect(isBlankImage(data)).toBe(true)
  })
})

describe('PDF の作り方を分ける端末の判定(device)', () => {
  const IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
  const IPAD_AS_MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15'
  const ANDROID =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
  const WINDOWS =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

  it('iPhone・iPad(Mac と名乗る iPad も)はアプリの中で作る', () => {
    expect(isAppleMobile(IPHONE, 5)).toBe(true)
    expect(isAppleMobile(IPAD_AS_MAC, 5)).toBe(true)
  })

  it('PC・Mac・Android は今までどおり印刷画面', () => {
    expect(isAppleMobile(WINDOWS, 0)).toBe(false)
    expect(isAppleMobile(IPAD_AS_MAC, 0)).toBe(false)
    expect(isAppleMobile(ANDROID, 5)).toBe(false)
  })
})
