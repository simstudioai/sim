import { expect, type Page, test } from '@playwright/test'
import { organizationId, signInAsAdmin } from '@/platform/checks/live/session'

/** A seeded admin of an Enterprise organization, or a self-hosted deployment with these features on. */
function signIn(page: Page, section: string) {
  return signInAsAdmin(page, `/platform/settings/${section}`)
}

test.describe('governance settings', () => {
  test('audit logs fail closed on a workspace that is not the organization’s', async ({ page }) => {
    await signIn(page, 'audit-logs')
    const orgWideRead = page.waitForRequest(
      (request) =>
        request.url().includes('/api/audit-logs?') && !request.url().includes('workspaceId')
    )
    await page.goto('/platform/settings/audit-logs')
    await orgWideRead

    const reads: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/audit-logs')) reads.push(request.url())
    })
    await page.goto('/platform/settings/audit-logs?workspace=not-a-real-workspace')
    await expect(page.getByText('That workspace is not part of this organization.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export' })).toBeDisabled()
    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled()
    expect(reads).toEqual([])

    await page.getByRole('button', { name: 'Workspace: not found' }).click()
    await expect(page).not.toHaveURL(/workspace=/)
  })

  test('the permission editor reads the whole allowlist universe from its catalog', async ({
    page,
  }) => {
    await signIn(page, 'access-control')
    const name = `Live check ${Date.now()}`
    await page.getByRole('button', { name: 'Create group' }).click()
    const dialog = page.getByRole('dialog', { name: 'Create permission group' })
    await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled()
    await dialog.getByRole('textbox', { name: 'Name' }).fill(name)
    await dialog.getByText('Make this the organization default group').click()
    await dialog.getByText('Make this the organization default group').click()
    await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    const response = await page.request.get(
      `/api/organizations/${organizationId()}/permission-groups/editor-catalog`
    )
    expect(response.status()).toBe(200)
    const catalog = (await response.json()) as {
      blocks: { type: string; hidden: boolean }[]
      providers: { id: string }[]
    }
    expect(catalog.blocks.length).toBeGreaterThan(0)
    expect(catalog.providers.length).toBeGreaterThan(0)
    const types = catalog.blocks.map((block) => block.type)
    expect(types).not.toContain('start_trigger')
    expect(types).not.toContain('slack')
  })

  test('the catalog refuses a non-admin session', async ({ playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL })
    const response = await anonymous.get(
      `/api/organizations/${organizationId()}/permission-groups/editor-catalog`
    )
    expect(response.status()).toBe(401)
    await anonymous.dispose()
  })

  test('single sign-on never receives a stored client secret', async ({ page }) => {
    await signIn(page, 'sso')
    const bodies: string[] = []
    page.on('response', async (response) => {
      if (response.url().includes('/api/auth/sso/providers')) bodies.push(await response.text())
    })
    await page.goto('/platform/settings/sso')
    await expect(page.getByRole('radio', { name: 'Domains' })).toBeAttached()
    for (const body of bodies) {
      expect(body).not.toMatch(/"clientSecret":"(?!\[REDACTED\])/)
    }
    await expect(page.getByRole('button', { name: /Copy Client secret/ })).toHaveCount(0)
  })

  test('security validates session bounds before writing', async ({ page }) => {
    await signIn(page, 'security')
    const field = page.getByRole('textbox', { name: 'Idle timeout (hours)' })
    await field.fill('0')
    const writes: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'PUT' && request.url().includes('session-policy')) {
        writes.push(request.url())
      }
    })
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText(/Idle timeout must be a whole number/)).toBeVisible()
    expect(writes).toEqual([])
    await page.getByRole('button', { name: 'Discard' }).click()
    await page.getByRole('button', { name: 'Sign out all members' }).click()
    await expect(page.getByRole('dialog', { name: 'Sign out all members' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
  })

  test('data retention keeps its bounds and validates custom patterns', async ({ page }) => {
    await signIn(page, 'data-retention')
    await page.getByRole('button', { name: /^Organization/ }).click()
    await expect(page.getByRole('heading', { name: 'Organization defaults' })).toBeVisible()
    await page.getByRole('button', { name: 'Add pattern' }).click()
    await page.getByRole('textbox', { name: 'Pattern (regex)' }).fill('(')
    await expect(page.getByText(/Invalid regex/)).toBeVisible()
    await page.getByRole('button', { name: 'Data retention' }).click()
    await expect(page.getByRole('dialog', { name: 'Discard changes?' })).toBeVisible()
  })

  test('a data drain withholds Create until its destination is complete', async ({ page }) => {
    await signIn(page, 'data-drains')
    await page.getByRole('button', { name: 'Create drain' }).click()
    await page.getByRole('textbox', { name: 'Name' }).fill('Live check')
    await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeDisabled()
    await expect(page.getByRole('textbox', { name: 'Secret access key' })).toHaveAttribute(
      'type',
      'password'
    )
  })
})
