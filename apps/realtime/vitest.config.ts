import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    setupFiles: ['./vitest.setup.ts'],
    pool: 'threads',
    testTimeout: 10000,
  },
  resolve: {
    alias: [
      {
        find: '@sim/db',
        replacement: path.resolve(__dirname, '../../packages/db'),
      },
      {
        find: '@sim/logger',
        replacement: path.resolve(__dirname, '../../packages/logger/src'),
      },
      { find: '@', replacement: path.resolve(__dirname, 'src') },
    ],
  },
})
