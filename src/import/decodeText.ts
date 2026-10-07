/**
 * テキストファイル(.txt・.md)の文字コードを判定して、文字にする。
 * UTF-8(BOM 付きも)・UTF-16(BOM 付き)を読み、UTF-8 として読めないものは Shift_JIS として読む
 * (古い Windows のメモ帳などで保存したファイル)。改行は「\n」にそろえる
 */
export function decodeText(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data)
  let text: string
  if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le').decode(bytes.subarray(2))
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be').decode(bytes.subarray(2))
  else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      text = new TextDecoder('shift_jis').decode(bytes)
    }
  }
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
}
