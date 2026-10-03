import { resolve } from 'node:path'
import { defineConfig, mergeConfig } from 'vitest/config'
import sharedConfig from '../../vitest.shared'

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      setupFiles: ['src/test/setup.ts'],
      include: ['src/**/*.test.ts'],
      exclude: ['**/e2e/**'],
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
)
