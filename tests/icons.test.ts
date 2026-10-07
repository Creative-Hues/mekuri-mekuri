import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Icon } from '../src/components/Icon'

// アイコンの形

const pathOf = (name: Parameters<typeof Icon>[0]['name']) =>
  /<path d="([^"]+)"/.exec(renderToStaticMarkup(createElement(Icon, { name })))![1]

describe('設定(歯車)のアイコン', () => {
  it('歯がつながった1つの輪郭と、真ん中の穴でできている(線が離れた太陽の形ではない)', () => {
    const d = pathOf('settings')
    // 輪郭と穴の2つの閉じた形だけ
    expect(d.match(/M/g)).toHaveLength(2)
    expect(d.match(/Z/g)).toHaveLength(2)
    // 輪郭は8枚の歯(1枚につき4つの角)の折れ線
    const outline = d.split('Z')[0]
    expect(outline.match(/L/g)).toHaveLength(8 * 4 - 1)
  })
})
