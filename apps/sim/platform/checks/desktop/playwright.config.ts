import path from 'node:path'
import { defineConfig } from '@playwright/test'
import { DESKTOP_PORT, fixtureServer } from '../routes'

const appRoot = path.resolve(__dirname, '../../..')
const report =
  process.env.PLATFORM_DESKTOP_REPORT_PATH ?? 'test-results/platform-desktop/report.json'

export default defineConfig({
  testDir: __dirname,
  workers: 1,
  timeout: 120_000,
  reporter: [['list'], ['json', { outputFile: report }]],
  outputDir: path.join(path.dirname(report), 'artifacts'),
  webServer: process.env.PLATFORM_E2E_ORIGIN
    ? undefined
    : {
        command: fixtureServer(DESKTOP_PORT),
        cwd: appRoot,
        env: { SIM_PLATFORM_FIXTURES: '1' },
        // A development server compiles each route on its first request.
        timeout: 300_000,
        url: `http://127.0.0.1:${DESKTOP_PORT}/api/health`,
      },
})
