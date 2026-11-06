import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { CONNECTED, GRANTS, MEMBER, ORGANIZATION_ID } from '@/scripts/org-redesign-e2e/fixture'
import {
  artifactDirectory,
  check,
  DESKTOP,
  expect,
  notProvable,
  orgUrl,
  PHONE,
  refused,
  root,
  section,
  sql,
  url,
  withRestore,
  withSession,
  withTableHidden,
} from '@/scripts/org-redesign-e2e/harness'
import { dialog, menuEntry } from '@/scripts/org-redesign-e2e/locators'

export async function integrationChecks() {
  section('3 Integrations')
  await check('title, search, and every approved provider, with no Microsoft row', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/integrations'))
      await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toBeVisible()
      for (const name of [
        'Gmail',
        'Google Calendar',
        'Google Drive',
        'Jira',
        'Confluence',
        'GitLab',
        'Slack',
        'Coda',
        'Lucid',
      ])
        await expect(page.getByRole('link', { name: new RegExp(`^${name}`) }).first()).toBeVisible()
      await expect(page.getByRole('link', { name: /^Outlook/ })).toHaveCount(0)
      await expect(page.getByRole('region', { name: 'Your accounts' })).toHaveCount(0)
      await expect(
        page
          .getByRole('region', { name: 'Available to connect' })
          .getByRole('link', { name: /^Gmail/ })
      ).toContainText('Not connected')
      await expect(
        page
          .getByRole('region', { name: 'Managed by your organization' })
          .getByRole('link', { name: /^GitLab/ })
      ).toContainText('Organization managed')
    })
  })
  await check(
    'search filters by name and is kept in the URL through a detail and back',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl('/integrations'))
        const field = page.getByRole('searchbox', { name: 'Search integrations' })
        await field.fill('jira')
        await expect(page).toHaveURL((address) => address.searchParams.get('q') === 'jira')
        const jira = page.getByRole('link', { name: /^Jira/ })
        await expect(jira).toBeVisible()
        await expect(page.getByRole('link', { name: /^Gmail/ })).toHaveCount(0)
        await jira.click()
        await expect(page).toHaveURL((address) => address.pathname === `${root}/integrations/jira`)
        await page
          .getByRole('navigation', { name: 'Integration navigation' })
          .getByRole('link')
          .click()
        await expect(page).toHaveURL(
          (address) =>
            address.pathname === `${root}/integrations` && address.searchParams.get('q') === 'jira'
        )
        await field.fill('zzzz-nothing')
        await expect(page.getByText('No matching integrations')).toBeVisible()
      })
    }
  )
  await check(
    'the document carries referrer no-referrer, which protects the Slack token',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        for (const path of ['/integrations', '/integrations/gmail']) {
          await page.goto(orgUrl(`${path}`))
          await expect(page.locator('meta[name="referrer"]')).toHaveAttribute(
            'content',
            'no-referrer'
          )
        }
      })
    }
  )
  await check('legacy ?integration= links reach the detail with their account', async () => {
    await withSession(CONNECTED, async ({ page }) => {
      await page.goto(orgUrl('/integrations?integration=source:gmail&q=g'))
      await expect(page).toHaveURL(
        (address) =>
          address.pathname === `${root}/integrations/gmail` && address.searchParams.get('q') === 'g'
      )
      await expect(page.getByRole('heading', { level: 1, name: 'Gmail' })).toBeVisible()
    })
  })
  await check(
    'detail: Connect starts managed authorization; a managed provider has no button',
    async () => {
      await withSession(MEMBER, async ({ page, context }) => {
        await context.route('https://accounts.google.com/**', (route) =>
          route.fulfill({ status: 200, contentType: 'text/html', body: 'Google stand-in' })
        )
        await page.goto(orgUrl('/integrations/gitlab'))
        await expect(page.getByRole('heading', { level: 1, name: 'GitLab' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'GitLab', exact: true })).toHaveCount(0)
        await page.goto(orgUrl('/integrations/gmail'))
        await expect(page.getByText('Connect your Gmail account')).toBeVisible()
        const authorization = context.waitForEvent('request', (request) =>
          request.url().startsWith('https://accounts.google.com/')
        )
        await page.getByRole('button', { name: 'Gmail', exact: true }).click()
        assert((await authorization).url().includes('client_id='))
      })
    }
  )
  await check(
    'a connected account: listed first, auto-selected, Manage has Reconnect and Disconnect',
    async () => {
      await withSession(CONNECTED, async ({ page }) => {
        await page.goto(orgUrl('/integrations'))
        await expect(
          page.getByRole('region', { name: 'Your accounts' }).getByRole('link', { name: /^Gmail/ })
        ).toContainText('1 account')
        await page
          .getByRole('region', { name: 'Your accounts' })
          .getByRole('link', { name: /^Gmail/ })
          .click()
        await expect(page.getByRole('heading', { level: 1, name: 'Gmail' })).toBeVisible()
        await expect(page.getByText(CONNECTED.email).first()).toBeVisible()
        await page.getByRole('button', { name: `Manage ${CONNECTED.email}` }).click()
        await expect(menuEntry(page, 'Reconnect account')).toBeVisible()
        await menuEntry(page, 'Disconnect account').click()
        const modal = dialog(page, 'Disconnect Gmail')
        await expect(
          modal.getByText(/Workflows using this account will also lose access/)
        ).toBeVisible()
        await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
      })
    }
  )
  await check(
    'several accounts: listed together, each managed alone, and another can be added',
    async () => {
      const second = 'second.account@example.test'
      const secondId = 'org-redesign-grant-gmail-second'
      await withRestore(
        () => sql`delete from credential where id = ${secondId}`,
        async () => {
          await sql`insert into credential (id, created_by, credential_group_enrollment_id, credential_group_option_id, organization_id, type, display_name, provider_id, managed_oauth_status, managed_oauth_scope_version, granted_scopes, provider_subject_id, authorization_app_id, encrypted_oauth_token_set, access_token_expires_at, granted_at)
            select ${secondId}, created_by, credential_group_enrollment_id, credential_group_option_id, organization_id, type, ${second}, provider_id, 'needs_reauth', managed_oauth_scope_version, granted_scopes, ${secondId}, authorization_app_id, encrypted_oauth_token_set, access_token_expires_at, granted_at
            from credential where id = ${GRANTS.gmail.credentialId}`
          await withSession(CONNECTED, async ({ page, context }) => {
            await context.route('https://accounts.google.com/**', (route) =>
              route.fulfill({ status: 200, contentType: 'text/html', body: 'Google stand-in' })
            )
            await page.goto(orgUrl('/integrations/gmail'))
            const accounts = page.getByRole('region', { name: 'Connected accounts' })
            await expect(accounts.getByText(CONNECTED.email).first()).toBeVisible()
            await expect(accounts.getByText(second).first()).toBeVisible()
            await expect(
              accounts.getByRole('button', { name: `Reconnect ${second}` })
            ).toBeVisible()
            await expect(
              accounts.getByRole('button', { name: `Reconnect ${CONNECTED.email}` })
            ).toHaveCount(0)
            await page.screenshot({
              path: resolve(artifactDirectory, 'integration-several-accounts.png'),
              fullPage: true,
              animations: 'disabled',
            })
            await page.setViewportSize({ width: PHONE.width, height: PHONE.height })
            await page.screenshot({
              path: resolve(artifactDirectory, 'integration-several-accounts-mobile.png'),
              fullPage: true,
              animations: 'disabled',
            })
            await page.setViewportSize({ width: DESKTOP.width, height: DESKTOP.height })

            await accounts.getByRole('button', { name: `Manage ${second}` }).click()
            await menuEntry(page, 'Disconnect account').click()
            const modal = dialog(page, 'Disconnect Gmail')
            await expect(modal).toContainText(second)
            await expect(modal).not.toContainText(CONNECTED.email)
            await modal.getByRole('button', { name: 'Cancel', exact: true }).click()

            const authorization = context.waitForEvent('request', (request) =>
              request.url().startsWith('https://accounts.google.com/')
            )
            await accounts.getByRole('button', { name: 'Add account', exact: true }).click()
            const prompt = new URL((await authorization).url()).searchParams.get('prompt')
            assert(prompt?.includes('select_account'), 'Add account must offer an account chooser')
          })
        }
      )
    }
  )
  await check('a stale ?account= says so', async () => {
    await withSession(CONNECTED, async ({ page }) => {
      await page.goto(orgUrl('/integrations/gmail?account=gone'))
      await expect(page.getByText('This account is no longer connected.')).toBeVisible()
    })
  })
  await check('an unknown provider says it is no longer available', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/integrations/not-a-provider'))
      await expect(page.getByText('This integration is no longer available.')).toBeVisible()
    })
  })
  await check('a connection deep link shows its request', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(
        url(
          `${root}/integrations?connectorType=gmail&provider=gmail&connectionMode=live&optionId=gmail`
        )
      )
      await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toBeVisible()
      await expect(page.getByText('Connect Gmail', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeEnabled()
    })
  })
  await check(
    'the inventory and Search reads fail separately, each with its retry',
    async () => {
      const retry = (page: Page) => page.getByRole('button', { name: 'Retry', exact: true }).first()
      await withSession(MEMBER, async ({ page }) => {
        await withTableHidden('credential_group', async (restore) => {
          await page.goto(orgUrl('/integrations'))
          await expect(page.getByText('Could not load your connections')).toBeVisible({
            timeout: 40_000,
          })
          await restore()
          await retry(page).click()
          await expect(page.getByRole('link', { name: /^Gmail/ })).toBeVisible()
        })
      })
      await withSession(MEMBER, async ({ page }) => {
        await withTableHidden('organization_search_integration', async (restore) => {
          await page.goto(orgUrl('/integrations'))
          await expect(page.getByText('Could not load Search connections')).toBeVisible({
            timeout: 40_000,
          })
          await restore()
          const reread = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === '/api/knowledge/sim-search/integrations' &&
              response.request().method() === 'GET'
          )
          await retry(page).click()
          assert((await reread).ok(), 'Retry did not recover the Search connections read')
          await expect(page.getByText('Could not load Search connections')).toHaveCount(0)
        })
      })
    },
    {
      // The two reads whose tables the check hides, one at a time.
      allow: [
        refused(500, 'GET', `/api/organizations/${ORGANIZATION_ID}/connected-accounts`),
        refused(500, 'GET', '/api/knowledge/sim-search/integrations'),
      ],
    }
  )

  section('3 Tool permissions')
  await check('a leftover tools filter on an account with no tools does not dead-end', async () => {
    await withSession(CONNECTED, async ({ page }) => {
      await page.route('**/connected-accounts/personal/*/tool-permissions', async (route) => {
        const response = await route.fetch()
        await route.fulfill({ response, json: { ...(await response.json()), tools: [] } })
      })
      await page.goto(orgUrl(`/integrations/accounts/${GRANTS.gmail.credentialId}?tools=x`))
      const panel = page.getByRole('region', { name: 'Tool permissions' })
      await expect(panel.getByText('No Assistant tools are available')).toBeVisible()
      await expect(panel.getByText('No matching tools')).toHaveCount(0)
    })
  })
  await check(
    'member: approval notice, Allow disabled, Ask and Block selectable, saves with revision',
    async () => {
      await withSession(CONNECTED, async ({ page }) => {
        await page.goto(orgUrl('/integrations/gmail'))
        const panel = page.getByRole('region', { name: 'Tool permissions' })
        await expect(
          panel.getByText('Your organization requires approval before tools run.')
        ).toBeVisible()
        await expect(panel.getByRole('searchbox', { name: 'Search tools' })).toBeVisible()
        await expect(panel.getByRole('heading', { name: /Read-only tools/ })).toBeVisible()
        await expect(panel.getByRole('heading', { name: /Write tools/ })).toBeVisible()
        const group = panel.getByRole('group', { name: 'Write tools permission' })
        await expect(group.getByRole('radio', { name: 'Allow', exact: true })).toBeDisabled()
        await expect(group.getByRole('radio', { name: 'Block', exact: true })).toBeEnabled()
        const saved = page.waitForRequest(
          (request) => request.method() !== 'GET' && request.url().includes('permissions')
        )
        await group.getByRole('radio', { name: 'Block', exact: true }).click({ force: true })
        const body = (await saved).postDataJSON()
        assert(
          JSON.stringify(body).includes('revision') || body.expectedRevision !== undefined,
          'The save carries a revision'
        )
        await expect(group.getByRole('radio', { name: 'Block', exact: true })).toBeChecked()
        await group.getByRole('radio', { name: 'Ask', exact: true }).click({ force: true })
      })
    }
  )
  await check('the account route still opens its permissions', async () => {
    await withSession(CONNECTED, async ({ page }) => {
      await page.goto(orgUrl(`/integrations/accounts/${GRANTS.gmail.credentialId}`))
      await expect(page.getByRole('region', { name: 'Tool permissions' })).toBeVisible()
    })
  })

  section('3 Generic Secrets')
  await check('member mode opens the personal editor and keeps q on the way back', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/integrations?q=secret'))
      const row = page
        .getByRole('main')
        .getByRole('link')
        .filter({ hasText: /Secrets/ })
      await expect(row).toContainText('Personal secrets')
      await row.click()
      await expect(page).toHaveURL(
        (address) =>
          address.pathname === `${root}/integrations/secrets` &&
          address.searchParams.get('q') === 'secret'
      )
      await page.getByRole('button', { name: 'Integrations', exact: true }).click()
      await expect(page).toHaveURL(
        (address) =>
          address.pathname === `${root}/integrations` && address.searchParams.get('q') === 'secret'
      )
    })
  })
  await check('organization mode lists a read-only view under the organization', async () => {
    await sql`update organization_secret_source set mode = 'organization' where organization_id = ${ORGANIZATION_ID}`
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/integrations?q=secret'))
      const row = page
        .getByRole('region', { name: 'Managed by your organization' })
        .getByRole('link')
        .filter({ hasText: /Secrets/ })
      await expect(row).toContainText('Organization managed')
      await row.click()
      await expect(page).toHaveURL(
        (address) => address.pathname === `${root}/integrations/generic-secrets`
      )
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Secrets')
    }).finally(
      () =>
        sql`update organization_secret_source set mode = 'member' where organization_id = ${ORGANIZATION_ID}`
    )
  })
  notProvable(
    'Slack onboarding ?slack= actions',
    'A valid token needs a Slack workspace install; invalid tokens are asserted as not found'
  )
  notProvable('Desktop OAuth listener', 'Needs the packaged desktop app')
}
