import { afterEach, describe, expect, it } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import { buildExtensions } from '../src/editor/extensions'
import { parseMarkdown } from '../src/import/fromMarkdown'
import { parseText } from '../src/import/fromText'
import { blocksToDoc } from '../src/import/toContent'
import { safeHref } from '../src/import/model'
import { htmlToText } from '../src/import/html'

// 読み込みの安全性:ファイルの中の HTML・リンクが、アプリの中でコードとして動かないこと

let editors: Editor[] = []
afterEach(() => {
  editors.forEach((e) => e.destroy())
  editors = []
})
const hooks = { undo: () => {}, redo: () => {}, closeGroup: () => {} }

/** 読み込みで作ってよいノード・装飾 */
const NODES = new Set(['doc', 'paragraph', 'heading', 'text', 'hardBreak', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'table', 'tableRow', 'tableCell', 'image'])
const MARKS = new Set(['bold', 'strike', 'textColor', 'marker', 'underline', 'link'])

function walk(n: JSONContent, fn: (n: JSONContent) => void) {
  fn(n)
  n.content?.forEach((c) => walk(c, fn))
}

/** 本文の中の、すべての文字・リンク先 */
function inspect(content: JSONContent) {
  const texts: string[] = []
  const hrefs: string[] = []
  walk(content, (n) => {
    expect(NODES.has(n.type!), `ノード ${n.type}`).toBe(true)
    if (n.text) texts.push(n.text)
    for (const m of n.marks ?? []) {
      expect(MARKS.has(m.type), `装飾 ${m.type}`).toBe(true)
      if (m.type === 'link') hrefs.push(m.attrs?.href)
    }
  })
  return { text: texts.join(''), hrefs }
}

const mdPage = (src: string) => blocksToDoc(parseMarkdown(src).pages[0].blocks)

/** 本物のエディタに入れて、画面(DOM)に危ないものがないか確かめる */
function renderedHtml(content: JSONContent): string {
  const e = new Editor({ extensions: buildExtensions(hooks), content })
  editors.push(e)
  const html = e.view.dom.innerHTML
  expect(e.view.dom.querySelector('script, iframe, object, embed, style')).toBeNull()
  for (const el of e.view.dom.querySelectorAll('*')) {
    for (const attr of el.getAttributeNames()) expect(attr.startsWith('on'), `${el.tagName} の ${attr}`).toBe(false)
  }
  for (const a of e.view.dom.querySelectorAll('a')) expect(a.getAttribute('href') ?? '').toMatch(/^(https?:|mailto:)/)
  return html
}

describe('Markdown の中の HTML', () => {
  it('<script> は中身ごと読み飛ばす(段落の中でも、まとまりでも)', () => {
    const inline = mdPage('前 <script>alert(1)</script> 後\n')
    expect(inspect(inline).text).toBe('前  後')
    const block = mdPage('<script>\nalert(document.cookie)\n</script>\n\n本文\n')
    expect(inspect(block).text).toBe('本文')
    renderedHtml(inline)
    renderedHtml(block)
  })

  it('タグと onclick などの属性は読み飛ばし、中の文字だけ残す', () => {
    const c = mdPage('<div onclick="evil()">クリック<b>して</b></div>\n\n文中の <img src=x onerror="alert(1)"> 画像と <a href="javascript:alert(1)">リンク</a>\n')
    const { text, hrefs } = inspect(c)
    expect(text).toContain('クリックして')
    expect(text).toContain('文中の  画像と リンク')
    expect(text).not.toMatch(/onclick|onerror|alert|<|>/)
    expect(hrefs).toEqual([])
    const html = renderedHtml(c)
    expect(html).not.toMatch(/onclick|onerror|<img/)
  })

  it('<style> <iframe> とコメントも読み飛ばす', () => {
    const c = mdPage('<style>body{display:none}</style>\n\n<iframe src="https://evil.example"></iframe>\n\n<!-- 秘密 -->\n\n残る\n')
    expect(inspect(c).text).toBe('残る')
  })

  it('記号を消して書いたタグ(\\<b\\>)は、ただの文字として残る(画面でもタグにならない)', () => {
    const c = mdPage('\\<b onclick="x"\\>太字ではない\\</b\\>\n')
    expect(inspect(c).text).toBe('<b onclick="x">太字ではない</b>')
    const html = renderedHtml(c)
    expect(html).toContain('&lt;b onclick="x"&gt;')
    expect(html).not.toContain('<b ')
  })

  it('HTML のまとまりから文字を取り出す処理(DOM を使わない)', () => {
    expect(htmlToText('<p>一<br>二</p><script>x()</script><SCRIPT type="a">y()</SCRIPT>三&amp;').text).toBe('\n一\n二\n三&')
    expect(htmlToText('<a title="a>b" href="x">文字</a>').text).toBe('文字')
    // 閉じていない <script> は、最後まで読み飛ばす
    expect(htmlToText('前<script>alert(1)').text).toBe('前')
  })
})

describe('リンク', () => {
  it('http・https・mailto だけを通す', () => {
    expect(safeHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(safeHref('HTTP://EXAMPLE.COM')).toBe('HTTP://EXAMPLE.COM')
    expect(safeHref('mailto:a@example.com')).toBe('mailto:a@example.com')
    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '//evil.example',
      './other.md',
      '#見出し',
      'example.com',
      'https:alert(1)',
    ]) {
      expect(safeHref(bad), bad).toBeNull()
    }
  })

  it('危ないリンクは文字だけにして知らせる(普通の書き方・参照の書き方・<…>の書き方)', () => {
    const d = parseMarkdown(
      '[普通](javascript:alert(1)) [参照][r] <javascript:alert(2)> [データ](data:text/html;base64,PHNjcmlwdD4=) [良い](https://example.com)\n\n[r]: JAVASCRIPT:alert(3)\n',
    )
    const c = blocksToDoc(d.pages[0].blocks)
    const { text, hrefs } = inspect(c)
    expect(hrefs).toEqual(['https://example.com'])
    expect(text).toContain('普通')
    expect(text).toContain('参照')
    expect((d.issues.get('unsafeLink') ?? 0) + (d.issues.get('html') ?? 0)).toBeGreaterThanOrEqual(3)
    renderedHtml(c)
  })

  it('画像の書き方で危ないものを指しても、画像にもリンクにもしない', () => {
    const d = parseMarkdown('![x](javascript:alert(1)) ![y](data:image/svg+xml;base64,PHN2Zz4=)\n')
    expect(d.images.size).toBe(0)
    expect(inspect(blocksToDoc(d.pages[0].blocks)).text).toBe('[画像] [画像]')
  })
})

describe('テキストファイル', () => {
  it('HTML を書いても、ただの文字として残る', () => {
    const c = blocksToDoc(parseText('<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n').pages[0].blocks)
    expect(inspect(c).text).toBe('<script>alert(1)</script><img src=x onerror=alert(1)>')
    const html = renderedHtml(c)
    expect(html).toContain('&lt;script&gt;')
  })
})
