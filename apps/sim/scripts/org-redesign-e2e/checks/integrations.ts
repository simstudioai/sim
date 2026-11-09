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
  org,
  PHONE,
  refused,
  section,
  sql,
  url,
  withRestore,
  withSession,
  withTableHidden,
} from '@/scripts/org-redesign-e2e/harness'
import { dialog } from '@/scripts/org-redesign-e2e/locators'

/** A provider's detail page, under the organization's integration center. */

/** One account's own page on its provider's detail, open on the tab that holds its tools. */
const accountPermissionsPath = (providerId: string, credentialId: string) =>
  `${org.integration(providerId)}?${new URLSearchParams({ account: credentialId, credentialTab: 'permissions' })}`

/** The Apps destination's search, which the control bar names for the destination it filters. */
const appSearch = (page: Page) => page.getByRole('searchbox', { name: 'Search apps' })

/** A detail page's way back to the directory. */
const backToIntegrations = (page: Page) =>
  page
    .getByRole('navigation', { name: 'Integrations navigation' })
    .getByRole('link', { name: 'Integrations', exact: true })

/** Connect opens a review of the access it asks for, and Continue leaves for the provider. */
async function startConnect(page: Page, name: string) {
  await page.getByRole('button', { name: 'Connect integration', exact: true }).click()
  const review = dialog(page, `Connect ${name}`)
  await review.getByRole('button', { name: 'Continue', exact: true }).click()
}

export async function integrationChecks() {
  section('3 Integrations')
  await check('title, search, and every approved provider, with no Microsoft row', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(url(org.integrations))
      await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toBeVisible()
      await expect(appSearch(page)).toBeVisible()
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
      // A member connected to nothing has no Connected group; every approved app is available.
      await expect(page.getByRole('region', { name: 'Connected', exact: true })).toHaveCount(0)
      const available = page.getByRole('region', { name: 'Available', exact: true })
      await expect(available.getByRole('link', { name: /^Gmail/ })).toBeVisible()
      await expect(available.getByRole('link', { name: /^GitLab/ })).toBeVisible()
    })
  })
  await check(
    'search filters by name and is kept in the URL through a detail and back',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(url(org.integrations))
        await appSearch(page).fill('jira')
        await expect(page).toHaveURL((address) => address.searchParams.get('q') === 'jira')
        const jira = page.getByRole('link', { name: /^Jira/ })
        await expect(jira).toBeVisible()
        await expect(page.getByRole('link', { name: /^Gmail/ })).toHaveCount(0)
        await jira.click()
        await expect(page).toHaveURL((address) => address.pathname === org.integration('jira'))
        await backToIntegrations(page).click()
        await expect(page).toHaveURL(
          (address) =>
            address.pathname === org.integrations && address.searchParams.get('q') === 'jira'
        )
        await expect(appSearch(page)).toHaveValue('jira')
        await appSearch(page).fill('zzzz-nothing')
        await expect(page.getByRole('heading', { name: 'No results found' })).toBeVisible()
      })
    }
  )
  await check(
    'the document carries referrer no-referrer, which protects the Slack token',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        for (const path of [org.integrations, org.integration('gmail')]) {
          const response = await page.goto(url(path))
          const header = response?.headers()['referrer-policy']
          const meta = await page
            .locator('meta[name="referrer"]')
            .getAttribute('content', { timeout: 1_000 })
            .catch(() => null)
          assert(
            header === 'no-referrer' || meta === 'no-referrer',
            `${path} sends a referrer: header ${header ?? 'none'}, meta ${meta ?? 'none'}`
          )
        }
      })
    }
  )
  await check('legacy ?integration= links reach the detail with their account', async () => {
    await withSession(CONNECTED, async ({ page }) => {
      await page.goto(url(`${org.integrations}?integration=source:gmail&q=g`))
      await expect(page).toHaveURL(
        (address) =>
          address.pathname === org.integration('gmail') && address.searchParams.get('q') === 'g'
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
        await page.goto(url(org.integration('gitlab')))
        await expect(page.getByRole('heading', { level: 1, name: 'GitLab' })).toBeVisible()
        await expect(page.getByText(/^Managed by your organization\./)).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Connect integration', exact: true })
        ).toHaveCount(0)
        await page.goto(url(org.integration('gmail')))
        await expect(page.getByRole('heading', { level: 1, name: 'Gmail' })).toBeVisible()
        await expect(page.getByText('No connected credentials', { exact: true })).toBeVisible()
        const authorization = context.waitForEvent('request', (request) =>
          request.url().startsWith('https://accounts.google.com/')
        )
        await startConnect(page, 'Gmail')
        assert((await authorization).url().includes('client_id='))
      })
    }
  )
  await check(
    'a connected account: listed first, shown on its detail, with Reconnect and Disconnect',
    async () => {
      await withSession(CONNECTED, async ({ page }) => {
        await page.goto(url(org.integrations))
        const groups = await page
          .getByRole('main')
          .getByRole('region')
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))
        assert.deepEqual(
          groups.filter((name) => name === 'Connected' || name === 'Available'),
          ['Connected', 'Available'],
          'Connected apps come before available ones'
        )
        const gmail = page
          .getByRole('region', { name: 'Connected', exact: true })
          .getByRole('link', { name: /^Gmail/ })
        await expect(gmail).toContainText('1 connected credential')
        await gmail.click()
        await expect(page.getByRole('heading', { level: 1, name: 'Gmail' })).toBeVisible()
        const credential = page.getByRole('region', { name: 'Connected credential', exact: true })
        await expect(credential.getByText(CONNECTED.email).first()).toBeVisible()
        await credential.getByRole('link', { name: new RegExp(`^${CONNECTED.email}`) }).click()
        await expect(page).toHaveURL(
          (address) => address.searchParams.get('account') === GRANTS.gmail.credentialId
        )
        await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
        const modal = dialog(page, 'Disconnect Gmail')
        await expect(
          modal.getByText(/Workflows using this account will also lose access/)
        ).toBeVisible()
        await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(modal).toHaveCount(0)
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
            await page.goto(url(org.integration('gmail')))
            const accounts = page.getByRole('region', {
              name: 'Connected credentials',
              exact: true,
            })
            await expect(accounts.getByText(CONNECTED.email).first()).toBeVisible()
            await expect(accounts.getByText(second).first()).toBeVisible()
            // Reconnection is an account action, never a status on the list.
            await expect(accounts.getByRole('button', { name: /Reconnect/ })).toHaveCount(0)
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

            await accounts.getByRole('link', { name: new RegExp(`^${second}`) }).click()
            await expect(page).toHaveURL(
              (address) => address.searchParams.get('account') === secondId
            )
            await expect(page.getByRole('heading', { level: 1, name: second })).toBeVisible()
            await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible()
            await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
            const modal = dialog(page, 'Disconnect Gmail')
            await expect(modal).toContainText(second)
            await expect(modal).not.toContainText(CONNECTED.email)
            await modal.getByRole('button', { name: 'Cancel', exact: true }).click()

            await page.goto(url(org.integration('gmail')))
            const authorization = context.waitForEvent('request', (request) =>
              request.url().startsWith('https://accounts.google.com/')
            )
            await startConnect(page, 'Gmail')
            const prompt = new URL((await authorization).url()).searchParams.get('prompt')
            assert(prompt?.includes('select_account'), 'Add account must offer an account chooser')
          })
        }
      )
    }
  )
  await check('a stale ?account= says so', async () => {
    await withSession(CONNECTED, async ({ page }) => {
      await page.goto(url(`${org.integration('gmail')}?account=gone`))
      await expect(page.getByText('This account is no longer connected.')).toBeVisible()
    })
  })
  await check('an unknown provider says it is no longer available', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(url(org.integration('not-a-provider')))
      await expect(page.getByText('This integration is no longer available.')).toBeVisible()
    })
  })
  await check('a connection deep link shows its request', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(
        url(
          `${org.integrations}?connectorType=gmail&provider=gmail&connectionMode=live&optionId=gmail`
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
          await page.goto(url(org.integrations))
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
          await page.goto(url(org.integrations))
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
      await page.goto(url(`${accountPermissionsPath('gmail', GRANTS.gmail.credentialId)}&tools=x`))
      const panel = page.getByRole('region', { name: 'Tool permissions' })
      await expect(panel.getByText('No Assistant tools are available')).toBeVisible()
      await expect(panel.getByText('No matching tools')).toHaveCount(0)
    })
  })
  await check(
    'member: approval notice, Allow disabled, Ask and Block selectable, saves with revision',
    async () => {
      await withSession(CONNECTED, async ({ page }) => {
        await page.goto(url(org.integration('gmail')))
        await page
          .getByRole('region', { name: 'Connected credential', exact: true })
          .getByRole('link', { name: new RegExp(`^${CONNECTED.email}`) })
          .click()
        await page
          .getByRole('tablist', { name: 'Credential details' })
          .getByRole('tab', { name: 'Permissions', exact: true })
          .click()
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
      await page.goto(url(accountPermissionsPath('gmail', GRANTS.gmail.credentialId)))
      await expect(page.getByRole('region', { name: 'Tool permissions' })).toBeVisible()
      // The legacy account address, which saved links and notifications still carry.
      await page.goto(url(`${org.integrations}/accounts/${GRANTS.gmail.credentialId}`))
      await expect(page.getByRole('region', { name: 'Tool permissions' })).toBeVisible()
    })
  })

  section('3 Generic Secrets')
  await check('member mode opens the personal editor and keeps q on the way back', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(url(`${org.integrations}?tab=credentials&q=secret`))
      const row = page
        .getByRole('region', { name: 'Personal', exact: true })
        .getByRole('link')
        .filter({ hasText: /Secrets/ })
      await expect(row).toBeVisible()
      await row.click()
      await expect(page).toHaveURL(
        (address) =>
          address.pathname === org.memberSecrets && address.searchParams.get('q') === 'secret'
      )
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Secrets')
      await expect(page.getByText('This integration is no longer available.')).toHaveCount(0)
      await backToIntegrations(page).click()
      await expect(page).toHaveURL(
        (address) =>
          address.pathname === org.integrations && address.searchParams.get('q') === 'secret'
      )
    })
  })
  await check('organization mode lists a read-only view under the organization', async () => {
    await sql`update organization_secret_source set mode = 'organization' where organization_id = ${ORGANIZATION_ID}`
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(url(`${org.integrations}?tab=credentials&q=secret`))
      const row = page
        .getByRole('region', { name: 'Shared', exact: true })
        .getByRole('link')
        .filter({ hasText: /Secrets/ })
      await expect(row).toBeVisible()
      await row.click()
      await expect(page).toHaveURL(
        (address) => address.pathname === org.integration('generic-secrets')
      )
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Secrets')
      await expect(
        page.getByText('Your organization’s administrators manage these credentials.')
      ).toBeVisible()
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
