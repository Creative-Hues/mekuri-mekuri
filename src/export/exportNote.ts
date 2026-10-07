import { stamp } from '../backup/export'
import { downloadBlob } from './download'
import { safeFileName } from './model'
import type { ExportSource } from './load'
import { exportNotices } from './notices'
import { toMarkdown } from './toMarkdown'
import { toText } from './toText'

/** 書き出しの形式(PDF は印刷画面を使うので PrintView.tsx) */
export type FileFormat = 'docx' | 'md' | 'txt'

/** 形式を選ぶボタンの文字(狭い画面でも並ぶよう短くする。説明はダイアログの本文に書く) */
export const FORMAT_LABELS: Record<FileFormat | 'pdf', string> = {
  pdf: 'PDF',
  docx: 'Word',
  md: 'Markdown',
  txt: 'テキスト',
}

/** ノート1冊分のファイルを作る */
async function fileOf(source: ExportSource, format: FileFormat): Promise<{ blob: Blob; name: string }> {
  const { model } = source
  if (format === 'txt') {
    return { blob: new Blob([toText(model)], { type: 'text/plain;charset=utf-8' }), name: safeFileName(model.title, 'txt') }
  }
  if (format === 'md') {
    return { blob: new Blob([toMarkdown(model)], { type: 'text/markdown;charset=utf-8' }), name: safeFileName(model.title, 'md') }
  }
  // Word の部分はライブラリが大きいので、選んだときだけ読み込む
  const { toDocx } = await import('./toDocx')
  return { blob: await toDocx(model, source.images), name: safeFileName(model.title, 'docx') }
}

/**
 * ノートをファイルに書き出す(Word・Markdown・テキスト)。
 * 返り値:その形式で表せなかったもののお知らせ(なければ空)
 */
export async function exportNoteFile(source: ExportSource, format: FileFormat): Promise<string[]> {
  const { blob, name } = await fileOf(source, format)
  downloadBlob(blob, name)
  return exportNotices([source.model], format)
}

/** 同じ名前のファイルには「(2)」「(3)」…を付ける */
export function uniqueNames(names: string[]): string[] {
  const used = new Set<string>()
  return names.map((name) => {
    const dot = name.lastIndexOf('.')
    const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
    let candidate = name
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base}(${n})${ext}`
    used.add(candidate.toLowerCase())
    return candidate
  })
}

/** 複数のノートを、ノートごとのファイルにして1つの ZIP に入れる */
export async function buildNotesZip(sources: ExportSource[], format: FileFormat): Promise<Blob> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const files: { blob: Blob; name: string }[] = []
  for (const source of sources) files.push(await fileOf(source, format))
  const names = uniqueNames(files.map((f) => f.name))
  files.forEach((f, i) => zip.file(names[i], f.blob))
  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' })
}

/**
 * 複数のノートを書き出す(1冊なら、いつもの1ファイル。2冊以上は ZIP 1つ)。
 * 返り値:その形式で表せなかったもののお知らせ
 */
export async function exportNotesFile(sources: ExportSource[], format: FileFormat, now = new Date()): Promise<string[]> {
  if (sources.length === 1) return exportNoteFile(sources[0], format)
  downloadBlob(await buildNotesZip(sources, format), `mekuri-notes-${stamp(now)}.zip`)
  return exportNotices(
    sources.map((s) => s.model),
    format,
  )
}
