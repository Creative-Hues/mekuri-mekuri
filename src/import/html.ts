/**
 * Markdown の中に書かれた HTML の扱い。
 * HTML はアプリの中で動かさないため、タグはすべて読み飛ばし、中の文字だけを残す。
 * <script> <style> などの中身は文字としても残さない。DOM には一度も入れず、文字の処理だけで行う
 */

/** 中身ごと読み飛ばすタグ */
export const SKIP_CONTENT_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'template', 'textarea', 'noscript', 'svg', 'math']

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  yen: '¥',
  times: '×',
}

/** 「&amp;」「&#12354;」などの文字参照を、元の文字に戻す。知らない名前はそのまま */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (all, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      // 0 や範囲外・サロゲートは置き換え文字にする
      if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�'
      return String.fromCodePoint(code)
    }
    return NAMED[ref.toLowerCase()] ?? all
  })
}

/** タグの名前(「<div class=…>」→「div」、「</p>」→「p」)。タグでなければ null */
export function tagName(html: string): { name: string; closing: boolean } | null {
  const m = /^<\s*(\/?)\s*([a-z][a-z0-9-]*)/i.exec(html.trim())
  return m ? { name: m[2].toLowerCase(), closing: m[1] === '/' } : null
}

/** 改行として扱うタグ(<br>・段落などの区切り) */
const BREAK_TAGS = /^(br|p|div|li|tr|h[1-6]|blockquote|pre|ul|ol|table|section|article|header|footer)$/

/**
 * HTML のまとまり(ブロック)から、文字だけを取り出す。タグを読み飛ばした数も返す。
 * 段落などの区切りは改行にする
 */
export function htmlToText(html: string): { text: string; tags: number } {
  let tags = 0
  let s = html
  // 中身ごと読み飛ばすタグ・コメント・CDATA
  const skip = new RegExp(`<(${SKIP_CONTENT_TAGS.join('|')})\\b[\\s\\S]*?(<\\/\\1\\s*>|$)`, 'gi')
  s = s.replace(skip, () => {
    tags++
    return ''
  })
  s = s.replace(/<!--[\s\S]*?(-->|$)|<!\[CDATA\[[\s\S]*?(\]\]>|$)|<![^>]*>|<\?[\s\S]*?(\?>|$)/g, () => {
    tags++
    return ''
  })
  // 残りのタグ(属性に「>」を含むものも、引用符の中は飛ばす)
  s = s.replace(/<\/?[a-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/gi, (tag) => {
    tags++
    const t = tagName(tag)
    return t && BREAK_TAGS.test(t.name) ? '\n' : ''
  })
  return { text: decodeEntities(s), tags }
}
