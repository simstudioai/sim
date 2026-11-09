import path from 'node:path'
import { defineConfig } from '@playwright/test'
import {
  DESKTOP_FIXTURE_READY_TIMEOUT_MS,
  DESKTOP_PORT,
  FIXTURE_SERVER_ENV,
  fixtureServer,
} from '@/platform/checks/routes'

const appRoot = path.resolve(__dirname, '../../..')
const report =
  process.env.PLATFORM_DESKTOP_REPORT_PATH ?? 'test-results/platform-desktop/report.json'

export default defineConfig({
  testDir: __dirname,
  workers: 1,
  // The one spec walks both themes through several routes on a development server, which renders
  // each route's first client navigation on demand, past the default five-second expectation.
  timeout: 360_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['json', { outputFile: report }]],
  outputDir: path.join(path.dirname(report), 'artifacts'),
  globalSetup: path.join(__dirname, 'warm-routes.ts'),
  webServer: process.env.PLATFORM_E2E_ORIGIN
    ? undefined
    : {
        command: fixtureServer(DESKTOP_PORT),
        cwd: appRoot,
        env: FIXTURE_SERVER_ENV,
        timeout: DESKTOP_FIXTURE_READY_TIMEOUT_MS,
        url: `http://127.0.0.1:${DESKTOP_PORT}/api/health`,
      },
})
