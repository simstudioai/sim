import path from 'node:path'
import { defineConfig } from 'vitest/config'

const ROOT = path.resolve(import.meta.dirname, '../..')

export default defineConfig({
  resolve: {
    alias: {
      '@': path.join(ROOT, 'apps/sim'),
    },
  },
  test: {
    environment: 'node',
    include: ['scripts/openapi/**/*.test.ts'],
  },
})
