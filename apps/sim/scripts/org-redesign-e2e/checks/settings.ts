import assert from 'node:assert/strict'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { toRecord } from '@sim/utils/object'
import type { z } from 'zod'
import type { listSlackSearchResponseSchema } from '@/lib/api/contracts/knowledge/slack'
import {
  ADMIN,
  ADMIN_CHATS,
  MEMBER,
  MEMBER_ADMIN_WORKSPACE,
  ORGANIZATION_ID,
  OWNER,
  STANDARD_GROUP_ID,
} from '@/scripts/org-redesign-e2e/fixture'
import {
  asPlatformAdmin,
  captureRequests,
  check,
  expect,
  notProvable,
  orgUrl,
  pathOf,
  refused,
  root,
  section,
  sql,
  withRestore,
  withSession,
} from '@/scripts/org-redesign-e2e/harness'
import {
  accountChip,
  dialog,
  expectPageNotFound,
  menuEntry,
  pageTurn,
  sidebar,
} from '@/scripts/org-redesign-e2e/locators'
import { fulfillContract } from '@/scripts/org-redesign-e2e/stubs'

export const SETTINGS_FOR_ALL = ['general', 'members', 'recently-deleted', 'requests', 'search-mcp']
export const SETTINGS_FOR_ADMIN = [
  'subscription',
  'connected-accounts',
  'usage',
  'whitelabeling',
  'audit-logs',
  'access-control',
  'sso',
  'security',
  'data-retention',
  'data-drains',
  'integrations',
  'search-slack',
]

const MEMBER_SETTINGS = ['General', 'Members', 'Recently deleted', 'Requests', 'Search MCP']
const ADMIN_SETTINGS = [
  'General',
  'Subscription',
  'Members',
  'Credential groups',
  'Insights',
  'White-labeling',
  'Recently deleted',
  'Requests',
  'Audit logs',
  'Permission groups',
  'Single sign-on',
  'Security',
  'Data retention',
  'Data drains',
  'Sources',
  'Search MCP',
  'Sim Search in Slack',
]

type SlackSearchListing = z.output<typeof listSlackSearchResponseSchema>

/** Saves a JSON settings column back to what it held, whatever the check did to it. */
async function withOrganizationSettingsRestored(
  column: 'whitelabel_settings' | 'session_policy_settings',
  run: () => Promise<void>
) {
  const [before] =
    await sql`select ${sql(column)} as value from organization where id = ${ORGANIZATION_ID}`
  await withRestore(
    () =>
      sql`update organization set ${sql(column)} = ${before.value === null ? null : sql.json(before.value)} where id = ${ORGANIZATION_ID}`,
    run
  )
}

async function organizationSectionChecks() {
  await check(
    'Subscription: an Enterprise plan is priced by contract, with nothing to cancel',
    async () => {
      await withSession(ADMIN, async ({ page }) => {
        await page.goto(orgUrl('/settings/subscription'))
        await expect(page.getByText('Enterprise plan', { exact: true })).toBeVisible()
        await expect(page.getByText('Custom pricing', { exact: true })).toBeVisible()
        await expect(page.getByText('Next billing date', { exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Manage in Stripe' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Explore organization plans' })).toHaveCount(
          0
        )
        await expect(page.getByText('Cancel subscription', { exact: true })).toHaveCount(0)
        await expect(page.getByRole('textbox', { name: 'Monthly limit, in credits' })).toHaveCount(
          0
        )
      })
    }
  )
  await check(
    'Audit logs: an event is listed, found by search, and absent from a miss',
    async () => {
      const id = 'org-redesign-audit-probe'
      const description = 'Audit probe from the acceptance suite'
      await withRestore(
        () => sql`delete from audit_log where id = ${id}`,
        async () => {
          await sql`insert into audit_log (id, workspace_id, actor_id, action, resource_type, actor_email, description)
          values (${id}, ${MEMBER_ADMIN_WORKSPACE.id}, ${ADMIN.userId}, 'workspace.updated', 'workspace', ${ADMIN.email}, ${description})`
          await withSession(ADMIN, async ({ page }) => {
            await page.goto(orgUrl('/settings/audit-logs'))
            await expect(page.getByText(description)).toBeVisible()
            const search = page.getByRole('searchbox', { name: 'Search audit logs' })
            await search.fill('Audit probe')
            await expect(page.getByText(description)).toBeVisible()
            await search.fill('zzzz-nothing')
            await expect(page.getByText('No results for "zzzz-nothing"')).toBeVisible()
            await expect(page.getByText(description)).toHaveCount(0)
          })
        }
      )
    }
  )
  await check('Security: a bad idle timeout stays local, and a good policy saves', () =>
    withOrganizationSettingsRestored('session_policy_settings', () =>
      withSession(ADMIN, async (session) => {
        const { page } = session
        const writes = captureRequests(
          page,
          (request) => request.method() === 'PUT' && request.url().endsWith('/session-policy')
        )
        await page.goto(orgUrl('/settings/security'))
        const idle = page.getByRole('textbox', { name: 'Idle timeout (hours)' })
        const save = page.getByRole('button', { name: 'Save', exact: true })
        await idle.fill('1')
        await save.click()
        await pageTurn(page)
        assert.deepEqual(writes, [], 'An idle timeout under the minimum reached the server')
        await idle.fill('72')
        const saved = page.waitForResponse(
          (response) =>
            response.request().method() === 'PUT' && response.url().endsWith('/session-policy')
        )
        await save.click()
        assert.ok((await saved).ok(), 'The policy did not save')
        await expect(save).toBeDisabled()
        await page.reload()
        await expect(idle).toHaveValue('72')
        await page.getByRole('button', { name: 'Sign out all members', exact: true }).click()
        const confirm = dialog(page, 'Sign out all members')
        await expect(confirm).toBeVisible()
        await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(confirm).toHaveCount(0)
        await expect(page.getByText('Outbound IP addresses', { exact: true })).toBeVisible()
        await session.settle()
        await expect(page.getByText('Could not load network settings')).toHaveCount(0)
      })
    )
  )
  await check('Sim Search in Slack: an empty organization is offered setup', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/settings/search-slack'))
      await expect(
        page.getByText('Connect your workspace to ask questions in Slack.')
      ).toBeVisible()
      await page.getByRole('button', { name: /^(Set up|Install Sim Search)$/ }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
    })
  })
  await check('Sim Search in Slack: a connection can be disabled and removed', async () => {
    await withSession(ADMIN, async ({ page }) => {
      const installation: SlackSearchListing['installations'][number] = {
        id: 'installation-1',
        credentialId: 'slack-credential-1',
        appId: 'A123',
        teamId: 'T123',
        teamName: 'Ridgeline Slack',
        appKind: 'shared',
        enabled: true,
        needsValidation: false,
        lastOutcome: null,
        lastEventAt: null,
      }
      const configured: unknown[] = []
      const removed: string[] = []
      await page.route('**/api/knowledge/slack**', (route) => {
        const request = route.request()
        if (request.method() === 'POST') {
          configured.push(request.postDataJSON())
          return route.fulfill({ json: { id: installation.id } })
        }
        if (request.method() === 'DELETE') {
          removed.push(pathOf(request.url()))
          return route.fulfill({ json: { id: installation.id } })
        }
        return fulfillContract<SlackSearchListing>(route, {
          sharedAppAvailable: true,
          memberAppKind: 'shared',
          installations: [installation],
          bots: [],
        })
      })
      await page.goto(orgUrl('/settings/search-slack'))
      await expect(page.getByText('Ridgeline Slack', { exact: true })).toBeVisible()
      await expect(page.getByText('Enabled', { exact: true })).toBeVisible()
      const actions = page.getByRole('button', { name: 'Sim Search actions', exact: true })
      await actions.click()
      await menuEntry(page, 'Disable').click()
      await expect
        .poll(() => configured)
        .toEqual([
          {
            organizationId: ORGANIZATION_ID,
            credentialId: installation.credentialId,
            enabled: false,
          },
        ])
      await actions.click()
      await menuEntry(page, 'Remove from Search').click()
      const confirm = dialog(page, 'Remove Slack Search')
      await confirm.getByRole('button', { name: 'Remove', exact: true }).click()
      await expect.poll(() => removed.length).toBe(1)
      assert.match(removed[0], new RegExp(`/${installation.id}\\?`))
    })
  })
  await check(
    'White-labeling: a bad color stays local, and a brand saves and survives reload',
    () =>
      withOrganizationSettingsRestored('whitelabel_settings', () =>
        withSession(ADMIN, async ({ page }) => {
          const writes: string[] = []
          page.on('request', (request) => {
            if (request.method() !== 'GET' && request.url().endsWith('/whitelabel'))
              writes.push(request.url())
          })
          await page.goto(orgUrl('/settings/whitelabeling'))
          const brand = page.getByRole('textbox', { name: 'Brand name' })
          const color = page.getByRole('textbox', { name: 'Primary color', exact: true })
          const save = page.getByRole('button', { name: 'Save', exact: true })
          await color.fill('zz')
          await save.click()
          await pageTurn(page)
          assert.deepEqual(writes, [], 'An invalid color reached the server')
          await color.fill('')
          await brand.fill('Acceptance Brand')
          const saved = page.waitForResponse(
            (response) =>
              response.request().method() !== 'GET' && response.url().endsWith('/whitelabel')
          )
          await save.click()
          assert.ok((await saved).ok(), 'The brand did not save')
          await expect(save).toBeDisabled()
          await page.reload()
          await expect(brand).toHaveValue('Acceptance Brand')
        })
      )
  )
}

export async function settingsChecks() {
  section('3 Settings')
  for (const [persona, expected] of [
    [MEMBER, MEMBER_SETTINGS],
    [ADMIN, ADMIN_SETTINGS],
  ] as const) {
    await check(`${persona.key}: the same sections, in order`, async () => {
      await withSession(persona, async ({ page }) => {
        await page.goto(orgUrl('/settings/general'))
        await expect(
          sidebar(page).getByRole('navigation', { name: 'Settings' }).getByRole('link')
        ).toHaveText([...expected])
      })
    })
  }
  await check('the settings frame: breadcrumb and a section on the design', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/settings/general'))
      await expect(page.getByRole('banner', { name: 'Settings location' })).toContainText('General')
      await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Reset password', exact: true })).toBeVisible()
      await expect(sidebar(page).locator('[data-platform-ui]').first()).toBeVisible()
      await expect(
        page.locator('[data-platform-ui]').getByRole('heading', { name: 'General', exact: true })
      ).toBeVisible()
    })
  })
  await check('Sources, Credential groups and Slack render inside the surface', async () => {
    await withSession(ADMIN, async ({ page }) => {
      for (const [path, title] of [
        ['/settings/integrations', 'Sources'],
        ['/settings/connected-accounts', 'Credential groups'],
        ['/settings/search-slack', 'Sim Search in Slack'],
      ] as const) {
        await page.goto(orgUrl(path))
        await expect(page.getByRole('banner', { name: 'Settings location' })).toContainText(title)
        await expect(
          page
            .locator('[data-platform-ui]')
            .getByRole('heading', { level: 1, name: title, exact: true })
        ).toBeVisible()
        // A second copy may exist for a moment while the document streams; one must not stay.
        await expect(page.getByLabel('Settings location')).toHaveCount(1)
      }
    })
  })
  await check('Add source opens on the surface', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/settings/integrations'))
      await page.getByRole('button', { name: 'Add source', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Add source' })).toBeVisible()
    })
  })
  await check('a legacy alias opens its section under the same URL', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/settings/team'))
      await expect(page.getByRole('banner', { name: 'Settings location' })).toContainText('Members')
      await expect(page.getByPlaceholder('Search members…')).toBeVisible()
    })
  })
  await check(
    "Settings search finds sections and settings, within the viewer's gates",
    async () => {
      await withSession(ADMIN, async ({ page }) => {
        await page.goto(orgUrl('/settings/members'))
        const rail = sidebar(page)
        const field = rail.getByRole('searchbox', { name: 'Search settings' })
        // Answered from hydration on, which the server-rendered field does not wait for.
        await expect(async () => {
          await page.keyboard.press('/')
          await expect(field).toBeFocused({ timeout: 1_000 })
        }).toPass({ timeout: 20_000 })
        await field.fill('password')
        await rail.getByRole('link', { name: 'Reset password', exact: true }).click()
        await expect(page).toHaveURL(orgUrl('/settings/general'))
        await expect(
          page.getByRole('button', { name: 'Reset password', exact: true })
        ).toBeInViewport()
        await field.fill('scim')
        await rail.getByRole('link', { name: 'Directory provisioning', exact: true }).click()
        await expect(page).toHaveURL(orgUrl('/settings/sso?tab=provisioning'))
        await field.fill('audit')
        await expect(rail.getByRole('link', { name: 'Audit logs', exact: true })).toBeVisible()
        await field.fill('no setting is called this')
        await expect(rail.getByText('No matching settings')).toBeVisible()
      })
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl('/settings/general'))
        const rail = sidebar(page)
        await rail.getByRole('searchbox', { name: 'Search settings' }).fill('audit')
        await expect(rail.getByText('No matching settings')).toBeVisible()
      })
    }
  )
  await check(
    'Members: roster and search for a member; Leave present, Invite and seats hidden',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl('/settings/members'))
        await expect(page.getByPlaceholder('Search members…')).toBeVisible()
        await expect(page.getByText(ADMIN.email).first()).toBeVisible()
        await expect(page.getByRole('button', { name: 'Leave organization' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0)
      })
      await withSession(OWNER, async ({ page }) => {
        await page.goto(orgUrl('/settings/members'))
        await expect(page.getByRole('button', { name: 'Invite', exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Leave organization' })).toHaveCount(0)
      })
    }
  )
  await check('Recently deleted restores an owned chat', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/settings/recently-deleted'))
      await expect(page.getByPlaceholder('Search deleted chats')).toBeVisible()
      await expect(page.getByText(ADMIN_CHATS.deleted.title)).toBeVisible()
      await page
        .getByRole('button', { name: /Restore/ })
        .first()
        .click()
      await expect(page.getByText(ADMIN_CHATS.deleted.title)).toHaveCount(0)
    })
  })
  await check('Requests and Search MCP render for a member', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/settings/requests'))
      await expect(page.getByText('No requests yet')).toBeVisible()
      await page.goto(orgUrl('/settings/search-mcp'))
      await expect(
        page
          .getByRole('button', { name: /Copy configuration/ })
          .or(page.getByLabel(/Server URL|Terminal command/).first())
      ).toBeVisible()
    })
  })
  await check('Back from Settings returns to the remembered page', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/links'))
      await accountChip(page).click()
      await dialog(page, 'Account menu')
        .getByRole('button', { name: 'Settings', exact: true })
        .click()
      await expect(page).toHaveURL(orgUrl('/settings/general'))
      await sidebar(page).getByRole('button', { name: 'Back to app', exact: true }).click()
      await expect(page).toHaveURL(orgUrl('/links'))
    })
  })
  await check(
    'Settings leave guard: a dirty form asks, and its own rail row does nothing',
    async () => {
      await withSession(ADMIN, async ({ page }) => {
        await page.goto(orgUrl('/settings/whitelabeling'))
        await page.getByRole('textbox', { name: 'Brand name' }).fill('Unsaved brand')
        const rail = sidebar(page)
        await rail.getByRole('link', { name: 'White-labeling', exact: true }).click()
        await expect(page.getByRole('dialog', { name: 'Unsaved changes' })).toHaveCount(0)
        await rail.getByRole('link', { name: 'Security', exact: true }).click()
        const guard = page.getByRole('dialog', { name: 'Unsaved changes' })
        await expect(guard).toBeVisible()
        await guard.getByRole('button', { name: 'Keep editing' }).click()
        await expect(page).toHaveURL((address) => address.pathname.endsWith('/whitelabeling'))
        await expect(page.getByRole('textbox', { name: 'Brand name' })).toHaveValue('Unsaved brand')
        await rail.getByRole('link', { name: 'Security', exact: true }).click()
        await page
          .getByRole('dialog', { name: 'Unsaved changes' })
          .getByRole('button', { name: 'Discard changes' })
          .click()
        await expect(page).toHaveURL((address) => address.pathname.endsWith('/security'))
      })
    }
  )
  await asPlatformAdmin(() =>
    check(
      'Admin: Enter in a ban reason does not ban, and a running ban cannot be dismissed',
      async () => {
        await withSession(ADMIN, async ({ page }) => {
          let banRequests = 0
          const held = createDeferred<void>()
          await page.route('**/api/auth/admin/ban-user', async (route) => {
            banRequests += 1
            await held.promise
            await route.fulfill({ status: 500, json: { message: 'Ban refused' } })
          })
          await page.goto(orgUrl(`/settings/admin?q=${encodeURIComponent(MEMBER.email)}`))
          await page.getByRole('button', { name: `${MEMBER.email} actions` }).click()
          await page.getByRole('menuitem', { name: 'Ban', exact: true }).click()
          const modal = dialog(page, 'Ban user')
          const reason = modal.getByRole('textbox', { name: 'Reason' })
          await reason.fill('Spam')
          await reason.press('Enter')
          await pageTurn(page)
          assert.equal(banRequests, 0, 'Enter in the reason submitted the ban')
          await expect(modal, 'Enter in the reason closed the dialog').toHaveJSProperty(
            'open',
            true
          )
          await expect(
            modal.getByRole('button', { name: 'Cancel' }),
            'Enter in the reason started the ban'
          ).toBeEnabled()
          await modal.getByRole('button', { name: 'Ban', exact: true }).click()
          // Nothing between the click and the first press: a mutation's `isPending` arrives on a timer.
          await page.keyboard.press('Escape')
          await pageTurn(page)
          await expect(
            modal,
            'An Escape right behind the click dismissed the ban'
          ).toHaveJSProperty('open', true)
          await expect.poll(() => banRequests).toBe(1)
          await expect(modal, 'Starting the ban closed the dialog').toBeVisible()
          // Chromium honored `preventDefault` on `cancel` twice for this input, then closed natively.
          for (const press of ['second', 'third', 'fourth']) {
            await page.keyboard.press('Escape')
            await pageTurn(page)
            await expect(modal, `The ${press} Escape dismissed a running ban`).toHaveJSProperty(
              'open',
              true
            )
          }
          await expect(modal.getByRole('button', { name: 'Cancel' })).toBeDisabled()
          held.resolve()
          await expect(modal.getByText('Ban refused')).toBeVisible()
          await expect(modal.getByRole('button', { name: 'Cancel' })).toBeEnabled()
          // Those presses spent the activation, so this `cancel` cannot be prevented: state follows it.
          await page.keyboard.press('Escape')
          await expect(modal, 'Escape left a refused ban open').toHaveCount(0)
          await page.getByRole('button', { name: `${MEMBER.email} actions` }).click()
          await page.getByRole('menuitem', { name: 'Ban', exact: true }).click()
          await expect(
            modal,
            'An unpreventable Escape left the dialog unable to open'
          ).toBeVisible()
        })
      },
      { allow: [/500 POST .*ban-user/] }
    )
  )
  await check('Permission groups: Enter in Add members search adds nobody', async () => {
    // A default group governs everyone, so it has no members to add until it is not the default.
    await sql`update permission_group set is_default = false where id = ${STANDARD_GROUP_ID}`
    try {
      await withSession(ADMIN, async ({ page }) => {
        let writes = 0
        await page.route('**/permission-groups/*/members', async (route) => {
          if (route.request().method() !== 'GET') writes += 1
          await route.continue()
        })
        await page.goto(orgUrl(`/settings/access-control?group-id=${STANDARD_GROUP_ID}`))
        await page.getByRole('button', { name: 'Add', exact: true }).click()
        const modal = dialog(page, 'Add members')
        const search = modal.getByRole('searchbox')
        await search.fill('member')
        await search.press('Enter')
        await pageTurn(page)
        assert.equal(writes, 0, 'Enter in the search changed the group')
        await expect(modal).toHaveJSProperty('open', true)
      })
    } finally {
      await sql`update permission_group set is_default = true where id = ${STANDARD_GROUP_ID}`
    }
  })
  await check('Usage events: Description shows at the Settings column width', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.route('**/api/organizations/*/usage/events**', (route) =>
        route.fulfill({
          json: {
            events: [
              {
                id: 'usage-event-1',
                createdAt: '2026-11-05T10:00:00.000Z',
                source: 'workflow',
                description: 'A described charge',
                workflowName: null,
                credits: 1,
                hasCost: true,
              },
            ],
            hasMore: false,
          },
        })
      )
      await page.goto(orgUrl('/settings/usage/events'))
      await expect(page.getByRole('columnheader', { name: 'Description' })).toBeVisible()
      await expect(page.getByText('A described charge').filter({ visible: true })).toHaveCount(1)
    })
  })
  await check('Credential groups: a bad address leaves the valid one sent', async () => {
    await withSession(ADMIN, async ({ page }) => {
      const sent: string[][] = []
      await page.route('**/connected-accounts/people', async (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        const emails = toRecord(route.request().postDataJSON()).emails as string[]
        sent.push(emails)
        await route.fulfill({
          json: {
            success: true,
            sentCount: emails.length,
            results: emails.map((email) => ({ email, success: true })),
          },
        })
      })
      await page.goto(orgUrl('/settings/connected-accounts?tab=people'))
      await page.getByRole('button', { name: 'Request connections', exact: true }).click()
      const modal = dialog(page, 'Request account connections')
      const field = modal.getByRole('textbox', { name: 'Emails' })
      await field.fill('good@org-redesign.test not-an-address ')
      await modal.getByRole('button', { name: 'Send requests', exact: true }).click()
      await expect.poll(() => sent).toEqual([['good@org-redesign.test']])
      await expect(modal.getByText('not-an-address')).toBeVisible()
    })
  })
  await check(
    'Single sign-on: inline errors stop a bad Save, and a good one posts',
    async () => {
      await withSession(ADMIN, async ({ page }) => {
        const bodies: unknown[] = []
        await page.route('**/api/auth/sso/register', async (route) => {
          bodies.push(route.request().postDataJSON())
          await route.fulfill({ status: 500, json: { error: 'Stubbed: no identity provider' } })
        })
        await page.goto(orgUrl('/settings/sso'))
        const issuer = page.getByRole('textbox', { name: 'Issuer URL' })
        await issuer.fill('not a url')
        await page.getByRole('button', { name: 'Save', exact: true }).click()
        await expect(
          page.getByText(/Enter a valid issuer URL|Issuer URL must/).first()
        ).toBeVisible()
        assert.equal(bodies.length, 0, 'An invalid form reached the server')
        const providerId = page.getByRole('combobox', { name: 'Provider ID', exact: true })
        await providerId.click()
        await page.getByRole('combobox', { name: 'Select or enter a provider ID' }).fill('e2e-oidc')
        await page.keyboard.press('Escape')
        await expect(providerId, 'Closing the popup cleared the typed provider ID').toContainText(
          'e2e-oidc'
        )
        await issuer.fill('https://idp.org-redesign.test')
        await page.getByRole('textbox', { name: 'Domain', exact: true }).fill('org-redesign.test')
        await page.getByRole('textbox', { name: 'Client ID', exact: true }).fill('e2e-client')
        const secret = page.getByRole('textbox', { name: 'Client secret' })
        await secret.focus()
        await secret.fill('e2e-secret')
        await page.getByRole('button', { name: 'Save', exact: true }).click()
        await expect.poll(() => bodies.length).toBe(1)
        assert.equal(toRecord(bodies[0]).providerId, 'e2e-oidc')
        assert.match(JSON.stringify(bodies[0]), /e2e-secret/)
      })
    },
    { allow: [/500 POST .*sso\/register/] }
  )
  await check('Members: a role change writes, and writes back', () =>
    withRestore(
      () =>
        sql`update member set role = ${MEMBER.role} where user_id = ${MEMBER.userId} and organization_id = ${ORGANIZATION_ID}`,
      () =>
        withSession(ADMIN, async ({ page }) => {
          await page.goto(orgUrl('/settings/members'))
          const role = page.getByRole('combobox', { name: 'Role for Mia Member', exact: true })
          const set = async (name: string) => {
            const write = page.waitForResponse(
              (response) =>
                /\/api\/organizations\/[^/]+\/members\/[^/]+$/.test(pathOf(response.url())) &&
                response.request().method() !== 'GET'
            )
            await role.click()
            await page.getByRole('option', { name, exact: true }).click()
            assert.ok((await write).ok(), `Setting ${name} failed`)
            await expect(role).toContainText(name)
          }
          await set('Admin')
          await set('Member')
        })
    )
  )
  await check('Permission groups: editing the name saves, and saves back', () =>
    withRestore(
      () =>
        sql`update permission_group set name = 'Standard Access' where id = ${STANDARD_GROUP_ID}`,
      () =>
        withSession(ADMIN, async ({ page }) => {
          await page.goto(orgUrl(`/settings/access-control?group-id=${STANDARD_GROUP_ID}`))
          const name = page.getByRole('textbox', { name: 'Name', exact: true })
          await expect(name).toBeVisible()
          const original = await name.inputValue()
          const save = page.getByRole('button', { name: 'Save', exact: true })
          for (const value of [`${original} edited`, original]) {
            await name.fill(value)
            const write = page.waitForResponse(
              (response) =>
                /permission-groups\/[^/]+$/.test(pathOf(response.url())) &&
                response.request().method() !== 'GET'
            )
            await save.click()
            assert.ok((await write).ok(), 'The group did not save')
          }
        })
    )
  )
  await check(
    'Data drains: Create posts the drain',
    async () => {
      await withSession(ADMIN, async ({ page }) => {
        await page.route('**/data-drains', async (route) => {
          if (route.request().method() !== 'POST') return route.continue()
          const body = toRecord(route.request().postDataJSON())
          assert.equal(body.name, 'E2E drain')
          await route.fulfill({ status: 500, json: { error: 'Stubbed: no bucket to verify' } })
        })
        await page.goto(orgUrl('/settings/data-drains'))
        await page.getByRole('button', { name: 'Create drain', exact: true }).click()
        await page.getByRole('textbox', { name: 'Name', exact: true }).fill('E2E drain')
        await page.getByRole('textbox', { name: 'Bucket', exact: true }).fill('e2e-bucket')
        await page.getByRole('textbox', { name: 'Region', exact: true }).fill('us-east-1')
        await page.getByRole('textbox', { name: 'Access key ID', exact: true }).fill('AKIAEXAMPLE')
        await page.getByRole('textbox', { name: 'Secret access key', exact: true }).fill('example')
        const create = page.waitForRequest(
          (request) => request.method() === 'POST' && pathOf(request.url()).endsWith('/data-drains')
        )
        await page.getByRole('button', { name: 'Create', exact: true }).click()
        await create
      }).catch((error) => {
        throw error
      })
    },
    { allow: [/500 POST .*data-drains/] }
  )
  await check('Data retention: a policy edit saves, and saves back', async () => {
    const [before] =
      await sql`select data_retention_settings from organization where id = ${ORGANIZATION_ID}`
    await withRestore(
      () =>
        sql`update organization set data_retention_settings = ${before.data_retention_settings === null ? null : sql.json(before.data_retention_settings)} where id = ${ORGANIZATION_ID}`,
      () =>
        withSession(ADMIN, async ({ page }) => {
          await page.goto(orgUrl('/settings/data-retention'))
          const openPolicy = async () => {
            await page
              .getByRole('button', { name: /Organization/ })
              .first()
              .click()
            return page.getByRole('combobox', { name: 'Log retention' })
          }
          const original = (await (await openPolicy()).textContent())?.trim() ?? ''
          for (const [index, name] of ['5 years', original].entries()) {
            const picker =
              index === 0
                ? page.getByRole('combobox', { name: 'Log retention' })
                : await openPolicy()
            await picker.click()
            await page.getByRole('option', { name, exact: true }).click()
            const write = page.waitForResponse(
              (response) =>
                pathOf(response.url()).endsWith('/data-retention') &&
                response.request().method() !== 'GET'
            )
            const save = page.getByRole('button', { name: 'Save', exact: true })
            await save.click()
            assert.ok((await write).ok(), 'The policy did not save')
            await expect(page.getByRole('combobox', { name: 'Log retention' })).toBeHidden()
          }
        })
    )
  })
  await check('Insights: heatmap pinning, metric explanations, and View all', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/settings/usage'))
      await expect(page.getByText('Less', { exact: true })).toBeVisible()
      await expect(page.getByText('More', { exact: true })).toBeVisible()
      const day = page
        .getByRole('group', { name: /^Daily credit usage/ })
        .getByRole('button')
        .last()
      await day.hover()
      await expect(page.getByRole('tooltip').first()).toBeVisible()
      await expect(day).toHaveAttribute('aria-pressed', 'false')
      await day.click()
      await expect(day).toHaveAttribute('aria-pressed', 'true')
      await day.press('Escape')
      await expect(day).toHaveAttribute('aria-pressed', 'false')
      await page.getByRole('button', { name: 'About workflow runs' }).hover()
      await expect(page.getByText('Retained executions, grouped by start date.')).toBeVisible()
      await expect(
        page.getByText('Other includes cancelled, paused, and unfinished runs.')
      ).toBeVisible()
      await expect(page.getByRole('button', { name: 'View all', exact: true })).toHaveCount(2)
    })
  })
  notProvable(
    'Insights: allowance meter, legend totals, and the unattributed-workspace note',
    'The fixture seeds no usage limit, ledger credits, or unattributed workspace row'
  )
  await check(
    'Permission groups: a failed provider blacklist blocks Providers only',
    async () => {
      await withSession(ADMIN, async ({ page }) => {
        await page.route('**/api/settings/allowed-providers**', (route) =>
          route.fulfill({ status: 500, json: { error: 'unavailable' } })
        )
        const group = `/settings/access-control?group-id=${STANDARD_GROUP_ID}`
        await page.goto(orgUrl(`${group}&group-tab=providers`))
        await expect(page.getByText('unavailable', { exact: true })).toBeVisible()
        await expect(page.getByRole('region', { name: 'Providers' })).toHaveCount(0)
        await page.goto(orgUrl(`${group}&group-tab=blocks`))
        await expect(page.getByRole('region', { name: 'Core Blocks' })).toBeVisible()
      })
    },
    { allow: [/500 GET .*allowed-providers/] }
  )
  await check('Single sign-on: the client secret keeps its autofill guards', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/settings/sso'))
      const decoy = page.locator('input[name="fakepasswordremembered"]')
      await expect(decoy).toHaveJSProperty('hidden', false)
      const secret = page.getByRole('textbox', { name: 'Client secret' })
      await expect(secret).toHaveAttribute('type', 'text')
      await expect(secret).toHaveAttribute('data-masked', 'true')
      await expect(secret).toHaveJSProperty('readOnly', true)
      await secret.focus()
      await expect(secret).toHaveJSProperty('readOnly', false)
    })
  })
  await check(
    'a member deep-linking to any admin section gets not found',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        for (const adminSection of SETTINGS_FOR_ADMIN) {
          await page.goto(orgUrl(`/settings/${adminSection}`))
          await expectPageNotFound(page)
        }
      })
    },
    {
      // The address of each section this check opens, which a member must not reach.
      allow: SETTINGS_FOR_ADMIN.map((adminSection) =>
        refused(404, 'GET', `${root}/settings/${adminSection}`)
      ),
    }
  )
  await organizationSectionChecks()
}
