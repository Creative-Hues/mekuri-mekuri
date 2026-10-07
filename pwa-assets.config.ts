import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// public/icon.svg から各サイズのアイコンを作る(npm run icons)
// アイコンは背景の青(ICON_BG)が全面に塗られた四角なので、余白も同じ青で塗る(標準の白にしない)
const ICON_BG = '#5bb0e6'

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    // 各サイズの PNG・ファビコン:余白なし(四角いアイコンそのまま)
    transparent: { ...minimal2023Preset.transparent, padding: 0 },
    // Android の丸・角丸に切り抜かれる版:ノートが切れないよう周りに余白を足す
    // (0.3 で絵が 70% の大きさになり、切り抜かれても残る範囲=中心から半径40% に収まる)
    maskable: { ...minimal2023Preset.maskable, padding: 0.3, resizeOptions: { background: ICON_BG } },
    // iPhone:角は端末が丸めるので、余白なしで全面に描く
    apple: { ...minimal2023Preset.apple, padding: 0, resizeOptions: { background: ICON_BG } },
  },
  images: ['public/icon.svg'],
})
