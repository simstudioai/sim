import path from 'node:path'
import { defineConfig } from 'vitest/config'

/** Isolated real-Postgres suite; deliberately does not load app env files or global DB mocks. */
export default defineConfig({
  test: {
    include: ['lib/cleanup/bounded.postgres.integration.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 15_000,
  },
  resolve: { tsconfigPaths: true, alias: { '@': path.resolve(import.meta.dirname, '../..') } },
})
