/**
 * 紙を画像にしたとき、中身(文字・画像など)が描かれずに紙の色だけになっていないかを調べる。
 * iPhone の Safari では、まれに画像にした結果が空になることがあるため(PdfFileView.tsx)。
 * 中身があるはずの紙が空なら、描き直す。それでも空なら PDF を保存しない
 */

/** 紙の色との差がこれより大きい点を「何か描かれている点」とみなす(0〜255) */
const DIFF = 32
/** 何か描かれている点が、これより少なければ空とみなす */
const MIN_INKED = 12

/**
 * data:画像の点の色(RGBA の並び。getImageData の data)。
 * 一番多い色を紙の色とみなし、それと違う色の点が少ししかなければ空(true)
 */
export function isBlankImage(data: Uint8ClampedArray, pixelCount = data.length / 4): boolean {
  if (pixelCount === 0) return true
  // 一番多い色(少し丸めて数える)
  const counts = new Map<number, number>()
  let base = 0
  let best = -1
  for (let i = 0; i < pixelCount; i++) {
    const p = i * 4
    const key = ((data[p] >> 3) << 10) | ((data[p + 1] >> 3) << 5) | (data[p + 2] >> 3)
    const c = (counts.get(key) ?? 0) + 1
    counts.set(key, c)
    if (c > best) {
      best = c
      base = p
    }
  }
  const [r, g, b] = [data[base], data[base + 1], data[base + 2]]
  let inked = 0
  for (let i = 0; i < pixelCount; i++) {
    const p = i * 4
    if (Math.max(Math.abs(data[p] - r), Math.abs(data[p + 1] - g), Math.abs(data[p + 2] - b)) > DIFF) {
      if (++inked >= MIN_INKED) return false
    }
  }
  return true
}
