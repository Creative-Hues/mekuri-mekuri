# データ構造(めくりめくり)

ノートのデータはすべて端末内の IndexedDB に保存する。外部サーバーには送らない。

- 現在のスキーマバージョン:**6**(`src/db/db.ts` の `SCHEMA_VERSION`)
- DB名:`mekuri-mekuri`(Dexie で管理)

## テーブル

### notes(ノート)

| 項目 | 型 | 説明 |
| --- | --- | --- |
| id | string | UUID |
| title | string | タイトル(空なら「無題のノート」と表示) |
| order | number | 本棚での並び順。小さいほど先。新しいノートは先頭(今の最小値 − 1)。お気に入りの段・通常の段それぞれの中でこの順に並べる |
| favorite | boolean | お気に入り(v3〜)。本棚の上の段に並ぶ |
| deletedAt | number \| null | ゴミ箱に入れた日時(v3〜)。null ならゴミ箱ではない。30日たつと完全に削除 |
| design | object | デザイン(v3〜)。下の「ノートのデザイン」参照 |
| createdAt | number | 作成日時(ミリ秒) |
| updatedAt | number | 更新日時(ミリ秒)。ページの編集でも更新する |

インデックス:`id`(主キー)、`order`

### pages(ページ)

| 項目 | 型 | 説明 |
| --- | --- | --- |
| id | string | UUID |
| noteId | string | 所属するノートの id |
| order | number | ノート内の順番。0, 1, 2… に振り直して保つ |
| content | object | TipTap(ProseMirror)の JSON。下の「ページ内容」参照 |
| stickies | Sticky[] | 付箋(v2〜)。下の「付箋」参照。付箋がなければ空の配列 |
| deletedAt | number \| null | ゴミ箱に入れた日時(v3〜)。null ならゴミ箱ではない。30日たつと完全に削除 |
| deletedIndex | number \| null | ゴミ箱に入れたときの位置(0から。v3〜)。復元するとこの位置へ戻す |
| createdAt | number | 作成日時 |
| updatedAt | number | 更新日時 |

インデックス:`id`(主キー)、`noteId`、`[noteId+order]`

- ゴミ箱のページは並び(order)の振り直しの対象外。読み出すときに deletedAt で除外する
- ノートをゴミ箱に入れても、中のページの deletedAt は変えない(ノートを戻すとページもそのまま戻る)

### 付箋(Sticky、ページの stickies の中身。v2〜)

| 項目 | 型 | 説明 |
| --- | --- | --- |
| id | string | UUID |
| x, y | number | 紙の左上からの位置。どちらも「紙の幅」を1とした割合(端末で紙の幅が違っても位置関係を保つため) |
| w, h | number | 付箋の幅・高さ。同じく「紙の幅」を1とした割合 |
| color | string | 付箋の色名:`yellow` `pink` `orange` `green` `blue` `purple` |
| content | object | TipTap の JSON(付箋の中身。本文と同じ装飾が使える) |
| createdAt / updatedAt | number | 作成・更新日時 |

※ 付箋の画面はアプリ 0.3.0 から。0.2.0 ではデータの入れ物だけ用意していた(0.3.0 でデータの形は変わっていない)

### ノートのデザイン(design、v3〜。v5 で項目を追加)

すべて**名前**で保存する。実際の色・柄は `src/design/palette.ts`・`src/design/cover.ts` で決める。**名前は追加だけにして、変更・削除はしない。** やむを得ず消すときは、必ずデータの移し替え(DB とバックアップファイルの両方)を入れる(v5 で柄を3つ消したときの例を参照)。知らない名前は表示のときに既定値になる(`normalizeDesign`)。

| 項目 | 値 |
| --- | --- |
| paper | 紙の背景色。`null`(指定なし=アプリのテーマに合わせる)または `white` `ivory` `cream` `pink` `peach` `lemon` `mint` `sky` `lavender` `gray` `navy` `blackboard` `charcoal` |
| border.width | 縁の太さ:`none` `thin` `medium` `thick` |
| border.color | 縁の色:`brown` `beige` `gold` `red` `pink` `orange` `green` `teal` `blue` `navy` `purple` `gray` `black` |
| cover.color | 表紙のベース色:`slate` `navy` `forest` `wine` `terracotta` `mustard` `sakura` `mint` `sky` `lavender` `cream` `charcoal` `white`(1.1.0〜) `black`(1.1.0〜)。白・黒の表紙には薄い縁を付ける(背景に溶け込まないように) |
| cover.pattern | 柄:`plain` `stripe` `wideStripe`(v5〜) `border` `dots` `check` `gingham` `grid` `diagonal` `wave`。`ichimatsu` `seigaiha` `uroko` は v5 で削除(無地に移す) |
| cover.subColor | 柄の色(サブ色、v5〜):`auto`(なじむ色。ベース色に合わせた半透明の白/黒。1.0.0 までの柄の色)、または表紙の色の名前(白・黒を含む) |
| cover.patternScale | 柄の大きさ(v5〜):`small`(0.6倍) `medium`(1.0.0 までと同じ) `large`(1.6倍) |
| cover.textColor | タイトルの文字色(v5〜):`auto`(表紙の色に合わせて白か濃い色。1.0.0 までと同じ) `white` `black`。白・黒のときは、ラベル・帯の色も文字に合わせる。柄があるときか文字色を選んだときは、文字に薄い影(白い文字には暗い影、黒い文字には明るい影)を付ける |
| cover.layout | 文字の配置:`topLeft` `center` `topCenter`(1.1.0〜) `bottomLeft` `bottomRight` `band` `label` `vertical` `bottomBand` `frame` `spine` |
| cover.font | 書体:`gothicBold` `gothic` `gothicLight` `gothicWide` `minchoBold` `mincho` `minchoWide` `maru` `maruLight` `classic`。それぞれ種類(ゴシック・明朝・丸ゴシック)を持ち、`classic` は明朝 |
| bodyFont | 本文の書体(v5〜):`cover`(表紙の書体と同じ種類) `gothic` `mincho` `maru`。太さ・字間は本文には使わない。本文と付箋・PDF に使う |

- 既存のノート(v2 まで)は、v3 で今までと同じ見た目の `{ paper: null, border: { color: 'brown', width: 'none' }, cover: { pattern: 'plain', color: 'slate', layout: 'topLeft', font: 'gothicBold' } }`(`legacyDesignV3`)にし、v5 で下の移し替えを通す
- v4 までのノートの v5 への移し替え(`upgradeDesignToV5`。DB とバックアップファイルで同じ関数):
  - `bodyFont` → `cover`(表紙と同じ。表紙が明朝・丸ゴシックのノートは本文の書体が変わる。ユーザーと決めた方針)
  - `cover.subColor` → `auto`(なじむ色。柄の見た目は変わらない)、`cover.patternScale` → `medium`
  - `cover.textColor` → `auto`(タイトルの文字色は今までと同じ)
  - `cover.pattern` が `ichimatsu` `seigaiha` `uroko` → `plain`(無地)
  - すでに項目があれば変えない(何度通しても同じ結果)。更新日時は変えない
- 新しいノートは表紙のベース色だけランダム(白・黒は選ばない)。柄は無地、サブ色は なじむ色、柄の大きさは 中、本文は表紙と同じ

### images(画像、v4〜)

| 項目 | 型 | 説明 |
| --- | --- | --- |
| id | string | UUID。本文の `image` ノードの `imageId` がこれを指す |
| mime | string | `image/jpeg` または `image/png` |
| data | ArrayBuffer | 画像のデータ(iPhone の Safari でも確実に保存できるよう Blob ではなく ArrayBuffer)。長い辺を最大1600pxに縮小し、写真は JPEG(品質0.85)、PNG は PNG のまま |
| width, height | number | 縮小後の大きさ(px) |
| createdAt | number | 保存した日時 |
| unusedSince | number \| null | どこからも使われていないと最初に確認した日時。使われていれば null |

インデックス:`id`(主キー)

- **使われていない画像の片付け**(`src/images/store.ts` の `cleanupImages`。起動時に1回):ページ・付箋・ゴミ箱のページ・ゴミ箱のノートの中のページ、すべてから参照されている画像を集めて判定する
  - 参照されている → `unusedSince` を null に戻す
  - 参照されていない・`unusedSince` が null → 今の日時を記録するだけ(消さない)
  - 参照されていない状態が **30日続いた** → 完全に削除
  - 判定を間違えて使用中の画像を消すと元に戻せないため、すぐには消さない

### meta(アプリの設定・記録)

| key | value | 説明 |
| --- | --- | --- |
| firstLaunchAt | number | 初めて起動した日時 |
| lastBackupAt | number | 最後にバックアップを書き出した日時 |
| backupReminderSnoozedAt | number | バックアップ案内で「あとで」を押した日時 |
| onboardingDoneAt | number | 初回の使い方説明を見終えた日時(アプリ 1.0.0〜)。0.6.0 以前から使っている人は、1.0.0 の初回起動時にその日時を記録する(使い方説明を出さない) |

- meta はバックアップファイルに入れない(端末ごとの記録のため)
- meta にキーを足すだけならテーブル・スキーマ番号は変わらない(マイグレーション不要)

## 端末ごとの設定(IndexedDB の外)

| 保存場所 | キー | 値 | 説明 |
| --- | --- | --- | --- |
| localStorage | `mekuri-theme` | `system` `light` `dark` | 画面の明るさ(アプリ 0.4.0〜)。ノートのデータではないのでバックアップには入れない。index.html でも読む |
| localStorage | `mekuri-text-size` | `xs`(90%) `m`(100%・既定) `l`(115%) `xl`(130%) `xxl`(150%) | 文字サイズ(アプリ 1.1.0〜)。ノートの本文・見出し・表・付箋の文字だけ大きくする(PDF には反映しない)。バックアップには入れない。index.html でも読む。知らない値は `m` |

## ページ内容(content)で使うノード

TipTap の JSON(`{ type: 'doc', content: [...] }`)。v1 で使うもの:

- ブロック:`paragraph`、`heading`(attrs.level = 1〜3)、`bulletList` / `orderedList` / `listItem`、`taskList` / `taskItem`(attrs.checked)、`toggleHeading`、`toggleTitle`、`hardBreak`
- 文字の装飾(marks):`bold`、`strike`、`textColor`、`marker`、`underline`(v2〜。下記)
- `toggleHeading`(トグル見出し):attrs `level`(1〜3)・`open`(開いているか)。中身は `toggleTitle`(見出しの文字)+ ブロック1つ以上

### 表・画像・リンク(アプリ 0.5.0〜)

| ノード / mark | attrs | 説明 |
| --- | --- | --- |
| `table` → `tableRow` → `tableCell` | 下の「表(v6〜)」 | 表。セルの中は段落(`paragraph`)だけ |
| `tableHeader` | `tableCell` と同じ | 見出しセル。**保存しない**(v6〜)。ほかのアプリから貼り付けた表を読むための入口で、貼り付けるときに `tableCell`+表の見出しの設定に変える |
| `image` | `imageId`・`width`・`height` | 画像。データは images テーブル |
| `noteLink` | `noteId`・`pageId`(ノート全体なら null) | 別ノート・別ページへのリンク(カード)。ノート名・ページ番号は表示のたびに最新を出す |
| `link`(mark) | `href`・`target`・`rel` | Webリンク。`href` は http(s) か mailto のみ |

- 付箋の中では、表・画像・ノートへのリンクは使わない(Webリンクは使える)

### 表(v6〜、アプリ 1.3.0〜)

| ノード | 項目 | 値 |
| --- | --- | --- |
| `table` | `headerRow` | 1行目を見出しにする(太字+薄い色)。boolean、既定 false。行を並び替えても「今の1行目」が見出し |
| | `headerColumn` | 1列目を見出しにする。boolean、既定 false |
| `tableCell` | `bg` | セルの背景色。マーカーと同じ色名、または null。見出しの色より優先 |
| | `align` | 文字の配置:`center` `right`、または null(左) |
| | `colspan`・`rowspan` | 結合(何列・何行ぶんか)。既定 1 |
| | `colwidth` | 列の幅(px)の配列(結合したセルは、またぐ列の数だけ)。null なら中身に合わせる。幅を1つ変えると、表のすべての列の今の幅を記録する |

- `colspan`・`rowspan`・`colwidth`・`align` は TipTap(prosemirror-tables)の表の標準の項目。v5 までは使っていなかった(ほかのアプリから貼り付けた表にだけ入ることがあった)
- v5 までの表の v6 への移し替え(`upgradeTablesToV6`、`src/editor/tableMigrate.ts`。DB・バックアップファイル・貼り付けで同じ関数):
  - `tableHeader` → `tableCell`(色などの項目・中身はそのまま)
  - 1行目がすべて `tableHeader` だった表 → `headerRow: true`。2行以上あり、各行の最初のセルがすべて `tableHeader` だった表 → `headerColumn: true`
  - 1行目・1列目以外の `tableHeader` は普通のセルになる(太字ではなくなる)
  - 見出しの設定のない表には `headerRow: false`・`headerColumn: false` を入れる。表のないページは変えない
  - ゴミ箱のページも対象。何度通しても同じ結果。更新日時は変えない

### 色の装飾(アプリ 0.2.0〜)

色はすべて**色名**で保存し、実際の色は `src/styles/base.css` の CSS 変数で決める(ダークモードで色を差し替えられるように)。色名は `src/editor/palette.ts` で管理する。**保存済みのデータが読めなくなるので、色名は追加だけにして、変更・削除はしない。**

| mark | attrs | 値 |
| --- | --- | --- |
| `textColor`(文字色) | color | `gray` `brown` `red` `orange` `yellow` `green` `blue` `purple` |
| `marker`(マーカー) | color | `yellow` `orange` `pink` `red` `green` `blue` `purple` `gray` |
| `underline`(ライン) | style | `solid`(下線)`wavy`(波線)`double`(二重線)`dotted`(点線) |
| | color | 文字色と同じ色名。`null` なら文字と同じ色 |

## バックアップファイル

`mekuri-backup-YYYYMMDD-HHMM.json`

```json
{
  "app": "mekuri-mekuri",
  "schemaVersion": 6,
  "appVersion": "1.3.0",
  "exportedAt": 1759740000000,
  "notes": [ /* notes の行そのまま */ ],
  "pages": [ /* pages の行そのまま */ ],
  "images": [ { "id": "…", "mime": "image/jpeg", "data": "(base64)", "width": 1600, "height": 1200 } ]
}
```

- 画像は base64 にして入れる。`unusedSince` は入れない(読み込んだ端末で、次の起動時に改めて判定する)
- 「追加する」で読み込むときは、画像・ノート・ページの id を振り直し、本文・付箋の中の `imageId`・`noteLink` の参照も新しい id に書き換える(ファイルの外のノートへのリンクはそのまま)
- 「置き換える」では、画像も今のものを消してファイルの画像に置き換える

- 読み込み時、`schemaVersion` が今より古ければ `src/backup/format.ts` の `migrations` で順に変換する
- 今より新しい版のファイルは読み込まない(アプリの更新を案内)
- ゴミ箱のノート・ページもバックアップに含める(ゴミ箱のまま戻る)
- 読み込み方法:「置き換える」(今のノートを全部消す・確認あり)/「追加する」(id を振り直して本棚の先頭に追加)

## データ構造を変えるときの決まり

1. 変える前にユーザーに知らせる
2. `SCHEMA_VERSION` を上げ、`src/db/db.ts` に `db.version(新しい番号).stores(...).upgrade(...)` を追加して既存データを新しい形に移す(古い version の定義は消さない)
3. `src/backup/format.ts` の `migrations` に「旧版 → 新版」の変換を追加する
4. このファイルを更新する

## 変更履歴

- v1(アプリ 0.1.0):最初の形
- v2(アプリ 0.2.0〜0.3.0):ページに `stickies`(付箋)を追加。既存のページ・v1 のバックアップファイルには空の配列を入れる。本文の装飾に `textColor`・`marker`・`underline` を追加(本文の JSON の形は変わらないので、移し替えは不要)
- v3(アプリ 0.4.0〜):ノートに `favorite`・`deletedAt`・`design`、ページに `deletedAt`・`deletedIndex` を追加(ゴミ箱・お気に入り・デザイン)。既存のノートは「お気に入りでない・ゴミ箱でない・今までと同じ見た目」に、v2 以前のバックアップファイルも同じく変換する。インデックスは変わらない
- v4(アプリ 0.5.0〜):`images`(画像)のテーブルを追加し、画像の参照の片付けのために `unusedSince` を持たせた。本文に `table` / `tableRow` / `tableCell` / `tableHeader`・`image`・`noteLink` のノードと `link` の mark を追加。既存のノート・ページは変わらない(移し替えは不要)。v3 以前のバックアップファイルは `images: []` を補って読む
- (アプリ 1.0.0:meta に `onboardingDoneAt` を追加。スキーマ番号は 4 のまま、移し替えは不要)
- (アプリ 1.2.0:ファイル(テキスト・Markdown・Word)の読み込みを追加。読み込んだ内容は今の notes・pages・images の形のまま新しいノートとして作るので、スキーマ番号は 5 のまま、移し替えは不要)
- v5(アプリ 1.1.0〜):ノートの `design` に `bodyFont`(本文の書体)、`design.cover` に `subColor`(サブ色)・`patternScale`(柄の大きさ)・`textColor`(タイトルの文字色)を追加。柄 `ichimatsu` `seigaiha` `uroko` を削除し `wideStripe` を追加。既存のノート・v4 以前のバックアップファイルは「本文は表紙と同じ・なじむ色・中・タイトルの文字色は自動・削除した柄は無地」に移す。インデックスは変わらない
- v6(アプリ 1.3.0〜):表の見出しを、見出しセル(`tableHeader`)から表の設定 `headerRow`・`headerColumn` に移した。セルの `colspan`・`rowspan`(結合)・`colwidth`(列の幅)・`align`(文字の配置)を使い始めた。既存のページ(ゴミ箱のページも)・v5 以前のバックアップファイルの表は、上の「表(v6〜)」の移し替えを通す。インデックスは変わらない
