import type { StickyColor } from '../db/db'
import type { Block } from '../export/model'

/**
 * 読み込み(テキスト・Markdown・Word → 新しいノート)用の、ページ内容の簡単な形。
 * 書き出しの Block / Run(src/export/model.ts)と同じ形を使い、
 * 形式ごとの読み取り(fromText・fromMarkdown・fromDocx)→ この形 → TipTap の JSON(toContent.ts)の順に変える
 */

/** 読み込みで使うブロック。画像は、まだ保存していないデータを key で指す(ImportedDoc の images) */
export type ImportBlock = Exclude<Block, { kind: 'image' } | { kind: 'noteLink' }> | { kind: 'image'; key: string }

export interface ImportedSticky {
  color: StickyColor
  blocks: ImportBlock[]
}

export interface ImportedPage {
  blocks: ImportBlock[]
  stickies: ImportedSticky[]
}

/** 読み込み前の画像(保存するときに縮小して images テーブルに入れる) */
export interface PendingImage {
  data: ArrayBuffer
  mime: string
}

/** 再現できなかったものの種類(数を数えて、読み込んだあとに知らせる。文は report.ts) */
export type IssueKind =
  | 'italic'
  | 'code'
  | 'html'
  | 'unsafeLink'
  | 'externalImage'
  | 'brokenImage'
  | 'deepHeading'
  | 'quote'
  // ここから Word
  | 'unsupportedImage'
  | 'imageInTable'
  | 'mergedCell'
  | 'shape'
  | 'footnote'
  | 'comment'
  | 'headerFooter'
  | 'revision'
  | 'layout'

export type Issues = Map<IssueKind, number>

export function addIssue(issues: Issues, kind: IssueKind, n = 1) {
  issues.set(kind, (issues.get(kind) ?? 0) + n)
}

/** 読み込めなかったときのエラー(画面にそのまま出す文) */
export class ImportError extends Error {}

/** 1つのファイルを読み取った結果 */
export interface ImportedDoc {
  /** ファイルの中から決まったノート名(先頭の大見出しなど)。なければ null(ファイル名を使う) */
  title: string | null
  pages: ImportedPage[]
  images: Map<string, PendingImage>
  issues: Issues
}

export const emptyPage = (): ImportedPage => ({ blocks: [], stickies: [] })

/**
 * 読み込んだリンクの URL を確かめる。http・https・mailto だけを通し、それ以外(javascript: など)は null。
 * 「example.com」のような書き方や、ファイルの中の場所を指すリンクも、どこへ行くか分からないので null
 */
export function safeHref(raw: string): string | null {
  const text = raw.trim()
  // 空白・制御文字を含むもの(「java\tscript:」のようなごまかし)は使わない
  if (!text || /[\s\u0000-\u001f\u007f]/.test(text)) return null
  if (!/^(https?:\/\/|mailto:)/i.test(text)) return null
  try {
    const url = new URL(text)
    if (url.protocol === 'mailto:') return text
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname) return null
    // 確かめたあとは、書かれたままの形で使う(末尾の「/」などを足さない)
    return text
  } catch {
    return null
  }
}
