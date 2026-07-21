import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

test('billing-enabled signup, login, and settings use real Sim boundaries', async ({
  browser,
  page,
}, testInfo) => {
  test.slow()

  const runId = process.env.E2E_RUN_ID ?? `${Date.now()}`
  const testIdentity = createHash('sha256')
    .update(`${runId}:${testInfo.project.name}:${testInfo.workerIndex}:${testInfo.repeatEachIndex}`)
    .digest('hex')
    .slice(0, 16)
  const email = `e2e-foundation-${runId}-${testIdentity}@example.com`
  const password = 'E2eFoundation1!'
  const storageStatePath = path.join(requiredEnv('E2E_STORAGE_STATE_DIR'), `${testIdentity}.json`)

  await page.goto('/signup')
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible()
  await page.getByLabel('Full name').fill('Playwright Foundation')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('textbox', { name: 'Password' }).fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page).toHaveURL(/\/workspace\/[^/]+\/(?:home|w(?:\/|$))/, {
    timeout: 60_000,
  })
  const workspaceId = new URL(page.url()).pathname.split('/')[2]
  expect(workspaceId).toBeTruthy()

  const settingsPath = `/workspace/${workspaceId}/settings/general`
  await page.goto(settingsPath)
  await assertGeneralSettings(page)

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login\?fromLogout=true$/)

  await page.getByLabel('Email').fill(email)
  await page.getByRole('textbox', { name: 'Password' }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/workspace(?:\/|$)/)

  await page.context().storageState({ path: storageStatePath })
  const restoredContext = await browser.newContext({ storageState: storageStatePath })
  try {
    const restoredPage = await restoredContext.newPage()
    await restoredPage.goto(`${requiredEnv('E2E_BASE_URL')}${settingsPath}`)
    await assertGeneralSettings(restoredPage)
  } finally {
    await restoredContext.close()
  }
  writeFileSync(
    path.join(requiredEnv('E2E_MARKER_DIR'), `foundation-authenticated-${testIdentity}.json`),
    JSON.stringify({ runId, testIdentity })
  )
})

async function assertGeneralSettings(page: import('@playwright/test').Page): Promise<void> {
  await expect(page).toHaveURL(/\/settings\/general$/)
  await expect(page.getByRole('heading', { name: 'General', level: 1 })).toBeVisible()
  await expect(
    page.getByText('Manage your profile, appearance, and preferences.', { exact: true })
  ).toBeVisible()
  await expect(page.getByText('Profile', { exact: true })).toBeVisible()
}

function requiredEnv(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`Missing required Playwright environment value: ${key}`)
  return value
}
