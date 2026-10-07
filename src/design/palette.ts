/**
 * ノートのデザイン(紙の背景色・縁・表紙)で選べる色と種類。
 * データには名前(cream など)だけを保存する。
 * 名前を変える・消すと保存済みのノートの見た目が出なくなるので、追加だけにすること
 *
 * これらの色は「ユーザーが選んだ色」なので、ダークモードでも同じ色のまま表示する
 * (計画書:ノート自体の背景色はユーザーが決めた色を優先する)
 */

export type Tone = 'light' | 'dark'

export interface DesignColor {
  name: string
  label: string
  hex: string
  /** 明るい色か暗い色か(上に乗せる文字の色を決める) */
  tone: Tone
}

/** 紙の背景色(「指定なし」は null で、アプリのテーマに合わせる) */
export const PAPER_COLORS: readonly DesignColor[] = [
  { name: 'white', label: '白', hex: '#ffffff', tone: 'light' },
  { name: 'ivory', label: 'アイボリー', hex: '#fffaf0', tone: 'light' },
  { name: 'cream', label: 'クリーム', hex: '#f6efe0', tone: 'light' },
  { name: 'pink', label: 'ピンク', hex: '#fbeef0', tone: 'light' },
  { name: 'peach', label: 'ピーチ', hex: '#fdf0e4', tone: 'light' },
  { name: 'lemon', label: 'レモン', hex: '#fbf7dc', tone: 'light' },
  { name: 'mint', label: 'ミント', hex: '#ecf6ef', tone: 'light' },
  { name: 'sky', label: '空色', hex: '#ebf3fa', tone: 'light' },
  { name: 'lavender', label: 'ラベンダー', hex: '#f2eef8', tone: 'light' },
  { name: 'gray', label: 'グレー', hex: '#efefec', tone: 'light' },
  { name: 'navy', label: '紺', hex: '#1f2a3a', tone: 'dark' },
  { name: 'blackboard', label: '黒板', hex: '#24382f', tone: 'dark' },
  { name: 'charcoal', label: '墨', hex: '#2a2a2d', tone: 'dark' },
]

/** 縁の色 */
export const BORDER_COLORS: readonly DesignColor[] = [
  { name: 'brown', label: '茶', hex: '#8b6b4a', tone: 'dark' },
  { name: 'beige', label: 'ベージュ', hex: '#d8c6a6', tone: 'light' },
  { name: 'gold', label: '金茶', hex: '#c9a14a', tone: 'light' },
  { name: 'red', label: '赤', hex: '#c0504d', tone: 'dark' },
  { name: 'pink', label: 'ピンク', hex: '#e39bb0', tone: 'light' },
  { name: 'orange', label: 'オレンジ', hex: '#e0894a', tone: 'light' },
  { name: 'green', label: '緑', hex: '#5f8f6a', tone: 'dark' },
  { name: 'teal', label: '青緑', hex: '#4f8f8f', tone: 'dark' },
  { name: 'blue', label: '青', hex: '#4a73a8', tone: 'dark' },
  { name: 'navy', label: '紺', hex: '#2f4a6d', tone: 'dark' },
  { name: 'purple', label: '紫', hex: '#8a6bb0', tone: 'dark' },
  { name: 'gray', label: 'グレー', hex: '#8c8c8c', tone: 'dark' },
  { name: 'black', label: '黒', hex: '#2b2b2b', tone: 'dark' },
]

/** 縁の太さ(none は今までどおりの細い線) */
export const BORDER_WIDTHS = [
  { name: 'none', label: 'なし', px: 0 },
  { name: 'thin', label: '細', px: 2 },
  { name: 'medium', label: '中', px: 5 },
  { name: 'thick', label: '太', px: 10 },
] as const

export type BorderWidthName = (typeof BORDER_WIDTHS)[number]['name']

/** 表紙の色 */
export const COVER_COLORS: readonly DesignColor[] = [
  { name: 'slate', label: '青磁', hex: '#8fa3a6', tone: 'dark' },
  { name: 'navy', label: '紺', hex: '#2f4a6d', tone: 'dark' },
  { name: 'forest', label: '深緑', hex: '#3f6b4e', tone: 'dark' },
  { name: 'wine', label: 'えんじ', hex: '#8a3b4a', tone: 'dark' },
  { name: 'terracotta', label: 'テラコッタ', hex: '#c46a4a', tone: 'dark' },
  { name: 'mustard', label: 'からし', hex: '#d9ad45', tone: 'light' },
  { name: 'sakura', label: '桜', hex: '#f1c6cf', tone: 'light' },
  { name: 'mint', label: 'ミント', hex: '#bfe0d0', tone: 'light' },
  { name: 'sky', label: '空色', hex: '#b9d4ea', tone: 'light' },
  { name: 'lavender', label: '藤', hex: '#cdbfe3', tone: 'light' },
  { name: 'cream', label: '生成り', hex: '#efe6d2', tone: 'light' },
  { name: 'charcoal', label: '墨', hex: '#3a3a3e', tone: 'dark' },
  // 白・黒(アプリ 1.1.0〜)。白はライトモード、黒はダークモードの背景に溶け込まないよう、
  // 表紙に薄い縁を付ける(cover.css の .cover--color-white / .cover--color-black)
  { name: 'white', label: '白', hex: '#ffffff', tone: 'light' },
  { name: 'black', label: '黒', hex: '#1a1a1a', tone: 'dark' },
]

/** 新しいノートの表紙の色をランダムに選ぶときの候補(白・黒は選ばない) */
export const RANDOM_COVER_COLORS = COVER_COLORS.filter((c) => c.name !== 'white' && c.name !== 'black')

/**
 * 表紙の柄の色(サブ色、アプリ 1.1.0〜)。表紙の色(白・黒を含む)と同じ。
 * このほかに auto(なじむ色:ベース色に合わせた半透明の色。1.0.0 までの柄の色)がある
 */
export const SUB_COLOR_AUTO = 'auto'
export const SUB_COLORS: readonly DesignColor[] = COVER_COLORS

const byName = (list: readonly DesignColor[]) => new Map(list.map((c) => [c.name, c]))
const paperMap = byName(PAPER_COLORS)
const borderMap = byName(BORDER_COLORS)
const coverMap = byName(COVER_COLORS)
const subMap = byName(SUB_COLORS)

export const paperColor = (name: string | null | undefined) => (name ? paperMap.get(name) : undefined)
export const borderColor = (name: string | null | undefined) => (name ? borderMap.get(name) : undefined)
export const coverColor = (name: string | null | undefined) => (name ? coverMap.get(name) : undefined)
/** サブ色(auto・知らない名前は undefined) */
export const subColor = (name: string | null | undefined) => (name ? subMap.get(name) : undefined)
export const borderWidth =(name: string | null | undefined) => BORDER_WIDTHS.find((w) => w.name === name)
