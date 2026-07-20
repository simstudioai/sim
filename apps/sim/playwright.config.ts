import { defineConfig, devices } from '@playwright/test'

if (process.env.E2E_ORCHESTRATED !== '1') {
  throw new Error(
    'Playwright tests must run through `bun run test:e2e` so database, environment, and teardown guards are active'
  )
}

const isCI = process.env.CI === 'true'
const baseURL = process.env.E2E_BASE_URL ?? 'http://e2e.sim.ai:3000'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ...(isCI ? ([['github']] as const) : []),
  ],
  outputDir: 'test-results',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'hosted-billing-chromium-navigation',
      testMatch: [
        '**/foundation/**/*.spec.ts',
        '**/settings/smoke/unauthenticated.spec.ts',
        '**/settings/navigation/**/*.spec.ts',
      ],
      workers: 1,
    },
    {
      name: 'hosted-billing-chromium-workflows',
      testMatch: ['**/settings/smoke/authenticated.spec.ts', '**/settings/workflows/**/*.spec.ts'],
      fullyParallel: false,
      workers: 1,
    },
  ],
})
