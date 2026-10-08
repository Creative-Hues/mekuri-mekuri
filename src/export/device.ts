/**
 * PDF の作り方を端末で分ける。
 * iPhone・iPad の Safari は、印刷の紙の大きさ・余白をアプリから決められず、ヘッダーとフッターも消せない。
 * 紙の高さが足りないと、アプリの紙1枚が2枚に割れ、続きの文章が描かれずに消えることがある。
 * そのため iPhone・iPad では、印刷画面を使わずアプリの中で PDF のファイルを作る(PdfFileView.tsx)
 */

/** iPhone・iPad か(iPadOS は「Mac」と名乗るので、指で触れる画面かどうかでも判定する) */
export function isAppleMobile(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1
}

/** この端末では、PDF をアプリの中で作るか(false なら今までどおり印刷画面を使う) */
export const PDF_IN_APP = typeof navigator !== 'undefined' && isAppleMobile(navigator.userAgent, navigator.maxTouchPoints ?? 0)
