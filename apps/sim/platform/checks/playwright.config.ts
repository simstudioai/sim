import path from 'node:path'
import { defineConfig } from '@playwright/test'

const appRoot = path.resolve(__dirname, '../..')
const report = process.env.PLATFORM_REPORT_PATH ?? 'test-results/platform/report.json'

export default defineConfig({
  testDir: __dirname,
  testMatch: '*.spec.ts',
  workers: 1,
  reporter: [['list'], ['json', { outputFile: report }]],
  outputDir: path.join(path.dirname(report), 'artifacts'),
  use: { screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: [0, 1].map((flag) => ({
    command: `bunx --no-install next start platform -H 127.0.0.1 -p ${3180 + flag}`,
    cwd: appRoot,
    env: { SIM_PLATFORM_FIXTURES: String(flag) },
    url: `http://127.0.0.1:${3180 + flag}`,
  })),
})
