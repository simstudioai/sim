import path from 'node:path'
import { defineConfig, mergeConfig } from 'vitest/config'
import sharedConfig from '../../vitest.shared'

export default defineConfig(({ mode }) =>
  mergeConfig(
    sharedConfig,
    defineConfig({
      test: {
        include: mode === 'integration' ? ['src/**/*.integration.ts'] : ['**/*.test.{ts,tsx}'],
        setupFiles: [
          mode === 'integration' ? './vitest.integration.setup.ts' : './vitest.setup.ts',
        ],
        pool: 'threads',
        testTimeout: mode === 'integration' ? 30000 : 10000,
        ...(mode === 'integration'
          ? {
              fileParallelism: false,
              reporters: ['default', 'json'],
              outputFile: {
                json: process.env.INTEGRATION_REPORT_PATH ?? 'test-results/integration.json',
              },
            }
          : {}),
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
)
