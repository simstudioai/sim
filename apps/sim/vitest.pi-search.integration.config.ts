import path from 'path'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['**/*.pi-search.integration.test.ts'],
    setupFiles: ['./vitest.pi-search.integration.setup.ts'],
    fileParallelism: false,
    maxConcurrency: 1,
    testTimeout: 30_000,
  },
  resolve: {
    alias: [
      { find: '@sim/db', replacement: path.resolve(__dirname, '../../packages/db') },
      { find: '@sim/logger', replacement: path.resolve(__dirname, '../../packages/logger/src') },
      {
        find: '@sim/security',
        replacement: path.resolve(__dirname, '../../packages/security/src'),
      },
      { find: '@sim/utils', replacement: path.resolve(__dirname, '../../packages/utils/src') },
      { find: '@', replacement: path.resolve(__dirname) },
    ],
  },
})
