import path from 'node:path'
import { defineConfig } from '@playwright/test'

const report = process.env.PLATFORM_LIVE_REPORT_PATH ?? 'test-results/platform-live/report.json'

/**
 * Runs against a real main app, Platform zone and database you have already started; it starts no
 * servers. Point `PLATFORM_LIVE_ORIGIN` at the main app, which proxies `/platform`.
 */
export default defineConfig({
  testDir: __dirname,
  testMatch: '*.spec.ts',
  workers: 1,
  reporter: [['list'], ['json', { outputFile: report }]],
  outputDir: path.join(path.dirname(report), 'artifacts'),
  use: {
    baseURL: process.env.PLATFORM_LIVE_ORIGIN ?? 'http://localhost:3000',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
