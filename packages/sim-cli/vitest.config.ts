import { defineConfig, mergeConfig } from 'vitest/config'
import sharedConfig from '../../vitest.shared'

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.ts'],
      /**
       * The CLI writes GitHub Actions annotations and step summaries when these are set, as they
       * are on a CI runner: every test starts outside a job, and one that needs a job stubs them.
       */
      env: { GITHUB_ACTIONS: '', GITHUB_STEP_SUMMARY: '', GITHUB_WORKSPACE: '' },
    },
  })
)
