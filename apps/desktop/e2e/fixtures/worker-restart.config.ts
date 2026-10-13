import { defineConfig } from '@playwright/test'

/** Runs only the worker-restart fixture, for `check-report.spec.ts`. */
export default defineConfig({
  testDir: '.',
  testMatch: 'worker-restart.ts',
  workers: 1,
  retries: 0,
  reporter: [['line']],
})
