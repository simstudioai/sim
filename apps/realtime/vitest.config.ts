import path from 'node:path'
import { defineConfig, mergeConfig } from 'vitest/config'
import sharedConfig from '../../vitest.shared'

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ['**/*.test.{ts,tsx}'],
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
)
