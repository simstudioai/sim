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
    /**
     * The determinism check serializes all seven published documents twice —
     * roughly 2MB of JSON — so it was running against vitest's 5s default
     * rather than a budget anyone chose. It already sat just under that on
     * staging, and this branch's richer descriptions tip it over.
     */
    testTimeout: 30_000,
  },
})
