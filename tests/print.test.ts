import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { paginate, type Atom, type Slice } from '../src/export/paginate'
import { LINE_COLOR_KEYS, LINE_SHAPES, LINE_SVG_LENGTH, buildLineCss, lineSvgUrl } from '../src/editor/lineStyles'
import { TEXT_COLORS } from '../src/editor/palette'

// PDF(印刷):紙の分け方(ページ番号がずれないように)と、波線・点線・二重線の描き方

/** 範囲がすき間なく続き、どれも紙1枚に収まるか */
function expectValid(slices: Slice[], height: number, page: number) {
  expect(slices[0].start).toBe(0)
  expect(slices.at(-1)!.end).toBeCloseTo(Math.max(0, height))
  for (let i = 0; i < slices.length; i++) {
    expect(slices[i].end - slices[i].start).toBeLessThanOrEqual(page + 0.5)
    if (i > 0) expect(slices[i].start).toBe(slices[i - 1].end)
  }
}
/** 行を 30px ずつ(行の高さ 24px、行間 6px)並べる */
const lines = (n: number, top = 0): Atom[] => Array.from({ length: n }, (_, i) => ({ top: top + i * 30, bottom: top + i * 30 + 24 }))

describe('紙の分け方(paginate)', () => {
  it('1枚に収まるページは1枚', () => {
    expect(paginate(500, lines(10), 1000)).toEqual([{ start: 0, end: 500 }])
    expect(paginate(1000, lines(10), 1000)).toEqual([{ start: 0, end: 1000 }])
  })

  it('空のページも1枚(番号の数がずれない)', () => {
    expect(paginate(0, [], 1000)).toEqual([{ start: 0, end: 0 }])
  })

  it('長いページは何枚かに分かれ、文字の行の途中では切らない', () => {
    const atoms = lines(100) // 0〜3000px
    const slices = paginate(3000, atoms, 1000)
    expectValid(slices, 3000, 1000)
    expect(slices.length).toBe(4)
    for (const s of slices.slice(0, -1)) {
      // 境目がどの行の中にもない
      expect(atoms.some((a) => a.top < s.end - 0.5 && a.bottom > s.end + 0.5)).toBe(false)
    }
    // 1000px は 33行目(990〜1014)の途中なので、その行の上(990)で切る
    expect(slices[0].end).toBe(990)
  })

  it('画像や表の行など大きなものも、途中では切らずに次の紙へ送る', () => {
    const atoms = [...lines(20), { top: 700, bottom: 1300 }] // 600px の画像
    const slices = paginate(2000, atoms, 1000)
    expectValid(slices, 2000, 1000)
    expect(slices[0].end).toBe(700)
    expect(slices[1].start).toBe(700)
  })

  it('紙1枚より大きいもの(避けられない)は、紙の高さで切る(止まらない)', () => {
    const slices = paginate(2500, [{ top: 0, bottom: 2500 }], 1000)
    expectValid(slices, 2500, 1000)
    expect(slices.map((s) => s.end)).toEqual([1000, 2000, 2500])
  })

  it('重なったもの(付箋の下の行など)も、まとめて避ける', () => {
    const atoms = [{ top: 900, bottom: 1100 }, { top: 950, bottom: 1050 }, ...lines(40)]
    const slices = paginate(1300, atoms, 1000)
    expectValid(slices, 1300, 1000)
    expect(slices[0].end).toBeLessThanOrEqual(900)
  })

  it('紙の高さが正しくないときはエラー', () => {
    expect(() => paginate(100, [], 0)).toThrow()
  })

  it('ページ番号の数(紙の数)は、ページごとの紙の数の合計で、範囲の数と同じ', () => {
    const pages = [paginate(500, lines(10), 1000), paginate(2500, lines(80), 1000), paginate(0, [], 1000)]
    const total = pages.reduce((n, s) => n + s.length, 0)
    expect(pages.map((s) => s.length)).toEqual([1, 3, 1])
    expect(total).toBe(5)
  })
})

describe('PDF の紙と番号(print.css・PrintView)', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles/print.css'), 'utf8')
  const view = readFileSync(join(process.cwd(), 'src/export/PrintView.tsx'), 'utf8')

  it('紙は1枚ずつ同じ大きさで、印刷の1枚になる', () => {
    expect(css).toMatch(/\.print-sheet \{[^}]*height: 268mm;[^}]*overflow: hidden;/)
    expect(css).toMatch(/@media print[\s\S]*\.print-sheet \{\s*break-after: page;/)
  })

  it('番号は紙の縁の内側の下中央に「1 / 6」の形で出す', () => {
    expect(css).toMatch(/\.print-number \{[^}]*position: absolute;[^}]*bottom: 10px;[^}]*text-align: center;/)
    // ページ番号はノートごとに数える(本棚でまとめて書き出すときも、ノートごとに 1 から)
    expect(view).toMatch(/\{i \+ 1\} \/ \{total\}/)
  })

  it('測るときは、印刷と同じ幅(A4 から左右の余白を引いた 186mm)で並べる', () => {
    expect(css).toMatch(/\.print-root\.is-measuring \{[^}]*width: 186mm;/)
  })
})

describe('波線・点線・二重線(PDF でもくっきり出るように SVG で描く)', () => {
  const colors = {
    light: Object.fromEntries(LINE_COLOR_KEYS.map((k, i) => [k, `#0000${String(i).padStart(2, '0')}`])),
    dark: Object.fromEntries(LINE_COLOR_KEYS.map((k, i) => [k, `#ffff${String(i).padStart(2, '0')}`])),
  }
  const css = buildLineCss(colors)

  it('線の SVG は繰り返さない長い1本(繰り返すと PDF で粗い画像になるため)', () => {
    for (const shape of LINE_SHAPES) {
      const svg = decodeURIComponent(lineSvgUrl(shape, '#123456'))
      expect(svg).toContain(`width='${LINE_SVG_LENGTH}'`)
      expect(svg).toContain('#123456')
    }
    expect(css).toContain('background-repeat: no-repeat')
    expect(css).not.toMatch(/repeat-x/)
  })

  it('波線は波の形(曲線)、点線は丸い点(印刷でも見える大きさ)、二重線は2本の線', () => {
    expect(decodeURIComponent(lineSvgUrl('wavy', '#000'))).toMatch(/<path d='M0 2 q2 -2 4 0( t4 0)+'/)
    const dot = decodeURIComponent(lineSvgUrl('dotted', '#000'))
    expect(dot).toContain("stroke-linecap='round'")
    expect(Number(/stroke-width='([\d.]+)'/.exec(dot)![1])).toBeGreaterThanOrEqual(2.5)
    expect(decodeURIComponent(lineSvgUrl('double', '#000')).match(/<rect /g)).toHaveLength(2)
  })

  it('明るい紙・暗い紙それぞれの色で、文字と同じ色・すべての文字色の線を作る', () => {
    for (const shape of LINE_SHAPES) {
      for (const k of LINE_COLOR_KEYS) expect(css).toContain(`--ln-${shape}-${k}:`)
    }
    // 明るい紙の色(#0000..)と暗い紙の色(#ffff..)の両方が入っている
    expect(css).toContain(encodeURIComponent('#000000'))
    expect(css).toContain(encodeURIComponent('#ffff00'))
    expect(css).toMatch(/:root,\n\.tone-light \{/)
    expect(css).toMatch(/:root\[data-theme='dark'\],\n\.tone-dark \{/)
  })

  it('本文と付箋の両方に、線の色・文字色ごとの規則がある', () => {
    for (const shape of LINE_SHAPES) {
      expect(css).toContain(`.page-editor u[data-line-style='${shape}']`)
      expect(css).toContain(`.sticky-editor u[data-line-style='${shape}']`)
      for (const c of TEXT_COLORS) {
        expect(css).toContain(`u[data-line-style='${shape}'][data-line-color='${c.name}']`)
        expect(css).toContain(`span[data-text-color='${c.name}'] u[data-line-style='${shape}']:not([data-line-color])`)
      }
    }
    // 実線はこれまでどおり text-decoration(ここでは作らない)
    expect(css).not.toContain(`data-line-style='solid'`)
  })
})
