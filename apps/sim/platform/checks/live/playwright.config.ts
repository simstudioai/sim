import path from 'node:path'
import { defineConfig } from '@playwright/test'

const report = process.env.PLATFORM_LIVE_REPORT_PATH ?? 'test-results/platform-live/report.json'

/**
 * Runs against a real main app and database you have already started; it starts no servers. Point
 * `PLATFORM_LIVE_ORIGIN` at the main app, `PLATFORM_LIVE_DATABASE_URL` at its (test) database, and
 * `PLATFORM_LIVE_AUTH_SECRET` at its `BETTER_AUTH_SECRET`: checks seed their own sessions and rows
 * there. `.github/scripts/http-e2e.sh` boots that stack and picks a project:
 *
 * - `product`: hosted Enterprise, every spec in this folder.
 * - `self-hosted`: not on a Sim hostname, billing and Enterprise off.
 */
export default defineConfig({
  testDir: __dirname,
  workers: 1,
  timeout: 90_000,
  reporter: [['list'], ['json', { outputFile: report }]],
  outputDir: path.join(path.dirname(report), 'artifacts'),
  use: {
    baseURL: process.env.PLATFORM_LIVE_ORIGIN ?? 'http://localhost:3000',
    actionTimeout: 20_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'product', testMatch: '*.spec.ts', testIgnore: 'self-hosted/**' },
    { name: 'self-hosted', testMatch: 'self-hosted/*.spec.ts' },
  ],
})
