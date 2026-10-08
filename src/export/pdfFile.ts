/**
 * JPEG の画像を1ページに1枚ずつ貼った PDF ファイルを作る(iPhone・iPad のアプリ内での PDF 作り。PdfFileView.tsx)。
 * 紙は A4。画像は上下左右 12mm の余白の内側(186mm × 268mm)に置く(PC の印刷と同じ配置)。
 * 画像を貼るだけなので、ライブラリを使わず自分で組み立てる
 */

/** 1mm は何ポイントか(PDF の長さの単位は 1/72 インチ) */
const MM = 72 / 25.4
export const PDF_PAGE = { width: 210 * MM, height: 297 * MM }
export const PDF_MARGIN = 12 * MM
/** 画像を置く範囲(紙の大きさから余白を引いたもの。print.css の紙の大きさと同じ) */
export const PDF_IMAGE = { width: 186 * MM, height: 268 * MM }

export interface PdfImage {
  /** JPEG のデータ */
  jpeg: Uint8Array
  /** 画像の大きさ(px) */
  width: number
  height: number
}

const enc = new TextEncoder()
const num = (n: number) => (Math.round(n * 100) / 100).toString()

/** 文字列を PDF の文字(UTF-16BE の16進数)にする。日本語のタイトルも入れられる */
function pdfText(s: string): string {
  let hex = 'FEFF'
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')
  return `<${hex}>`
}

/**
 * PDF を作る。images は紙の順。title は PDF の情報に入れるタイトル。
 * 返すのは部品の配列(大きなデータを1つにつなげ直さず、そのまま Blob にできる)
 */
export function buildPdfParts(images: readonly PdfImage[], title = ''): Uint8Array[] {
  if (images.length === 0) throw new Error('PDF に入れる紙がありません')
  const parts: Uint8Array[] = []
  let length = 0
  const offsets: number[] = []
  const write = (data: string | Uint8Array) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data
    parts.push(bytes)
    length += bytes.length
  }
  /** 番号 id のものを書く(書き始めの位置を目次 xref のために記録する) */
  const object = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = length
    write(`${id} 0 obj\n${body}\n`)
    if (stream) {
      write('stream\n')
      write(stream)
      write('\nendstream\n')
    }
    write('endobj\n')
  }

  // 番号の割り当て:1 = カタログ、2 = ページの一覧、3 = 情報、4 から紙ごとに3つ(ページ・描く内容・画像)
  const pageId = (i: number) => 4 + i * 3
  const count = 3 + images.length * 3

  write('%PDF-1.4\n')
  // バイナリを含むファイルだと伝えるための決まりの1行
  write(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, `<< /Type /Pages /Kids [${images.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${images.length} >>`)
  object(3, `<< /Title ${pdfText(title)} /Producer ${pdfText('めくりめくり')} >>`)

  const x = PDF_MARGIN
  const y = PDF_PAGE.height - PDF_MARGIN - PDF_IMAGE.height
  images.forEach((img, i) => {
    const id = pageId(i)
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PDF_PAGE.width)} ${num(PDF_PAGE.height)}] ` +
        `/Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`,
    )
    const draw = enc.encode(`q ${num(PDF_IMAGE.width)} 0 0 ${num(PDF_IMAGE.height)} ${num(x)} ${num(y)} cm /Im0 Do Q`)
    object(id + 1, `<< /Length ${draw.length} >>`, draw)
    object(
      id + 2,
      `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>`,
      img.jpeg,
    )
  })

  // 目次(それぞれの書き始めの位置)
  const xref = length
  let table = `xref\n0 ${count + 1}\n0000000000 65535 f \n`
  for (let id = 1; id <= count; id++) table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  write(table)
  write(`trailer\n<< /Size ${count + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return parts
}

export function buildPdf(images: readonly PdfImage[], title = ''): Blob {
  return new Blob(buildPdfParts(images, title) as BlobPart[], { type: 'application/pdf' })
}
