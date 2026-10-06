import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

// GitHub Pages(Creative-Hues/mekuri-mekuri)で公開する前提のパス
export default defineConfig({
  base: '/mekuri-mekuri/',
  build: {
    // エディタ(TipTap)を含むため大きめ。PWAとして初回にまとめてキャッシュする
    chunkSizeWarningLimit: 1000,
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      // 新しい版は勝手に切り替えず、「更新があります」と案内してから再読み込みする
      registerType: 'prompt',
      manifest: {
        name: 'めくりめくり',
        short_name: 'めくりめくり',
        description: 'シンプルでデザイン性の高いノートアプリ',
        lang: 'ja',
        theme_color: '#f6f1e7',
        background_color: '#f6f1e7',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
      },
    }),
  ],
})
