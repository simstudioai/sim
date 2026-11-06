import path from 'node:path'
import { defineConfig } from '@playwright/test'

const report = process.env.PLATFORM_LIVE_REPORT_PATH ?? 'test-results/platform-live/report.json'

/** Each needs its own stack, so each is its own folder and never part of the `zone` run. */
const TOPOLOGIES = ['flag-off', 'zone-down', 'zone-recovered', 'rollout'] as const

/**
 * Runs against a real main app, Platform zone and database you have already started; it starts no
 * servers. Point `PLATFORM_LIVE_ORIGIN` at the main app, which proxies `/org`.
 * `.github/scripts/http-e2e.sh` boots that stack and picks a project:
 *
 * - `zone`: the flag is on and `SIM_PLATFORM_ORIGIN` was set when the main app was built.
 * - `flag-off`: the legacy surface with the flag off, or with no zone at all.
 * - `zone-down`: the flag is on and the zone is gone or answers 5xx to everything.
 * - `zone-recovered`: the flag is on and the zone has just come back.
 * - `rollout`: flags read from AppConfig (`support/appconfig-service.ts`), targeting one organization.
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
    {
      name: 'zone',
      testMatch: '*.spec.ts',
      testIgnore: TOPOLOGIES.map((topology) => `${topology}/**`),
    },
    ...TOPOLOGIES.map((name) => ({ name, testMatch: `${name}/*.spec.ts` })),
  ],
})
