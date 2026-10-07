import type { ReactNode } from 'react'
import { Glyph, tipProps, type ButtonDef } from '../help/buttons'
import { Icon } from '../components/Icon'
import type { HelpSection } from '../help/HelpPanel'

/**
 * 本棚のボタンの一覧(名前・アイコン・説明・ショートカット)。
 * 画面のボタン(Bookshelf.tsx)・ボタンの名前の表示・ヘルプ(ShelfHelp.tsx)は、すべてここから作る
 * (ノート画面の noteButtons.tsx と同じ考え方)。ボタンを増やすときは、ここに足してから画面に置く。
 * 画面では btn="…"(ヘッダー)・shelfButtonAttrs('…')(本のまわり)・select="…"(選んでいるときの帯)でここの id を指す。
 * ここと画面の並びが合っているかは tests/shelfButtons.test.ts で確かめている
 */

/** 画面の上のボタン。並びは画面と同じ */
export const SHELF_HEADER_BUTTONS = {
  undo: {
    name: '元に戻す',
    description: '本棚での直前の操作(並び替え・お気に入り・まとめての操作)を取り消します。完全に削除したものは戻せません。',
    glyph: { icon: 'undo' },
    shortcut: 'undo',
  },
  redo: { name: 'やり直し', description: '取り消した操作をもう一度行います。', glyph: { icon: 'redo' }, shortcut: 'redo' },
  select: {
    name: '選ぶ',
    description: {
      touch: 'ノートを選ぶモードにします。表紙を押して複数のノートを選び、まとめてゴミ箱へ移す・お気に入りにする/外す・書き出すことができます。',
      mouse: 'ノートを選ぶモードにします。表紙をクリックして複数のノートを選び、まとめてゴミ箱へ移す・お気に入りにする/外す・書き出すことができます。Esc で終わります。',
    },
    glyph: { icon: 'select' },
  },
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
  importFile: {
    name: 'ファイルから読み込む',
    description: {
      touch: 'テキスト(.txt)・Markdown(.md)・Word(.docx)のファイルを選ぶと、新しいノートとして読み込みます。今あるノートには混ぜません。',
      mouse:
        'テキスト(.txt)・Markdown(.md)・Word(.docx)のファイルを選ぶと、新しいノートとして読み込みます。本棚にファイルをドラッグ&ドロップしても読み込めます。今あるノートには混ぜません。',
    },
    glyph: { icon: 'upload' },
  },
  openNote: {
    name: 'ノートを開く',
    description: { touch: '表紙を押すと、そのノートを開きます。', mouse: '表紙をクリックすると、そのノートを開きます。' },
    glyph: { icon: 'book' },
  },
  selectNote: {
    name: 'ノートを選ぶ',
    description: {
      touch: '選ぶモードのときは、表紙を押すとそのノートを選びます(もう一度押すと外れます)。',
      mouse: '選ぶモードのときは、表紙をクリックするとそのノートを選びます(もう一度クリックすると外れます)。',
    },
    glyph: { icon: 'check' },
    when: '選ぶモードのとき',
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

/** 選ぶモードのとき、画面の下に出る帯のボタン。並びは画面と同じ */
export const SHELF_SELECT_BUTTONS = {
  selectAll: {
    name: 'すべて選ぶ',
    description: '本棚のノートをすべて選びます。すべて選んでいるときは「選ぶのをやめる」になり、選んだノートを外します。',
    glyph: { icon: 'check' },
  },
  favoriteOn: {
    name: 'お気に入りにする',
    description: '選んだノートをまとめてお気に入りにします(本棚の上の段に移ります)。',
    glyph: { icon: 'star' },
  },
  favoriteOff: {
    name: 'お気に入りから外す',
    description: '選んだノートをまとめてお気に入りから外します。',
    glyph: { icon: 'star' },
  },
  exportNotes: {
    name: '書き出す',
    description:
      '選んだノートをまとめて書き出します。Word・Markdown・テキストはノートごとのファイルを ZIP ファイル1つに、PDF は1回の印刷にまとめます。',
    glyph: { icon: 'download' },
  },
  trashNotes: {
    name: 'ゴミ箱へ',
    description: '選んだノートをまとめてゴミ箱に移します。30日以内ならゴミ箱から戻せます。本棚の「元に戻す」でも戻せます。',
    glyph: { icon: 'trash' },
  },
  done: {
    name: '完了',
    description: '選ぶモードを終わります。',
    glyph: { icon: 'close' },
  },
} satisfies Record<string, ButtonDef>

export type ShelfHeaderButtonId = keyof typeof SHELF_HEADER_BUTTONS
export type ShelfSelectButtonId = keyof typeof SHELF_SELECT_BUTTONS
export type ShelfBookButtonId = keyof typeof SHELF_BOOK_BUTTONS

export const shelfButton = (id: ShelfBookButtonId): ButtonDef => SHELF_BOOK_BUTTONS[id]

/** ヘルプの「操作のしかた」(端末に合わせる) */
export function shelfHowTo(mouse: boolean): ReactNode[] {
  if (!mouse) {
    return [
      'ノートは表紙で本棚に並びます。表紙を押すとノートが開きます。',
      '並び替えは、表紙の下の ≡ を押したまま動かします。',
      '複数のノートをまとめて操作するときは、上の「選ぶ」を押してから表紙を押して選びます。画面の下の帯から、ゴミ箱へ・お気に入り・書き出しをまとめて行えます。',
      'ボタンを長押しすると、ボタンの名前が出ます(指を離してもボタンは押されません)。',
    ]
  }
  return [
    'ノートは表紙で本棚に並びます。表紙をクリックするとノートが開きます。',
    '並び替えは、表紙の下の ≡ をドラッグします。',
    '複数のノートをまとめて操作するときは、上の「選ぶ」を押してから表紙をクリックして選びます。画面の下の帯から、ゴミ箱へ・お気に入り・書き出しをまとめて行えます。',
    'ボタンにマウスを乗せると、ボタンの名前とショートカットキーが出ます。ショートカットキーの一覧は設定画面にもあります。',
  ]
}

export function shelfHelpSections(): HelpSection[] {
  return [
    { title: '画面の上', level: 'part', items: Object.entries(SHELF_HEADER_BUTTONS) },
    { title: 'ノート', level: 'part', items: Object.entries(SHELF_BOOK_BUTTONS) },
    {
      title: '選んだノートの操作',
      level: 'part',
      note: '「選ぶ」を押したときに、画面の下に出る帯のボタンです。',
      items: Object.entries(SHELF_SELECT_BUTTONS),
    },
  ]
}

/** 本棚の上のボタン。href があればリンク(ゴミ箱・設定) */
export function ShelfHeaderButton(props: {
  btn: ShelfHeaderButtonId
  onClick?: () => void
  href?: string
  disabled?: boolean
  /** 切り替えのボタン(選ぶ)で、今オンか */
  pressed?: boolean
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
    <button
      type="button"
      className={`icon-btn${props.pressed ? ' is-on' : ''}`}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-pressed={props.pressed}
      {...tipProps(def)}
    >
      {glyph}
    </button>
  )
}

/**
 * 本のまわりの要素(新しいノート・表紙・≡・星)に付ける目印。
 * 一覧のどのボタンかを画面のコードに書いておくため(読み上げの名前はノートごとに付ける)
 */
export const shelfButtonAttrs = (id: ShelfBookButtonId) => ({ 'data-btn': id })

/** 選ぶモードの帯のボタン(アイコンと名前を並べる) */
export function ShelfSelectButton(props: {
  select: ShelfSelectButtonId
  onClick: () => void
  disabled?: boolean
  /** 名前を差し替える(「すべて選ぶ」→「選ぶのをやめる」など) */
  label?: string
  danger?: boolean
}) {
  const def = SHELF_SELECT_BUTTONS[props.select]
  const filled = props.select === 'favoriteOn'
  return (
    <button
      type="button"
      className={`select-bar-btn${props.danger ? ' is-danger' : ''}`}
      onClick={props.onClick}
      disabled={props.disabled}
      data-btn={props.select}
    >
      {def.glyph && 'icon' in def.glyph && <Icon name={def.glyph.icon} size={18} filled={filled} />}
      <span>{props.label ?? def.name}</span>
    </button>
  )
}
