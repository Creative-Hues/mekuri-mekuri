import { newId, type ImageRecord, type Note, type Sticky } from '../db/db'
import { createNoteWithPages } from '../db/repo'
import { DEFAULT_H, DEFAULT_W, MAX_H } from '../editor/sticky'
import { resizeImage } from '../images/resize'
import { decodeText } from './decodeText'
import { parseText } from './fromText'
import { addIssue, ImportError, type ImportBlock, type ImportedDoc, type PendingImage } from './model'
import { issueMessages } from './report'
import { blocksToDoc, isBlankPage, type SavedImages } from './toContent'

/**
 * ファイル(テキスト・Markdown・Word)を読み込んで、新しいノートにする。1つのファイルが1つのノートになる。
 * 今あるノートには混ぜない。Markdown(marked)・Word(jszip)の部分はライブラリを使うので、読み込むときだけ読み込む
 */

export type ImportFormat = 'txt' | 'md' | 'docx'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** ファイルを選ぶ画面で選べる種類(iPhone で .md を選べるよう、拡張子と種類の両方を書く) */
export const IMPORT_ACCEPT = ['.txt', '.md', '.markdown', '.docx', 'text/plain', 'text/markdown', 'text/x-markdown', DOCX_MIME].join(',')

/** 読み込めるファイルの大きさの上限 */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024

export { ImportError }

/** ファイル名から形式を決める(拡張子がないときは種類で) */
export function detectFormat(name: string, type = ''): ImportFormat | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase()
  if (ext === 'txt' || ext === 'text') return 'txt'
  if (ext === 'md' || ext === 'markdown' || ext === 'mdown' || ext === 'mkd') return 'md'
  if (ext === 'docx') return 'docx'
  if (ext) return null
  if (type === DOCX_MIME) return 'docx'
  if (type === 'text/markdown' || type === 'text/x-markdown') return 'md'
  if (type === 'text/plain') return 'txt'
  return null
}

/** ファイル名からノート名を作る(拡張子を外す) */
export function titleFromFileName(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '').trim()
}

/** 読み込んだ形を作る(形式ごとの読み取り) */
export async function parseFileData(name: string, type: string, data: ArrayBuffer): Promise<ImportedDoc> {
  const format = detectFormat(name, type)
  if (!format) {
    if (/.doc$/i.test(name)) throw new ImportError('古い Word の形式(.doc)は読み込めません。Word で .docx として保存し直してください')
    throw new ImportError('対応していない形式です(テキスト .txt・Markdown .md・Word .docx を読み込めます)')
  }
  if (format === 'docx') {
    // Word の部分は、選んだときだけ読み込む
    const { parseDocx } = await import('./fromDocx')
    return parseDocx(data)
  }
  const text = decodeText(data)
  if (format === 'txt') return parseText(text)
  // Markdown の部分は、選んだときだけ読み込む
  const { parseMarkdown } = await import('./fromMarkdown')
  return parseMarkdown(text)
}

/** 画像を縮小して保存する形にする(テストでは差し替える)。開けない画像は null */
export type PrepareImage = (img: PendingImage) => Promise<Omit<ImageRecord, 'id' | 'createdAt' | 'unusedSince'> | null>

const defaultPrepareImage: PrepareImage = async (img) => {
  try {
    return await resizeImage(new Blob([img.data], { type: img.mime }))
  } catch {
    return null
  }
}

/** 付箋の中では表・画像を使わないので、文字にする */
function forSticky(blocks: ImportBlock[]): ImportBlock[] {
  return blocks.flatMap((b): ImportBlock[] => {
    if (b.kind === 'image') return [{ kind: 'paragraph', runs: [{ text: '[画像]' }] }]
    if (b.kind === 'table') {
      return b.rows.map((row) => ({
        kind: 'paragraph',
        runs: row.flatMap((c, i) => [...(i > 0 ? [{ text: ' / ' }] : []), ...c.paragraphs.flatMap((p, j) => [...(j > 0 ? [{ text: ' ' }] : []), ...p])]),
      }))
    }
    return [b]
  })
}

/**
 * 読み込んだ付箋の位置と大きさ。元の位置は分からないので、ページの右上から少しずつずらして並べる。
 * 高さは中身の行の数から決める(はみ出した分は付箋の中でスクロールできる)
 */
export function stickyBox(index: number, lines: number): Pick<Sticky, 'x' | 'y' | 'w' | 'h'> {
  const step = index % 8
  return {
    x: Math.max(0, 1 - DEFAULT_W - 0.03 - step * 0.03),
    y: 0.03 + index * 0.06,
    w: DEFAULT_W,
    h: Math.min(MAX_H, Math.max(DEFAULT_H, 0.08 + lines * 0.06)),
  }
}

const lineCount = (blocks: ImportBlock[]) => blocks.reduce((n, b) => n + (b.kind === 'table' ? b.rows.length : 1), 0)

/** 読み込んだ形を、新しいノートとして保存する。知らせる文(再現できなかったもの)も返す */
export async function saveImportedDoc(
  doc: ImportedDoc,
  fileName: string,
  prepareImage: PrepareImage = defaultPrepareImage,
): Promise<{ note: Note; messages: string[] }> {
  if (!doc.title && doc.pages.every(isBlankPage)) throw new ImportError('中身が空のファイルです')

  // 画像は先に縮小しておく(保存はノートと一緒に1回で行う)
  const now = Date.now()
  const records: ImageRecord[] = []
  const saved: SavedImages = new Map()
  for (const [key, img] of doc.images) {
    const ready = await prepareImage(img)
    if (!ready) {
      addIssue(doc.issues, 'brokenImage')
      continue
    }
    const id = newId()
    records.push({ ...ready, id, createdAt: now, unusedSince: null })
    saved.set(key, { id, width: ready.width, height: ready.height })
  }

  const pages = doc.pages.map((page) => ({
    content: blocksToDoc(page.blocks, saved),
    stickies: page.stickies.map((s, i): Sticky => {
      const blocks = forSticky(s.blocks)
      return { id: newId(), ...stickyBox(i, lineCount(blocks)), color: s.color, content: blocksToDoc(blocks), createdAt: now, updatedAt: now }
    }),
  }))
  // 本文から使われなかった画像(付箋の中の画像など)は保存しない
  const used = new Set(pages.flatMap((p) => JSON.stringify(p.content).match(/"imageId":"[^"]+"/g) ?? []))
  const images = records.filter((r) => used.has(`"imageId":"${r.id}"`))

  const title = (doc.title ?? titleFromFileName(fileName)).trim()
  const note = await createNoteWithPages(title, pages, images)
  return { note, messages: issueMessages(doc.issues) }
}

export type ImportResult =
  | { fileName: string; ok: true; note: Note; messages: string[] }
  | { fileName: string; ok: false; error: string }

/**
 * ファイルを1つずつ読み込む(読めなかったファイルがあっても、ほかのファイルは読み込む)。
 * 新しいノートは本棚の先頭に入るので、選んだ順で本棚に並ぶよう、後ろのファイルから保存する。結果は選んだ順
 */
export async function importFiles(files: File[], prepareImage?: PrepareImage): Promise<ImportResult[]> {
  const results: ImportResult[] = []
  for (const file of [...files].reverse()) {
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new ImportError('ファイルが大きすぎます(50MB まで)')
      const doc = await parseFileData(file.name, file.type, await file.arrayBuffer())
      const { note, messages } = await saveImportedDoc(doc, file.name, prepareImage)
      results.unshift({ fileName: file.name, ok: true, note, messages })
    } catch (e) {
      console.error('ファイルの読み込みに失敗しました', file.name, e)
      results.unshift({
        fileName: file.name,
        ok: false,
        error: e instanceof ImportError ? e.message : 'ファイルを読み込めませんでした(壊れている可能性があります)',
      })
    }
  }
  return results
}
