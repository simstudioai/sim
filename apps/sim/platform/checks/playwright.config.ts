import path from 'node:path'
import { defineConfig } from '@playwright/test'
import { FIXTURE_PORT, FIXTURE_SERVER_ENV, fixtureServer } from '@/platform/checks/routes'

const appRoot = path.resolve(__dirname, '../..')
const report = process.env.PLATFORM_REPORT_PATH ?? 'test-results/platform/report.json'
const existingOrigin = process.env.PLATFORM_E2E_ORIGIN

/**
 * The design checks against a fixture build of the main app (`fixtureServer`), or the fixture
 * server already running at `PLATFORM_E2E_ORIGIN`.
 */
export default defineConfig({
  testDir: __dirname,
  testMatch: '*.spec.ts',
  testIgnore: ['**/desktop/**', '**/live/**'],
  workers: 1,
  // Several checks walk every theme and width of a page in one test.
  timeout: 60_000,
  reporter: [['list'], ['json', { outputFile: report }]],
  outputDir: path.join(path.dirname(report), 'artifacts'),
  use: { screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: existingOrigin
    ? undefined
    : {
        command: fixtureServer(FIXTURE_PORT),
        cwd: appRoot,
        env: FIXTURE_SERVER_ENV,
        url: `http://127.0.0.1:${FIXTURE_PORT}/api/health`,
      },
})
