import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// **インストーラ専用**のビルド。アプリ本体 (`electron.vite.config.ts`) とは
// 別の Electron アプリで、`resources/payload.7z` を展開して本体を置く。
//
// 出力は `out/installer/` に分ける。本体の `out/{main,preload,renderer}` と
// 混ざると、`electron-builder.json` の `files: ["out/**/*"]` が
// **インストーラを本体の中に同梱してしまう**（本体側は
// `!out/installer/**/*` で明示的に外してある）。
//
// **`@autoinstall/*` は 1 行も読み込まない。** インストーラが本体の
// コードに依存すると、同じものが payload とインストーラの両方に入る。
// 文言もインストーラ自身の辞書 (`installer/shared/labels.ts`) を持つ。

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/installer/main',
      rollupOptions: {
        external: ['electron'],
        input: resolve(import.meta.dirname, 'installer/main/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/installer/preload',
      rollupOptions: {
        external: ['electron'],
        input: resolve(import.meta.dirname, 'installer/preload/index.ts'),
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'installer/renderer'),
    plugins: [react(), tailwindcss()],
    build: {
      // root が installer/renderer なので、相対パスにすると解決先が
      // 直感と食い違う（落とし穴 40）。必ず絶対パスで書く。
      outDir: resolve(import.meta.dirname, 'out/installer/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(import.meta.dirname, 'installer/renderer/index.html'),
      },
    },
    server: { port: 5273, strictPort: false },
  },
})
