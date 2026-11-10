import { expect, type Page } from '@playwright/test'
import { generateId } from '@sim/utils/id'
import {
  adminEmail,
  memberEmail,
  organizationId,
  seedSession,
  signInAsAdmin,
} from '@/platform/checks/live/session'
import { withLiveDatabase } from '@/platform/checks/live/support/database'
import { liveRoute } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

/** A seeded admin of an Enterprise organization, or a self-hosted deployment with these features on. */
function openSection(page: Page, section: string) {
  return signInAsAdmin(page, liveRoute(`/settings/${section}`))
}

test.describe('governance settings', () => {
  test('audit logs fail closed on a workspace that is not the organization’s', async ({ page }) => {
    const orgWideRead = page.waitForResponse(
      (response) =>
        response.url().includes('/api/audit-logs?') && !response.url().includes('workspaceId')
    )
    await openSection(page, 'audit-logs')
    await orgWideRead
    // The section reads once it hydrates, after `load`, and a page keeps running until the next
    // navigation commits: its feed answers first, or its read is counted against the scoped page.
    await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled()

    const reads: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/audit-logs')) reads.push(request.url())
    })
    await page.goto(liveRoute('/settings/audit-logs?workspace=not-a-real-workspace'))
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
    await openSection(page, 'access-control')
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

  test('the catalog refuses a signed-out request and a non-admin member', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const catalog = `/api/organizations/${organizationId()}/permission-groups/editor-catalog`
    const anonymous = await playwright.request.newContext({ baseURL })
    expect((await anonymous.get(catalog)).status()).toBe(401)
    await anonymous.dispose()

    const member = await seedSession(memberEmail())
    await page.context().clearCookies({ name: /^better-auth\./ })
    await page.context().addCookies([member.cookie])
    expect((await page.request.get(catalog)).status()).toBe(403)
  })

  test('single sign-on never receives a stored client secret', async ({ page }) => {
    const providerId = `platform-live-sso-${generateId()}`
    const clientSecret = `platform-live-secret-${generateId()}`
    await withLiveDatabase(async (sql) => {
      await sql`insert into sso_provider (id, issuer, domain, oidc_config, user_id, provider_id, organization_id)
        values (${providerId}, 'https://idp.platform-live.test', 'platform-live.test',
          ${JSON.stringify({ issuer: 'https://idp.platform-live.test', clientId: 'platform-live-client', clientSecret })},
          (select id from "user" where email = ${adminEmail()}), ${providerId}, ${organizationId()})`
    })
    try {
      // Signed in elsewhere first, so the body read here cannot belong to a page that navigated away.
      await openSection(page, 'general')
      const providers = page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          response.url().includes('/api/auth/sso/providers')
      )
      await page.goto(liveRoute('/settings/sso'))
      await expect(page.getByRole('radio', { name: 'Domains' })).toBeAttached()
      const body = await (await providers).text()
      expect(body).not.toContain(clientSecret)
      const listed = (
        JSON.parse(body) as { providers: { providerId: string; oidcConfig: string | null }[] }
      ).providers.find((provider) => provider.providerId === providerId)
      expect(listed?.oidcConfig, 'the seeded provider was not listed').toBeTruthy()
      expect(JSON.parse(listed?.oidcConfig ?? '{}').clientSecret).toBe('[REDACTED]')
      await expect(page.getByRole('button', { name: /Copy Client secret/ })).toHaveCount(0)
    } finally {
      await withLiveDatabase(
        (sql) => sql`delete from sso_provider where provider_id = ${providerId}`
      )
    }
  })

  test('security validates session bounds before writing', async ({ page }) => {
    await openSection(page, 'security')
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
    await openSection(page, 'data-retention')
    await page.getByRole('button', { name: /^Organization/ }).click()
    await expect(page.getByRole('heading', { name: 'Organization defaults' })).toBeVisible()
    await page.getByRole('button', { name: 'Add pattern' }).click()
    await page.getByRole('textbox', { name: 'Pattern (regex)' }).fill('(')
    await expect(page.getByText(/Invalid regex/)).toBeVisible()
    await page.getByRole('button', { name: 'Data retention' }).click()
    await expect(page.getByRole('dialog', { name: 'Unsaved changes' })).toBeVisible()
  })

  test('a data drain withholds Create until its destination is complete', async ({ page }) => {
    await openSection(page, 'data-drains')
    await page.getByRole('button', { name: 'Create drain' }).click()
    await page.getByRole('textbox', { name: 'Name' }).fill('Live check')
    await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeDisabled()
    await expect(page.getByRole('textbox', { name: 'Secret access key' })).toHaveAttribute(
      'type',
      'password'
    )
  })
})
