import path from 'node:path'
import { defineConfig } from '@playwright/test'
import {
  FIXTURE_PORT,
  FIXTURE_READY_TIMEOUT_MS,
  FIXTURE_SERVER_ENV,
  fixtureServer,
} from '@/platform/checks/routes'

const appRoot = path.resolve(__dirname, '../..')
const report = process.env.PLATFORM_REPORT_PATH ?? 'test-results/platform/report.json'
const existingOrigin = process.env.PLATFORM_E2E_ORIGIN

export default defineConfig({
  testDir: __dirname,
  testMatch: '*.spec.ts',
  testIgnore: ['**/desktop/**', '**/live/**'],
  workers: 1,
  // A development server compiles each route on its first visit.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: report }]],
  outputDir: path.join(path.dirname(report), 'artifacts'),
  use: { screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: existingOrigin
    ? undefined
    : {
        command: fixtureServer(FIXTURE_PORT),
        cwd: appRoot,
        env: FIXTURE_SERVER_ENV,
        timeout: FIXTURE_READY_TIMEOUT_MS,
        url: `http://127.0.0.1:${FIXTURE_PORT}/api/health`,
      },
})
