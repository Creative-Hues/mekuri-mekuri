/** ファイルを端末に保存する(ダウンロード)。バックアップと出力で共通 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // すぐに消すと保存が始まらない端末があるため、少し待ってから消す
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
