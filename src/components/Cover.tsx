import type { CSSProperties } from 'react'
import type { NoteDesign } from '../db/db'
import {
  coverFont,
  coverPattern,
  coverTitleHalo,
  coverTitleInk,
  coverTitleNeedsHalo,
  patternScale,
  subColorInk,
} from '../design/cover'
import { normalizeDesign } from '../design/defaults'
import { coverColor } from '../design/palette'

/**
 * ノートの表紙(本棚・ゴミ箱・デザインの見本・リンクのカードで使う)。
 * 大きさは親の枠に合わせ、文字の大きさも表紙の幅に合わせて変わる。
 * bare:タイトルを出さない(リンクのカードの小さな見本など)
 */
export function Cover({
  title,
  design,
  bare = false,
}: {
  title: string
  design: NoteDesign | undefined
  bare?: boolean
}) {
  const d = normalizeDesign(design)
  const color = coverColor(d.cover.color)!
  const font = coverFont(d.cover.font)!
  // タイトルの文字色(自動・白・黒)と、柄の上でも読めるようにする影
  const titleInk = coverTitleInk(d.cover.textColor, color.tone)
  const halo = coverTitleNeedsHalo(d.cover.pattern, d.cover.textColor)
  const style = {
    backgroundColor: color.hex,
    // 柄:ベース色の上にサブ色で描く
    ...coverPattern(d.cover.pattern)!.css(
      subColorInk(d.cover.subColor, color.tone),
      patternScale(d.cover.patternScale)!.scale,
    ),
    '--cover-text': titleInk.color,
    ...(halo ? { '--cover-halo': coverTitleHalo(titleInk.ink) } : {}),
    fontFamily: font.family,
    fontWeight: font.weight,
    letterSpacing: `${font.spacing}em`,
  } as CSSProperties
  // 見た目は cover.css:配置(cover--<配置>)・文字色(cover--text-<自動/白/黒>)・影(cover--halo)
  const className = [
    'cover',
    `cover--${d.cover.layout}`,
    `cover--${color.tone}`,
    // 白・黒の表紙は、背景に溶け込まないよう縁を付ける(cover.css)
    `cover--color-${d.cover.color}`,
    `cover--text-${d.cover.textColor}`,
    halo ? 'cover--halo' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <span className={className} style={style}>
      {!bare && <span className="cover-title">{title || '無題のノート'}</span>}
    </span>
  )
}
