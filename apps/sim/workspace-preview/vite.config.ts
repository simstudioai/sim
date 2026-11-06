import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const sim = path.resolve(import.meta.dirname, '..')

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  publicDir: false,
  plugins: [react()],
  resolve: { alias: { '@': sim } },
  css: { postcss: sim },
  build: {
    outDir: path.join(sim, 'platform/dist/workspace-preview'),
    emptyOutDir: true,
    assetsInlineLimit: () => true,
  },
})
