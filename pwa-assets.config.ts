import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// public/icon.svg から各サイズのアイコンを作る(npm run icons)
export default defineConfig({
  preset: minimal2023Preset,
  images: ['public/icon.svg'],
})
