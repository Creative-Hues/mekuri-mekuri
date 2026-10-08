import type { DialogApi } from '../components/Dialog'
import { FORMAT_LABELS, type FileFormat } from './exportNote'
import { PDF_IN_APP } from './device'
import type { PdfResult } from './PdfFileView'

/**
 * 書き出しの形式を選ぶダイアログ(ノート画面のメニュー・本棚のまとめての書き出しで共通)。
 * count:書き出すノートの数(2冊以上なら、Word・Markdown・テキストは ZIP 1つ、PDF は1回の印刷にまとめる)
 * inApp:PDF をアプリの中で作る端末か(iPhone・iPad。device.ts)
 */
export async function chooseExportFormat(
  dialog: DialogApi,
  count = 1,
  inApp = PDF_IN_APP,
): Promise<{ format: 'pdf' | FileFormat; pageNumbers: boolean } | null> {
  // PDF のページ番号を入れるか(初めはオン。ダイアログの中のチェックで変える)
  let pageNumbers = true
  const many = count > 1
  const format = await dialog.choose<'pdf' | FileFormat | null>({
    title: many ? `${count}冊のノートを書き出す` : 'ノートを書き出す',
    message: (
      <>
        <p>
          {many ? '選んだノートを' : 'このノートを'}、どの形式で書き出しますか？(ゴミ箱のページは入りません)
        </p>
        <ul className="export-help">
          <li>
            {inApp
              ? 'PDF:見た目をほぼそのまま。PDF のファイルを作って保存します(文字は画像になるため、PDF の中で文字を選んだり検索したりはできません)'
              : 'PDF:見た目をほぼそのまま。印刷画面が開くので「PDFとして保存」を選んでください'}
            {many && '(選んだノートを続けて1つにまとめ、ノートごとに新しい紙から始めます)'}
          </li>
          <li>Word:見出し・装飾・リスト・表(結合・列の幅・配置・見出し)・画像</li>
          <li>Markdown:ほかのノートアプリへ移す用(色は消え、画像は「[画像]」になります)</li>
          <li>テキスト:文字だけ</li>
        </ul>
        {many && <p className="export-note">Word・Markdown・テキストは、ノートごとのファイルを ZIP ファイル1つにまとめます。</p>}
        <label className="export-option">
          <input
            type="checkbox"
            defaultChecked
            onChange={(e) => {
              pageNumbers = e.target.checked
            }}
          />
          PDF にページ番号を入れる(紙の下の中央に「1 / 6」の形で{many && '。ノートごとに 1 から'})
        </label>
        {/* 紙の分け方は A4・倍率100% で決めているので、印刷画面の設定を案内する(アプリの中で作るときは A4 に決まっているので出さない) */}
        {!inApp && (
          <p className="export-note">
            PDF は A4・倍率100%で印刷してください。印刷画面の「ヘッダーとフッター」はオフにしてください。
          </p>
        )}
      </>
    ),
    cancelValue: null,
    buttons: [
      { label: 'キャンセル', value: null, kind: 'plain' },
      { label: FORMAT_LABELS.txt, value: 'txt', kind: 'plain' },
      { label: FORMAT_LABELS.md, value: 'md', kind: 'plain' },
      { label: FORMAT_LABELS.docx, value: 'docx', kind: 'plain' },
      { label: FORMAT_LABELS.pdf, value: 'pdf', kind: 'primary' },
    ],
  })
  return format ? { format, pageNumbers } : null
}

/** アプリの中で PDF を作った結果のお知らせ(iPhone・iPad。保存できたとき・キャンセルしたときは何も出さない) */
export async function showPdfResult(dialog: DialogApi, result: PdfResult) {
  if (result.kind !== 'failed') return
  console.error(result.error)
  await dialog.alert({
    title: 'PDF を作れませんでした',
    message: (
      <p>
        内容が欠けた PDF にならないよう、保存しませんでした。もう一度お試しください。何度も失敗するときは、ノートを1冊ずつ書き出してください。
      </p>
    ),
  })
}

/** その形式で表せなかったもののお知らせ(あるときだけ、1回) */
export async function showExportNotices(dialog: DialogApi, format: FileFormat, notices: string[]) {
  if (notices.length === 0) return
  await dialog.alert({
    title: `${FORMAT_LABELS[format]}に書き出しました`,
    message: (
      <>
        <p>{FORMAT_LABELS[format]}では表せないものがあったため、次のように書き出しました。</p>
        <ul className="export-help">
          {notices.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </>
    ),
  })
}
