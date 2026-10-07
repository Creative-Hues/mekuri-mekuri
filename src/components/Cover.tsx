import type { CSSProperties } from 'react'
import type { NoteDesign } from '../db/db'
import { coverFont, coverPattern, coverTextColor, patternInk } from '../design/cover'
import { normalizeDesign } from '../design/defaults'
import { coverColor } from '../design/palette'

/**
 * ノートの表紙(本棚・ゴミ箱・デザインの見本で使う)。
 * 大きさは親の枠に合わせ、文字の大きさも表紙の幅に合わせて変わる
 */
export function Cover({ title, design }: { title: string; design: NoteDesign | undefined }) {
  const d = normalizeDesign(design)
  const color = coverColor(d.cover.color)!
  const font = coverFont(d.cover.font)!
  const style = {
    backgroundColor: color.hex,
    ...coverPattern(d.cover.pattern)!.css(patternInk(color.tone)),
    '--cover-text': coverTextColor(color.tone),
    fontFamily: font.family,
    fontWeight: font.weight,
    letterSpacing: `${font.spacing}em`,
  } as CSSProperties
  return (
    <span className={`cover cover--${d.cover.layout} cover--${color.tone}`} style={style}>
      <span className="cover-title">{title || '無題のノート'}</span>
    </span>
  )
}
