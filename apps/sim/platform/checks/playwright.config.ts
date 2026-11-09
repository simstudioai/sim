import path from 'node:path'
import { defineConfig } from '@playwright/test'
import { FIXTURE_PORT, productionServer } from './routes'

const appRoot = path.resolve(__dirname, '../..')
const report = process.env.PLATFORM_REPORT_PATH ?? 'test-results/platform/report.json'
const existingOrigin = process.env.PLATFORM_E2E_ORIGIN

export default defineConfig({
  testDir: __dirname,
  testMatch: '*.spec.ts',
  testIgnore: ['**/desktop/**', '**/live/**'],
  workers: 1,
  timeout: existingOrigin ? 60_000 : 30_000,
  expect: { timeout: existingOrigin ? 10_000 : 5_000 },
  reporter: [['list'], ['json', { outputFile: report }]],
  outputDir: path.join(path.dirname(report), 'artifacts'),
  use: { screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: existingOrigin
    ? undefined
    : {
        command: productionServer(FIXTURE_PORT),
        cwd: appRoot,
        env: { SIM_PLATFORM_FIXTURES: '1' },
        url: `http://127.0.0.1:${FIXTURE_PORT}/api/health`,
      },
})
