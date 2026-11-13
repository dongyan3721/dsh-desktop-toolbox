import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('.', import.meta.url))
const uiRoot = resolve(packageRoot, '../../native/YourAllIn1Helper/src-ui')
const require = createRequire(resolve(uiRoot, 'package.json'))
const { defineConfig } = require('vite')
const vue = require('@vitejs/plugin-vue').default

export default defineConfig({
  root: uiRoot,
  publicDir: false,
  plugins: [vue()],
  resolve: {
    alias: [
      {
        find: '../utils/theme',
        replacement: resolve(uiRoot, 'src/embedded-theme.ts'),
      },
    ],
  },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: resolve(packageRoot, '.embedded-build'),
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: resolve(uiRoot, 'src/embedded.ts'),
      formats: ['cjs'],
      fileName: 'dashboard',
    },
    rollupOptions: {
      external: [],
      output: { inlineDynamicImports: true },
    },
  },
})
