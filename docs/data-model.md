# データ構造(めくりめくり)

ノートのデータはすべて端末内の IndexedDB に保存する。外部サーバーには送らない。

- 現在のスキーマバージョン:**4**(`src/db/db.ts` の `SCHEMA_VERSION`)
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

### ノートのデザイン(design、v3〜)

すべて**名前**で保存する。実際の色・柄は `src/design/palette.ts`・`src/design/cover.ts` で決める。**名前は追加だけにして、変更・削除はしない。** 知らない名前は表示のときに既定値になる(`normalizeDesign`)。

| 項目 | 値 |
| --- | --- |
| paper | 紙の背景色。`null`(指定なし=アプリのテーマに合わせる)または `white` `ivory` `cream` `pink` `peach` `lemon` `mint` `sky` `lavender` `gray` `navy` `blackboard` `charcoal` |
| border.width | 縁の太さ:`none` `thin` `medium` `thick` |
| border.color | 縁の色:`brown` `beige` `gold` `red` `pink` `orange` `green` `teal` `blue` `navy` `purple` `gray` `black` |
| cover.color | 表紙の色:`slate` `navy` `forest` `wine` `terracotta` `mustard` `sakura` `mint` `sky` `lavender` `cream` `charcoal` |
| cover.pattern | 柄:`plain` `stripe` `border` `dots` `check` `gingham` `grid` `diagonal` `wave` `ichimatsu` `seigaiha` `uroko` |
| cover.layout | 文字の配置:`topLeft` `center` `bottomLeft` `bottomRight` `band` `label` `vertical` `bottomBand` `frame` `spine` |
| cover.font | 書体:`gothicBold` `gothic` `gothicLight` `gothicWide` `minchoBold` `mincho` `minchoWide` `maru` `maruLight` `classic` |

- 既存のノート(v2 まで)は、今までと同じ見た目の `{ paper: null, border: { color: 'brown', width: 'none' }, cover: { pattern: 'plain', color: 'slate', layout: 'topLeft', font: 'gothicBold' } }` にする
- 新しいノートは表紙の色だけランダム

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

## 端末ごとの設定(IndexedDB の外)

| 保存場所 | キー | 値 | 説明 |
| --- | --- | --- | --- |
| localStorage | `mekuri-theme` | `system` `light` `dark` | 画面の明るさ(アプリ 0.4.0〜)。ノートのデータではないのでバックアップには入れない。index.html でも読む |

## ページ内容(content)で使うノード

TipTap の JSON(`{ type: 'doc', content: [...] }`)。v1 で使うもの:

- ブロック:`paragraph`、`heading`(attrs.level = 1〜3)、`bulletList` / `orderedList` / `listItem`、`taskList` / `taskItem`(attrs.checked)、`toggleHeading`、`toggleTitle`、`hardBreak`
- 文字の装飾(marks):`bold`、`strike`、`textColor`、`marker`、`underline`(v2〜。下記)
- `toggleHeading`(トグル見出し):attrs `level`(1〜3)・`open`(開いているか)。中身は `toggleTitle`(見出しの文字)+ ブロック1つ以上

### 表・画像・リンク(アプリ 0.5.0〜)

| ノード / mark | attrs | 説明 |
| --- | --- | --- |
| `table` → `tableRow` → `tableCell` | `tableCell` の `bg`:マーカーと同じ色名、または null | 表。セルの中は段落(`paragraph`)だけ。`colspan`・`rowspan`・`colwidth`・`align` は TipTap の表の標準の項目(このアプリでは変えない) |
| `tableHeader` | `bg` | 見出しセル。このアプリでは作らないが、ほかのアプリから貼り付けた表を読めるように用意している |
| `image` | `imageId`・`width`・`height` | 画像。データは images テーブル |
| `noteLink` | `noteId`・`pageId`(ノート全体なら null) | 別ノート・別ページへのリンク(カード)。ノート名・ページ番号は表示のたびに最新を出す |
| `link`(mark) | `href`・`target`・`rel` | Webリンク。`href` は http(s) か mailto のみ |

- 付箋の中では、表・画像・ノートへのリンクは使わない(Webリンクは使える)

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
  "schemaVersion": 4,
  "appVersion": "0.5.0",
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
