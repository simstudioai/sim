import path from 'node:path'
import { defineConfig } from '@playwright/test'

const appRoot = path.resolve(__dirname, '../../..')
const report =
  process.env.PLATFORM_DESKTOP_REPORT_PATH ?? 'test-results/platform-desktop/report.json'

export default defineConfig({
  testDir: __dirname,
  workers: 1,
  timeout: process.env.PLATFORM_E2E_ORIGIN ? 120_000 : 60_000,
  reporter: [['list'], ['json', { outputFile: report }]],
  outputDir: path.join(path.dirname(report), 'artifacts'),
  webServer: process.env.PLATFORM_E2E_ORIGIN
    ? undefined
    : {
        command: 'bunx --no-install next start platform -H 127.0.0.1 -p 3182',
        cwd: appRoot,
        env: { SIM_PLATFORM_FIXTURES: '1' },
        url: 'http://127.0.0.1:3182/home',
      },
})
