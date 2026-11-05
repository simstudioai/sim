import { expect, type Page, test } from '@playwright/test'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required: the live checks use a real seeded member`)
  return value
}

async function signIn(page: Page) {
  await page.goto('/platform/home')
  await page.locator('#email').fill(requireEnv('PLATFORM_LIVE_EMAIL'))
  await page.locator('#password').fill(requireEnv('PLATFORM_LIVE_PASSWORD'))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/platform(?:\/|$)/)
}

async function organizationId(page: Page): Promise<string> {
  const surface = await page.request.get('/api/organizations/surface')
  expect(surface.status()).toBe(200)
  const { organization } = (await surface.json()) as { organization: { id: string } }
  return organization.id
}

test.describe('Home on real data', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await page.goto('/platform/home')
  })

  test('the Email and Calendar widgets each settle in a state the member can act on', async ({
    page,
  }) => {
    for (const title of ['Email', 'Calendar'] as const) {
      const widget = page.getByRole('region', { name: title, exact: true })
      await expect(widget).toBeVisible()
      await expect(widget.getByRole('status', { name: /Loading/i })).toHaveCount(0)
      const noun = title.toLowerCase()
      await expect(
        widget
          .getByText(`Connect your ${noun}`, { exact: true })
          .or(widget.getByText(`Your organization has not turned on ${noun}`, { exact: true }))
          .or(widget.getByText(`Reconnect your ${noun}`, { exact: true }))
          .or(widget.getByText(`Your ${noun} could not load`, { exact: true }))
          .or(
            title === 'Email'
              ? widget.getByRole('region', { name: 'Email messages' })
              : widget.getByRole('region', { name: 'Calendar schedule' })
          )
          .or(widget.getByText('No email yet', { exact: true }))
      ).toBeVisible()
    }
  })

  test('a widget’s connect options are exactly what the organization offers', async ({ page }) => {
    const accounts = await page.request.get(
      `/api/organizations/${await organizationId(page)}/connected-accounts`
    )
    expect(accounts.status()).toBe(200)
    const { credentialGroup, viewerAccounts } = (await accounts.json()) as {
      credentialGroup: { options: { provider: string; status: string }[] } | null
      viewerAccounts?: { providerId: string }[]
    }
    const email = page.getByRole('region', { name: 'Email', exact: true })
    const prompt = email.getByText('Connect your email', { exact: true })
    if (viewerAccounts?.length || !(await prompt.isVisible())) return
    const offered = new Set(credentialGroup?.options.map((option) => option.provider))
    await expect(email.getByRole('button', { name: 'Gmail', exact: true })).toHaveCount(
      offered.has('gmail') ? 1 : 0
    )
    await expect(email.getByRole('button', { name: 'Outlook', exact: true })).toHaveCount(
      offered.has('outlook') ? 1 : 0
    )
  })

  test('a member who cannot read the activity summary gets no chart rather than an empty one', async ({
    page,
  }) => {
    const summary = await page.request.get(
      `/api/organizations/${await organizationId(page)}/usage/activity/summary?preset=7d&timezone=UTC`
    )
    const chart = page.getByRole('region', { name: 'Tasks run', exact: true })
    if (summary.status() === 200) await expect(chart).toBeVisible()
    else await expect(chart).toHaveCount(0)
  })

  test('the widget reads refuse an organization the member does not belong to', async ({
    page,
  }) => {
    for (const widget of ['email', 'calendar?date=2026-11-05&timeZone=UTC']) {
      const response = await page.request.get(
        `/api/organizations/not-the-members-organization/home/${widget}`
      )
      expect(response.status()).toBe(404)
    }
  })

  test('Customize Home hides a widget for the session and Undo restores it', async ({ page }) => {
    await page.getByRole('button', { name: 'Customize Home' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Email' }).click()
    await page.keyboard.press('Escape')
    const email = page.getByRole('region', { name: 'Email', exact: true })
    await expect(email).toHaveCount(0)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(email).toBeVisible()
  })
})
