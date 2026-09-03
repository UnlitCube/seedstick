import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// workspace パッケージ(@autoinstall/*)は TS ソースのまま取り込むので externalize から除外する
const workspacePkgs = ['@autoinstall/shared', '@autoinstall/media']

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePkgs })],
    build: {
      rollupOptions: {
        // worker は昇格プロセスとして単独で起動されるので、別エントリとして出力する
        input: { index: 'src/main/index.ts', worker: 'src/main/worker.ts' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePkgs })],
    build: { rollupOptions: { input: 'src/preload/index.ts' } },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react(), tailwindcss()],
    build: {
      // root が src/renderer なので相対パスの解決先が直感と食い違う。
      // 絶対パスにしないと出力がリポジトリルートの out/ に逃げる。
      outDir: resolve(import.meta.dirname, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: { input: 'src/renderer/index.html' },
    },
  },
})
