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
    // ファイルの最初のテストは、エディタや Word の読み込みなど大きな部分をその場で初めて読み込む。
    // ふだんは 0.2 秒ほどだが、混んだ PC や GitHub の公開の処理では、既定の5秒を超えて失敗することがあるため延ばす
    // (本当に止まってしまうテストは、これでも失敗として分かる)
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
