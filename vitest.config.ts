import { defineConfig } from 'vitest/config'
import pkg from './package.json' with { type: 'json' }

// 自動テストの設定(npm test で実行)。公開するアプリには含まれない
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    // ブラウザの代わりに jsdom を使う(TipTap のエディタを動かすため)
    environment: 'jsdom',
    // IndexedDB をテストの中で再現する
    setupFiles: ['fake-indexeddb/auto'],
    include: ['tests/**/*.test.ts'],
  },
})
