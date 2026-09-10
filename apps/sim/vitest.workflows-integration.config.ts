import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true, alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  css: { postcss: {} },
  test: {
    environment: 'node',
    include: ['lib/workspaces/__integration__/*.integration.ts'],
    setupFiles: ['vitest.workflows-integration.setup.ts'],
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
