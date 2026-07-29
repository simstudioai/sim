import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
    pool: 'threads',
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@sim/logger': resolve(__dirname, '../../packages/logger/src'),
      '@sim/security': resolve(__dirname, '../../packages/security/src'),
      '@sim/utils': resolve(__dirname, '../../packages/utils/src'),
      '@': resolve(__dirname, 'src'),
    },
  },
})
