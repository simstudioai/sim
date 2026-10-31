import { resolve } from 'node:path'
import { defineConfig, mergeConfig } from 'vitest/config'
import sharedConfig from '../../vitest.shared'

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      setupFiles: ['src/test/setup.ts'],
      include: ['src/**/*.test.ts'],
      // These suites drive subsystems Windows builds do not ship (tmux, the macOS computer-use
      // helper, the Chromium profile readers behind browser import); see
      // src/shared/platform-features.ts.
      exclude: [
        '**/e2e/**',
        ...(process.platform === 'win32'
          ? [
              'src/main/terminal/tmux.test.ts',
              'src/main/computer-use/native-client.test.ts',
              'src/main/browser-import/chromium-*.test.ts',
            ]
          : []),
      ],
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
