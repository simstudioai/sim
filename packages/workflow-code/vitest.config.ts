import { defineConfig, mergeConfig } from 'vitest/config'
import sharedConfig from '../../vitest.shared'

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.ts'],
      /**
       * The scaling cases (`expectLinearGrowth`) bound a ratio so a slow runner cannot fail them,
       * but near the source caps they take seconds of wall clock, which vitest's 5s default turns
       * back into a wall-clock budget under machine load.
       */
      testTimeout: 30_000,
    },
  })
)
