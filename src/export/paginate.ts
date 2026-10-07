/**
 * PDF(印刷)で、ノートの1ページを何枚の紙に分けるかを決める。
 *
 * ブラウザに任せて紙を分けると、どこで切れるかが分からず、ページ番号を正しい位置に出せない
 * (iPhone の Safari には、ブラウザのページ番号の設定もない)。そこで、印刷と同じ幅で並べた中身を測り、
 * 「切ってはいけないもの」(文字の行・画像・表の行・付箋など)の途中を避けて、紙1枚分ずつに区切る。
 * 区切った範囲を、それぞれ同じ大きさの紙に1枚ずつ描く(PrintView.tsx)。
 */

/** 切ってはいけないものの上端・下端(中身の上端からの px) */
export interface Atom {
  top: number
  bottom: number
}

/** 紙1枚に描く範囲(中身の上端からの px) */
export interface Slice {
  start: number
  end: number
}

/** 境目がものの「中」にあるとみなす余裕(px)。行と行がくっついているときに、境目で止まらないように */
const EPS = 0.5

/**
 * height:中身全体の高さ、atoms:切ってはいけないもの、pageHeight:紙1枚に描ける高さ。
 * どれも px。返す範囲は、すき間なく続き、それぞれ pageHeight 以下
 */
export function paginate(height: number, atoms: readonly Atom[], pageHeight: number): Slice[] {
  if (!(pageHeight > 0)) throw new Error('紙の高さが正しくありません')
  const total = Math.max(0, height)
  const slices: Slice[] = []
  let start = 0
  while (total - start > pageHeight + EPS) {
    const limit = start + pageHeight
    let cut = limit
    // 境目にかかっているものがあれば、その上端まで境目を上げる(かからなくなるまでくり返す)
    for (;;) {
      const crossing = atoms.filter((a) => a.top < cut - EPS && a.bottom > cut + EPS && a.top >= start - EPS)
      if (crossing.length === 0) break
      cut = Math.min(...crossing.map((a) => a.top))
    }
    // 紙1枚より大きいもの(とても長い表の行・大きな付箋など)は避けられないので、紙の高さで切る
    if (cut <= start + EPS) cut = limit
    slices.push({ start, end: cut })
    start = cut
  }
  slices.push({ start, end: total })
  return slices
}

