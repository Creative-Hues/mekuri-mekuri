# データ構造(めくりめくり)

ノートのデータはすべて端末内の IndexedDB に保存する。外部サーバーには送らない。

- 現在のスキーマバージョン:**2**(`src/db/db.ts` の `SCHEMA_VERSION`)
- DB名:`mekuri-mekuri`(Dexie で管理)

## テーブル

### notes(ノート)

| 項目 | 型 | 説明 |
| --- | --- | --- |
| id | string | UUID |
| title | string | タイトル(空なら「無題のノート」と表示) |
| order | number | 本棚での並び順。小さいほど先。新しいノートは先頭(今の最小値 − 1) |
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
| createdAt | number | 作成日時 |
| updatedAt | number | 更新日時 |

インデックス:`id`(主キー)、`noteId`、`[noteId+order]`

### 付箋(Sticky、ページの stickies の中身。v2〜)

| 項目 | 型 | 説明 |
| --- | --- | --- |
| id | string | UUID |
| x, y | number | 紙の左上からの位置。どちらも「紙の幅」を1とした割合(端末で紙の幅が違っても位置関係を保つため) |
| w, h | number | 付箋の幅・高さ。同じく「紙の幅」を1とした割合 |
| color | string | 付箋の色名:`yellow` `pink` `orange` `green` `blue` `purple` |
| content | object | TipTap の JSON(付箋の中身。本文と同じ装飾が使える) |
| createdAt / updatedAt | number | 作成・更新日時 |

※ 付箋の画面はフェーズ2後半で作る。前半(アプリ 0.2.0)では、データの入れ物だけ用意している

### meta(アプリの設定・記録)

| key | value | 説明 |
| --- | --- | --- |
| firstLaunchAt | number | 初めて起動した日時 |
| lastBackupAt | number | 最後にバックアップを書き出した日時 |
| backupReminderSnoozedAt | number | バックアップ案内で「あとで」を押した日時 |

## ページ内容(content)で使うノード

TipTap の JSON(`{ type: 'doc', content: [...] }`)。v1 で使うもの:

- ブロック:`paragraph`、`heading`(attrs.level = 1〜3)、`bulletList` / `orderedList` / `listItem`、`taskList` / `taskItem`(attrs.checked)、`toggleHeading`、`toggleTitle`、`hardBreak`
- 文字の装飾(marks):`bold`、`strike`、`textColor`、`marker`、`underline`(v2〜。下記)
- `toggleHeading`(トグル見出し):attrs `level`(1〜3)・`open`(開いているか)。中身は `toggleTitle`(見出しの文字)+ ブロック1つ以上

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
  "schemaVersion": 2,
  "appVersion": "0.2.0",
  "exportedAt": 1759740000000,
  "notes": [ /* notes の行そのまま */ ],
  "pages": [ /* pages の行そのまま */ ]
}
```

- 読み込み時、`schemaVersion` が今より古ければ `src/backup/format.ts` の `migrations` で順に変換する
- 今より新しい版のファイルは読み込まない(アプリの更新を案内)
- 読み込み方法:「置き換える」(今のノートを全部消す・確認あり)/「追加する」(id を振り直して本棚の先頭に追加)

## データ構造を変えるときの決まり

1. 変える前にユーザーに知らせる
2. `SCHEMA_VERSION` を上げ、`src/db/db.ts` に `db.version(新しい番号).stores(...).upgrade(...)` を追加して既存データを新しい形に移す(古い version の定義は消さない)
3. `src/backup/format.ts` の `migrations` に「旧版 → 新版」の変換を追加する
4. このファイルを更新する

## 変更履歴

- v1(アプリ 0.1.0):最初の形
- v2(アプリ 0.2.0):ページに `stickies`(付箋)を追加。既存のページ・v1 のバックアップファイルには空の配列を入れる。本文の装飾に `textColor`・`marker`・`underline` を追加(本文の JSON の形は変わらないので、移し替えは不要)
