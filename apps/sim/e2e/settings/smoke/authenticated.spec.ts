import { expect, test } from '@playwright/test'

interface StripeRequestLog {
  requests: Array<{
    method: string
    path: string
    unexpected: boolean
  }>
}

test('billing-enabled signup, login, and settings use real Sim boundaries', async ({
  browser,
  page,
  request,
}, testInfo) => {
  test.slow()

  const runId = process.env.E2E_RUN_ID ?? `${Date.now()}`
  const email = `e2e-foundation-${runId}@example.com`
  const password = 'E2eFoundation1!'
  const fakeUrl = requiredEnv('E2E_STRIPE_FAKE_URL')
  const fakeKey = requiredEnv('E2E_STRIPE_FAKE_KEY')
  const adminKey = requiredEnv('E2E_ADMIN_API_KEY')
  const storageStatePath =
    process.env.E2E_STORAGE_STATE_PATH ?? testInfo.outputPath('foundation-auth.json')

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

  await expect
    .poll(async () => {
      const response = await request.get(`${fakeUrl}/__control/requests`, {
        headers: { authorization: `Bearer ${fakeKey}` },
      })
      expect(response.ok()).toBe(true)
      const log = (await response.json()) as StripeRequestLog
      return {
        created: log.requests.some(
          ({ method, path }) => method === 'POST' && path === '/v1/customers'
        ),
        unexpected: log.requests.filter(({ unexpected }) => unexpected).length,
      }
    })
    .toEqual({ created: true, unexpected: 0 })

  const sessionResponse = await page.request.get('/api/auth/get-session')
  expect(sessionResponse.ok()).toBe(true)
  const session = (await sessionResponse.json()) as { user?: { id?: string } }
  const userId = session.user?.id
  expect(userId).toBeTruthy()

  const billingResponse = await request.get(`/api/v1/admin/users/${userId}/billing`, {
    headers: { 'x-admin-key': adminKey },
  })
  expect(billingResponse.ok()).toBe(true)
  const billing = (await billingResponse.json()) as {
    data?: { stripeCustomerId?: string | null }
  }
  expect(billing.data?.stripeCustomerId).toMatch(/^cus_e2e_/)

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
