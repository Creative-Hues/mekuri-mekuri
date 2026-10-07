import type { IssueKind, Issues } from './model'

/**
 * 読み込んだあとに知らせる「再現できなかったもの」の文。
 * 種類ごとに数をまとめて、1行ずつ出す(並びはこの表の順)
 */
const MESSAGES: Record<IssueKind, (n: number) => string> = {
  italic: (n) => `斜体(${n}か所)は、普通の文字になりました`,
  code: (n) => `コード(${n}か所)は、普通の文字になりました`,
  quote: (n) => `引用(${n}か所)は、普通の段落になりました`,
  deepHeading: (n) => `4段目より下の見出し(${n}か所)は、小見出しになりました`,
  html: (n) => `HTML のタグ(${n}か所)は読み飛ばし、文字だけを残しました`,
  unsafeLink: (n) => `安全のため、開けないリンク(${n}か所)は文字だけにしました`,
  externalImage: (n) => `ファイルの外にある画像(${n}枚)は読み込めないため、「[画像]」と書きました`,
  brokenImage: (n) => `開けなかった画像(${n}枚)は、「[画像]」と書きました`,
  unsupportedImage: (n) => `表示できない形式の画像(${n}枚。EMF・WMF など)は、「[画像]」と書きました`,
  imageInTable: (n) => `表の中の画像(${n}枚)は、表のすぐ後ろに置きました`,
  mergedCell: (n) => `表の中の表(${n}か所)は、外の表のセルの中に段落として並べました`,
  shape: (n) => `図形・テキストボックス・グラフ・数式(${n}か所)は、読み込んでいません`,
  footnote: (n) => `脚注・文末脚注(${n}か所)は、読み込んでいません`,
  comment: (n) => `コメント(${n}か所)は、読み込んでいません`,
  // ここから下は、あるかないかだけを知らせる(数は出さない)
  headerFooter: () => 'ヘッダー・フッターは、読み込んでいません',
  revision: () => '変更履歴は、変更を反映したあとの形で読み込みました',
  layout: () => '文字の大きさ・書体・配置(中央揃えなど)は読み込まず、めくりめくりの書き方にそろえました',
}

/** 知らせる文の一覧(何もなければ空) */
export function issueMessages(issues: Issues): string[] {
  return (Object.keys(MESSAGES) as IssueKind[])
    .filter((k) => (issues.get(k) ?? 0) > 0)
    .map((k) => MESSAGES[k](issues.get(k)!))
}
