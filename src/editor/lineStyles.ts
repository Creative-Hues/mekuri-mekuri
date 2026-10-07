import { TEXT_COLORS } from './palette'

/**
 * ライン(波線・点線・二重線)の描き方。
 *
 * ブラウザの text-decoration の波線・点線は、PDF(印刷)にすると粗い画像になり、波線がちぎれた点線のように
 * なったり、点線が細かすぎて見えなかったりする。そこで、この3種類は「線の形の SVG」を背景に描く。
 * - SVG を繰り返し(repeat)で敷くと PDF では画像になってしまうので、長い1本の SVG を繰り返さずに敷く
 *   (行からはみ出した分は見えない)。こうすると PDF でもくっきりした線(ベクター)になる
 * - SVG の中では CSS の変数を使えないので、線の色ごとに SVG を作る。色は base.css の
 *   --ink(文字と同じ色)・--tc-<色名>(文字色)を、紙の明るさ(明るい紙・暗い紙)ごとに読み取って作る
 * - 作った SVG は、紙の明るさの CSS 変数(--ln-<種類>-<色>)にして、近い紙の色が効くようにする
 * 実線はこれまでどおり text-decoration(PDF でもくっきり出る)。
 * この仕組みが使えないとき(古い端末など)は、editor.css の text-decoration の線がそのまま出る
 */

export type LineShape = 'wavy' | 'dotted' | 'double'
export const LINE_SHAPES: readonly LineShape[] = ['wavy', 'dotted', 'double']

/** 1本の SVG の長さ(px)。1行の幅(紙の幅)より十分長くする */
export const LINE_SVG_LENGTH = 1600

/** 線の形ごとの大きさ(高さ px・行の下からの余白 px) */
export const LINE_SHAPE_SIZE: Record<LineShape, { height: number; pad: number }> = {
  wavy: { height: 4, pad: 3 },
  dotted: { height: 3, pad: 3 },
  double: { height: 4, pad: 2 },
}

/** 線の形の SVG の中身(色 c で描く) */
function shapeBody(shape: LineShape, c: string): string {
  const L = LINE_SVG_LENGTH
  if (shape === 'wavy') {
    // 周期 8px・高さ 4px の波。太さ 1.3px(なめらかな曲線をつなげる)
    const d = 'M0 2 q2 -2 4 0' + ' t4 0'.repeat(L / 4)
    return `<path d='${d}' fill='none' stroke='${c}' stroke-width='1.3'/>`
  }
  if (shape === 'dotted') {
    // 直径 2.6px の丸を 5px ごとに(印刷でも見える大きさ)。丸い端の長さ 0 の線を並べて丸にする
    return `<line x1='1.5' y1='1.5' x2='${L}' y2='1.5' stroke='${c}' stroke-width='2.6' stroke-linecap='round' stroke-dasharray='0 5'/>`
  }
  // 二重線:太さ 1.2px の線を 2本
  return `<g fill='${c}'><rect x='0' y='0' width='${L}' height='1.2'/><rect x='0' y='2.8' width='${L}' height='1.2'/></g>`
}

/** 線の SVG を CSS の url(...) にする */
export function lineSvgUrl(shape: LineShape, color: string): string {
  const { height } = LINE_SHAPE_SIZE[shape]
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${LINE_SVG_LENGTH}' height='${height}' viewBox='0 0 ${LINE_SVG_LENGTH} ${height}'>${shapeBody(shape, color)}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/** 線の色の名前:ink(文字と同じ色)と文字色の名前 */
export const LINE_COLOR_KEYS = ['ink', ...TEXT_COLORS.map((c) => c.name)] as const

/** 紙の明るさごとの、線の色(色名 → #rrggbb など) */
export type LineColors = Record<'light' | 'dark', Record<string, string>>

const varName = (shape: LineShape, key: string) => `--ln-${shape}-${key}`
const EDITORS = ['.page-editor', '.sticky-editor']
const sel = (suffix: string) => EDITORS.map((e) => `${e} ${suffix}`).join(',\n')

/** ラインの CSS を作る(テストしやすいよう、色を受け取って文字列を返す) */
export function buildLineCss(colors: LineColors): string {
  const vars = (tone: 'light' | 'dark') =>
    LINE_SHAPES.flatMap((shape) =>
      LINE_COLOR_KEYS.filter((k) => colors[tone][k]).map((k) => `  ${varName(shape, k)}: ${lineSvgUrl(shape, colors[tone][k])};`),
    ).join('\n')
  const rules: string[] = [
    // 紙の明るさの変数(base.css と同じ組み合わせ。近い紙の値が効く)
    `:root,\n.tone-light {\n${vars('light')}\n}`,
    `:root[data-theme='dark'],\n.tone-dark {\n${vars('dark')}\n}`,
  ]
  for (const shape of LINE_SHAPES) {
    const { height, pad } = LINE_SHAPE_SIZE[shape]
    const u = `u[data-line-style='${shape}']`
    rules.push(
      `${sel(u)} {\n  text-decoration-line: none;\n  padding-bottom: ${pad}px;\n  background-image: var(${varName(shape, 'ink')});\n` +
        `  background-repeat: no-repeat;\n  background-position: 0 100%;\n  background-size: auto ${height}px;\n` +
        `  -webkit-box-decoration-break: clone;\n  box-decoration-break: clone;\n}`,
    )
    for (const c of TEXT_COLORS) {
      // 文字色を付けた文字の「文字と同じ色」の線は、その文字色にする(text-decoration と同じ)
      rules.push(`${sel(`span[data-text-color='${c.name}'] ${u}:not([data-line-color])`)} {\n  background-image: var(${varName(shape, c.name)});\n}`)
      // 線の色を選んだとき
      rules.push(`${sel(`${u}[data-line-color='${c.name}']`)} {\n  background-image: var(${varName(shape, c.name)});\n}`)
    }
  }
  return rules.join('\n\n')
}

/** base.css から、紙の明るさごとの線の色を読み取る */
export function readLineColors(): LineColors | null {
  const read = (cls: string) => {
    const probe = document.createElement('div')
    probe.className = cls
    probe.style.display = 'none'
    document.body.appendChild(probe)
    const cs = getComputedStyle(probe)
    const out: Record<string, string> = {}
    for (const k of LINE_COLOR_KEYS) {
      const v = cs.getPropertyValue(k === 'ink' ? '--ink' : `--tc-${k}`).trim()
      if (v) out[k] = v
    }
    probe.remove()
    return out
  }
  const light = read('tone-light')
  const dark = read('tone-dark')
  // 読み取れないとき(CSS がない環境)は何もしない(text-decoration の線がそのまま出る)
  if (!light.ink || !dark.ink) return null
  return { light, dark }
}

/** 起動時に1回呼ぶ:ラインの CSS を作って入れる */
export function initLineStyles() {
  const colors = readLineColors()
  if (!colors) return
  let style = document.getElementById('line-styles') as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = 'line-styles'
    document.head.appendChild(style)
  }
  style.textContent = buildLineCss(colors)
}
