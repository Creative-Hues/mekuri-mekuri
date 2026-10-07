import { downloadBlob } from './download'
import { safeFileName } from './model'
import type { ExportSource } from './load'
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

/** ノートをファイルに書き出す(Word・Markdown・テキスト) */
export async function exportNoteFile(source: ExportSource, format: FileFormat): Promise<void> {
  const { model } = source
  if (format === 'txt') {
    downloadBlob(new Blob([toText(model)], { type: 'text/plain;charset=utf-8' }), safeFileName(model.title, 'txt'))
    return
  }
  if (format === 'md') {
    downloadBlob(new Blob([toMarkdown(model)], { type: 'text/markdown;charset=utf-8' }), safeFileName(model.title, 'md'))
    return
  }
  // Word の部分はライブラリが大きいので、選んだときだけ読み込む
  const { toDocx } = await import('./toDocx')
  const blob = await toDocx(model, source.images)
  downloadBlob(blob, safeFileName(model.title, 'docx'))
}
