import type { ReactNode } from 'react'
import { shortcutText } from '../../editor/shortcuts'
import { Glyph, tipProps, type ButtonDef } from '../../help/buttons'
import type { HelpSection } from '../../help/HelpPanel'

/**
 * ノート画面のヘッダーとツールバーのボタンの一覧(名前・アイコン・説明・ショートカット)。
 * 画面のボタン(Toolbar.tsx・NoteView.tsx)・ボタンに出す名前(help/ButtonTips.tsx)・ヘルプ(NoteHelp.tsx)は、
 * すべてここから作る。ボタンを増やすときは、ここに足してから画面に置く
 * (画面のボタンは btn="…" でここの id を指す。id がないとビルドが通らない。
 *  ここと画面の並びが合っているかは tests/noteButtons.test.ts で確かめている)
 */

/** ヘッダー(画面の上)のボタン。並びは画面と同じ */
export const HEADER_BUTTONS = {
  back: {
    name: '本棚へ戻る',
    description: '本棚(ノートの一覧)に戻ります。',
    glyph: { icon: 'back' },
    when: { touch: 'スマホ・タブレット', mouse: 'ノートの一覧が出ていない画面' },
  },
  sidebar: {
    name: 'ノート一覧',
    description: '左側にノートの一覧を開いて、ほかのノートに切り替えます。',
    glyph: { icon: 'menu' },
    when: 'タブレットなど、一覧を開いたり閉じたりできる画面',
  },
  toc: {
    name: '目次',
    description: {
      touch: '見出しの一覧を出します。見出しを押すと、その場所へ移動します。',
      mouse: '見出しの一覧を出します。見出しをクリックすると、その場所へ移動します。',
    },
    glyph: { icon: 'toc' },
    shortcut: 'toc',
  },
  pageList: {
    name: 'ページ一覧',
    description: {
      touch: 'ページを小さく並べて見ます。押すとそのページへ移動します。≡ を押したまま動かすと並び替え、追加・削除もできます。',
      mouse: 'ページを小さく並べて見ます。クリックするとそのページへ移動します。≡ をドラッグすると並び替え、追加・削除もできます。',
    },
    glyph: { icon: 'pages' },
    shortcut: 'pageList',
  },
  design: {
    name: 'デザイン',
    description: '表紙(色・柄・文字の配置・文字色・書体)、本文の書体、紙の色と縁を選びます。',
    glyph: { icon: 'palette' },
  },
  help: {
    name: 'ヘルプ',
    description: 'この一覧を出します。',
    glyph: { icon: 'help' },
  },
  menu: {
    name: 'ノートのメニュー',
    description: 'お気に入り・全ノート検索・文字サイズ・書き出し(PDF・Word など)・ノートの削除ができます。',
    glyph: { icon: 'dots' },
  },
} satisfies Record<string, ButtonDef>

/** ツールバーのボタン。並びは画面と同じ。title はヘルプでの見出し */
export const TOOLBAR_GROUPS = [
  {
    title: '元に戻す',
    buttons: {
      undo: { name: '元に戻す', description: '直前の操作を取り消します。', glyph: { icon: 'undo' }, shortcut: 'undo' },
      redo: { name: 'やり直し', description: '取り消した操作をもう一度行います。', glyph: { icon: 'redo' }, shortcut: 'redo' },
    },
  },
  {
    title: '見出し',
    buttons: {
      h1: {
        name: '大見出し',
        description: 'カーソルのある行を大きな見出しにします。もう一度押すと本文に戻ります。',
        glyph: { text: '大' },
        shortcut: 'h1',
      },
      h2: { name: '中見出し', description: '中くらいの見出しにします。', glyph: { text: '中' }, shortcut: 'h2' },
      h3: { name: '小見出し', description: '小さな見出しにします。', glyph: { text: '小' }, shortcut: 'h3' },
      toggle: {
        name: 'トグル見出し',
        description: '押すと中身を開いたり閉じたりできる見出しにします。',
        glyph: { icon: 'toggle' },
      },
      body: { name: '本文に戻す', description: '見出しを普通の文に戻します。', glyph: { text: '本' }, shortcut: 'body' },
    },
  },
  {
    title: '文字の飾り',
    buttons: {
      bold: {
        name: '太字',
        description: '選んだ文字を太くします。',
        glyph: { text: 'B', textClass: 'tb-bold' },
        shortcut: 'bold',
      },
      strike: {
        name: '取り消し線',
        description: '選んだ文字に横線を引きます。',
        glyph: { text: 'S', textClass: 'tb-strike' },
        shortcut: 'strike',
      },
      textColor: { name: '文字色', description: '選んだ文字の色を変えます。', glyph: { text: 'A', textClass: 'tb-color' } },
      marker: {
        name: 'マーカー',
        description: '選んだ文字の後ろに色を塗ります。',
        glyph: { icon: 'marker' },
        shortcut: 'marker',
        shortcutNote: '最後に使った色を付け外し',
      },
      line: {
        name: 'ライン',
        description: '選んだ文字の下に線を引きます(下線・波線・二重線・点線と色を選べます)。',
        glyph: { text: 'U', textClass: 'tb-line' },
        shortcut: 'line',
        shortcutNote: '最後に使った線を付け外し',
      },
    },
  },
  {
    title: 'リスト',
    buttons: {
      bulletList: {
        name: '箇条書き',
        description: '行の頭に「・」を付けたリストにします。',
        glyph: { icon: 'bullet' },
        shortcut: 'bulletList',
      },
      orderedList: {
        name: '番号付きリスト',
        description: '行の頭に 1. 2. 3. と番号を付けたリストにします。',
        glyph: { icon: 'ordered' },
        shortcut: 'orderedList',
      },
      taskList: {
        name: 'ToDoリスト',
        description: 'チェックボックス付きのリストにします。終わったらチェックを付けます。',
        glyph: { icon: 'todo' },
        shortcut: 'taskList',
      },
    },
  },
  {
    title: '入れる・動かす',
    buttons: {
      insert: {
        name: '挿入',
        description: '表・画像・Webリンク・ほかのノートやページへのリンクを入れます。',
        glyph: { icon: 'plus' },
      },
      tableMenu: {
        name: '表の操作',
        description: {
          touch: 'セルの色・行や列の追加と削除をします(セルを長押ししても出せます)。',
          mouse: 'セルの色・行や列の追加と削除をします(セルを右クリックしても出せます)。',
        },
        glyph: { icon: 'table' },
        when: 'カーソルが表の中にあるとき',
      },
      sticky: {
        name: '付箋を追加',
        description: {
          touch: 'ページに付箋を貼ります。付箋の ≡ を押したまま動かすと移動、右下の角で大きさを変えます。',
          mouse: 'ページに付箋を貼ります。付箋の ≡ をドラッグすると移動、右下の角で大きさを変えます。',
        },
        glyph: { icon: 'sticky' },
        shortcut: 'addSticky',
      },
      select: {
        name: '行を選ぶ',
        description:
          '動かしたい行にチェックを付けて、まとめて移動します(離れた行や別のページへも)。行の左の ≡ を長押ししても始められます。',
        glyph: { icon: 'select' },
      },
    },
  },
  {
    title: 'キーボード',
    buttons: {
      keyboardHide: {
        name: 'キーボードを閉じる',
        description: '画面のキーボードを閉じます。',
        glyph: { icon: 'keyboardHide' },
        when: 'キーボードが出ているとき(ツールバーの右端)',
        only: 'touch',
      },
    },
  },
] as const satisfies readonly { title: string; buttons: Record<string, ButtonDef> }[]

type ToolbarButtons = (typeof TOOLBAR_GROUPS)[number]['buttons']
type KeysOfUnion<T> = T extends unknown ? keyof T : never
export type HeaderButtonId = keyof typeof HEADER_BUTTONS
export type ToolbarButtonId = KeysOfUnion<ToolbarButtons>

export const toolbarButton = (id: ToolbarButtonId): ButtonDef => {
  for (const g of TOOLBAR_GROUPS) {
    const def = (g.buttons as Record<string, ButtonDef>)[id]
    if (def) return def
  }
  throw new Error(`ツールバーのボタン ${id} がありません`)
}
export const headerButton = (id: HeaderButtonId): ButtonDef => HEADER_BUTTONS[id]

/** ヘルプの「操作のしかた」(端末に合わせる)。ボタン以外の、指・マウスでの操作 */
export function noteHowTo(mouse: boolean): ReactNode[] {
  if (!mouse) {
    return [
      'ページは左右にスワイプしてめくります。',
      '行を動かす:動かしたい行にカーソルを置くと、行の左に ≡ が出ます。≡ を押したまま上下に動かします。',
      '≡ を長押しすると選択モードになり、チェックを付けた行をまとめて動かせます(別のページへも)。',
      '表のセルを長押しすると、セルの色・行や列の追加と削除のメニューが出ます。',
      '付箋は ≡ を押したまま動かし、右下の角で大きさを変えます。',
      'ボタンを長押しすると、ボタンの名前が出ます(指を離してもボタンは押されません)。',
      '書き終わったら、ツールバーの右端の「キーボードを閉じる」でキーボードを閉じられます。',
    ]
  }
  return [
    `ページは左右の矢印ボタンか、キーボードの ← → でめくります(文字を書いていないとき)。`,
    `行を動かす:マウスを乗せた行の左に ≡ が出ます。≡ をドラッグして動かします。${shortcutText('moveUp')}・${shortcutText('moveDown')} でも1行ずつ動かせます。`,
    '≡ を長押し(押したまま少し待つ)すると選択モードになり、チェックを付けた行をまとめて動かせます(別のページへも)。',
    '表のセルを右クリックすると、セルの色・行や列の追加と削除のメニューが出ます。',
    '付箋は ≡ をドラッグして動かし、右下の角で大きさを変えます。',
    'ボタンにマウスを乗せると、ボタンの名前とショートカットキーが出ます。ショートカットキーの一覧は設定画面にもあります。',
  ]
}

/** ヘルプのボタンの一覧(ヘッダー→ツールバー) */
export function noteHelpSections(mouse: boolean): HelpSection[] {
  return [
    { title: '画面の上', level: 'part', items: Object.entries(HEADER_BUTTONS) },
    {
      title: 'ツールバー',
      level: 'part',
      note: mouse
        ? 'タイトルの下に並んでいるボタンです。全部が入りきらないときは、左右にスクロールするとほかのボタンが出てきます。'
        : '画面の下(キーボードを出しているときはそのすぐ上)に並んでいるボタンです。左右にスクロールすると、ほかのボタンも出てきます。',
      items: [],
    },
    ...TOOLBAR_GROUPS.map(
      (g): HelpSection => ({ title: g.title, level: 'group', items: Object.entries(g.buttons as Record<string, ButtonDef>) }),
    ),
  ]
}

/** ヘッダーのボタン。href があればリンク(本棚へ戻る) */
export function HeaderButton(props: {
  btn: HeaderButtonId
  onClick?: () => void
  href?: string
  expanded?: boolean
}) {
  const def = headerButton(props.btn)
  const glyph = <Glyph glyph={def.glyph} />
  if (props.href) {
    return (
      <a className="icon-btn" href={props.href} {...tipProps(def)}>
        {glyph}
      </a>
    )
  }
  return (
    <button type="button" className="icon-btn" onClick={props.onClick} aria-expanded={props.expanded} {...tipProps(def)}>
      {glyph}
    </button>
  )
}
