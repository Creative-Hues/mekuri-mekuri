import type { MarkerColorName, TextColorName } from '../editor/palette'

/**
 * 出力(Word)で使う色。ライトモードの色(src/styles/base.css の --tc-* / --mk-*)と同じ値。
 * base.css の色を変えたら、ここも合わせる
 */

export const TEXT_HEX: Record<TextColorName, string> = {
  gray: '787774',
  brown: '9f6b53',
  red: 'd44c47',
  orange: 'd9730d',
  yellow: 'c29022',
  green: '448361',
  blue: '337ea9',
  purple: '9065b0',
}

export const MARKER_HEX: Record<MarkerColorName, string> = {
  yellow: 'fbeca0',
  orange: 'fbd9b8',
  pink: 'f9d4e4',
  red: 'f8cfcb',
  green: 'd3ead5',
  blue: 'd3e5f5',
  purple: 'e4d9f2',
  gray: 'e6e4df',
}

/**
 * 表の見出しの行・列の色(画面の --table-head を白い紙に重ねた色)。
 * Word の読み込みでは、この色のセルは「見出し」として読み、セルの色にはしない
 */
export const TABLE_HEAD_HEX = 'f0f1f2'
