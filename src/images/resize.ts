/**
 * 画像を縮小・圧縮する(端末の容量とバックアップファイルの大きさを抑えるため)。
 * 長い辺を最大 1600px にし、写真は JPEG、PNG は(透明な部分を保つため)PNG のまま保存する
 */

export const MAX_SIDE = 1600
const JPEG_QUALITY = 0.85

/** 縮小後の大きさ(小さい画像は拡大しない)。計算だけの関数 */
export function fitSize(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const long = Math.max(width, height)
  if (long <= max || long <= 0) return { width: Math.round(width), height: Math.round(height) }
  const scale = max / long
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** 保存する形式:PNG は PNG のまま、それ以外(写真など)は JPEG */
export const outputType = (mime: string) => (mime === 'image/png' ? 'image/png' : 'image/jpeg')

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('画像を読み込めませんでした'))
    }
    img.src = url
  })
}

/** ファイルを縮小・圧縮する(写真の向きはブラウザが自動で直す) */
export async function resizeImage(
  file: Blob,
): Promise<{ data: ArrayBuffer; mime: string; width: number; height: number }> {
  const img = await loadImage(file)
  const { width, height } = fitSize(img.naturalWidth, img.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('画像を処理できませんでした')
  const mime = outputType(file.type)
  if (mime === 'image/jpeg') {
    // JPEG には透明がないので、透明な部分は白にする
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
  }
  ctx.drawImage(img, 0, 0, width, height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, JPEG_QUALITY))
  if (!blob) throw new Error('画像を処理できませんでした')
  return { data: await blob.arrayBuffer(), mime, width, height }
}
