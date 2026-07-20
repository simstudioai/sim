import { defineConfig, devices } from '@playwright/test'

const isCI = process.env.CI === 'true'
const baseURL = process.env.E2E_BASE_URL ?? 'http://e2e.sim.ai:3000'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
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
      workers: isCI ? 2 : 1,
    },
    {
      name: 'hosted-billing-chromium-workflows',
      testMatch: ['**/settings/smoke/authenticated.spec.ts', '**/settings/workflows/**/*.spec.ts'],
      fullyParallel: false,
      workers: 1,
    },
  ],
})
