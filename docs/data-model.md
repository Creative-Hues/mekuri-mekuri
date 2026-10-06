# データ構造(めくりめくり)

ノートのデータはすべて端末内の IndexedDB に保存する。外部サーバーには送らない。

- 現在のスキーマバージョン:**1**(`src/db/db.ts` の `SCHEMA_VERSION`)
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
| createdAt | number | 作成日時 |
| updatedAt | number | 更新日時 |

インデックス:`id`(主キー)、`noteId`、`[noteId+order]`

### meta(アプリの設定・記録)

| key | value | 説明 |
| --- | --- | --- |
| firstLaunchAt | number | 初めて起動した日時 |
| lastBackupAt | number | 最後にバックアップを書き出した日時 |
| backupReminderSnoozedAt | number | バックアップ案内で「あとで」を押した日時 |

## ページ内容(content)で使うノード

TipTap の JSON(`{ type: 'doc', content: [...] }`)。v1 で使うもの:

- ブロック:`paragraph`、`heading`(attrs.level = 1〜3)、`bulletList` / `orderedList` / `listItem`、`taskList` / `taskItem`(attrs.checked)、`toggleHeading`、`toggleTitle`、`hardBreak`
- 文字の装飾(marks):`bold`、`strike`
- `toggleHeading`(トグル見出し):attrs `level`(1〜3)・`open`(開いているか)。中身は `toggleTitle`(見出しの文字)+ ブロック1つ以上

## バックアップファイル

`mekuri-backup-YYYYMMDD-HHMM.json`

```json
{
  "app": "mekuri-mekuri",
  "schemaVersion": 1,
  "appVersion": "0.1.0",
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
