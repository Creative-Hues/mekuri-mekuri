import type { ReactNode } from 'react'
import { Glyph, tipProps, type ButtonDef } from '../help/buttons'
import type { HelpSection } from '../help/HelpPanel'

/**
 * 本棚のボタンの一覧(名前・アイコン・説明・ショートカット)。
 * 画面のボタン(Bookshelf.tsx)・ボタンの名前の表示・ヘルプ(ShelfHelp.tsx)は、すべてここから作る
 * (ノート画面の noteButtons.tsx と同じ考え方)。ボタンを増やすときは、ここに足してから画面に置く。
 * 画面では btn="…"(ヘッダー)・shelfButton('…')(本の下のボタンなど)でここの id を指す。
 * ここと画面の並びが合っているかは tests/shelfButtons.test.ts で確かめている
 */

/** 画面の上のボタン。並びは画面と同じ */
export const SHELF_HEADER_BUTTONS = {
  undo: {
    name: '元に戻す',
    description: '本棚での直前の操作(並び替え・お気に入り)を取り消します。',
    glyph: { icon: 'undo' },
    shortcut: 'undo',
  },
  redo: { name: 'やり直し', description: '取り消した操作をもう一度行います。', glyph: { icon: 'redo' }, shortcut: 'redo' },
  search: {
    name: '全ノート検索',
    description: 'すべてのノートのタイトル・本文から文字で探します。結果を押すと、その場所へ移動します。',
    glyph: { icon: 'search' },
    shortcut: 'search',
  },
  trash: {
    name: 'ゴミ箱',
    description: '削除したノート・ページを見ます。30日以内なら元に戻せます。',
    glyph: { icon: 'trash' },
  },
  settings: {
    name: '設定',
    description: {
      touch: '画面の明るさ・文字サイズ・バックアップ・使い方の説明などです。',
      mouse: '画面の明るさ・文字サイズ・バックアップ・ショートカットキーの一覧などです。',
    },
    glyph: { icon: 'settings' },
  },
  help: {
    name: 'ヘルプ',
    description: 'この一覧を出します。',
    glyph: { icon: 'help' },
  },
} satisfies Record<string, ButtonDef>

/** 本棚のノートまわりのボタン。並びは画面と同じ */
export const SHELF_BOOK_BUTTONS = {
  newNote: {
    name: '新しいノート',
    description: '新しいノートを作って開きます。表紙の色は自動で選ばれ、あとからデザインで変えられます。',
    glyph: { icon: 'plus' },
  },
  openNote: {
    name: 'ノートを開く',
    description: { touch: '表紙を押すと、そのノートを開きます。', mouse: '表紙をクリックすると、そのノートを開きます。' },
    glyph: { icon: 'book' },
  },
  reorder: {
    name: '並び替え',
    description: {
      touch: '表紙の下の ≡ を押したまま動かすと、ノートの順番を変えられます(お気に入りの段・ふつうの段の中で)。',
      mouse: '表紙の下の ≡ をドラッグすると、ノートの順番を変えられます(お気に入りの段・ふつうの段の中で)。',
    },
    glyph: { icon: 'grip' },
  },
  favorite: {
    name: 'お気に入り',
    description: '表紙の下の星のボタンを押すと、お気に入りの段(本棚の上)に移ります。もう一度押すと外れます。',
    glyph: { icon: 'star' },
  },
} satisfies Record<string, ButtonDef>

export type ShelfHeaderButtonId = keyof typeof SHELF_HEADER_BUTTONS
export type ShelfBookButtonId = keyof typeof SHELF_BOOK_BUTTONS

export const shelfButton = (id: ShelfBookButtonId): ButtonDef => SHELF_BOOK_BUTTONS[id]

/** ヘルプの「操作のしかた」(端末に合わせる) */
export function shelfHowTo(mouse: boolean): ReactNode[] {
  if (!mouse) {
    return [
      'ノートは表紙で本棚に並びます。表紙を押すとノートが開きます。',
      '並び替えは、表紙の下の ≡ を押したまま動かします。',
      'ボタンを長押しすると、ボタンの名前が出ます(指を離してもボタンは押されません)。',
    ]
  }
  return [
    'ノートは表紙で本棚に並びます。表紙をクリックするとノートが開きます。',
    '並び替えは、表紙の下の ≡ をドラッグします。',
    'ボタンにマウスを乗せると、ボタンの名前とショートカットキーが出ます。ショートカットキーの一覧は設定画面にもあります。',
  ]
}

export function shelfHelpSections(): HelpSection[] {
  return [
    { title: '画面の上', level: 'part', items: Object.entries(SHELF_HEADER_BUTTONS) },
    { title: 'ノート', level: 'part', items: Object.entries(SHELF_BOOK_BUTTONS) },
  ]
}

/** 本棚の上のボタン。href があればリンク(ゴミ箱・設定) */
export function ShelfHeaderButton(props: {
  btn: ShelfHeaderButtonId
  onClick?: () => void
  href?: string
  disabled?: boolean
}) {
  const def = SHELF_HEADER_BUTTONS[props.btn]
  const glyph = <Glyph glyph={def.glyph} />
  if (props.href) {
    return (
      <a className="icon-btn" href={props.href} {...tipProps(def)}>
        {glyph}
      </a>
    )
  }
  return (
    <button type="button" className="icon-btn" onClick={props.onClick} disabled={props.disabled} {...tipProps(def)}>
      {glyph}
    </button>
  )
}

/**
 * 本のまわりの要素(新しいノート・表紙・≡・星)に付ける目印。
 * 一覧のどのボタンかを画面のコードに書いておくため(読み上げの名前はノートごとに付ける)
 */
export const shelfButtonAttrs = (id: ShelfBookButtonId) => ({ 'data-btn': id })
