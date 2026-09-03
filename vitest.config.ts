import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/out/**', '**/dist/**'],
    // 統合テストは 3 GB 級のイメージをメモリ上で扱うので、並列度を抑えないと
    // ワーカーがメモリ不足で落ちる（Windows + Docker Desktop 環境で実測）。
    maxWorkers: 2,
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
})
