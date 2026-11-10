import { expect } from '@playwright/test'
import { escapeRegExp } from '@sim/utils/string'
import { requireEnv, signIn } from '@/platform/checks/live/session'
import { withLiveDatabase } from '@/platform/checks/live/support/database'
import { liveRoute } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

/**
 * Integrations on real rows. The seeded connected administrator holds a managed Google Calendar
 * grant through the organization's credential group (`scripts/platform-live-seed.ts`); each check
 * adds a workspace credential for the same app, so the page has to join the member's app with the
 * workspace catalog's.
 */
const WORKSPACE_ID = '5e1d7c3a-0b6f-4a2e-9c41-7d8e0f1a2b01'
const connectedEmail = () => requireEnv('PLATFORM_LIVE_CONNECTED_EMAIL')

interface SeededCredential {
  id: string
  displayName: string
}

/**
 * Runs `check` with a Google Calendar credential of the seeded workspace, which `email` connected
 * and administers, and deletes it and its account afterwards whatever happened.
 */
async function withWorkspaceCalendarCredential(
  email: string,
  check: (credential: SeededCredential) => Promise<void>
) {
  const run = Date.now()
  const credential = { id: `platform-live-calendar-${run}`, displayName: `Team calendar ${run}` }
  const accountId = `${credential.id}-account`
  await withLiveDatabase((sql) =>
    sql.begin(async (tx) => {
      const [owner] = await tx<{ id: string }[]>`select id from "user" where email = ${email}`
      await tx`insert into account (id, account_id, provider_id, user_id, access_token, scope,
          created_at, updated_at)
        values (${accountId}, ${`google-subject-${run}`}, 'google-calendar', ${owner.id},
          'platform-live-not-a-token', 'https://www.googleapis.com/auth/calendar', now(), now())`
      await tx`insert into credential (id, workspace_id, type, display_name, provider_id,
          account_id, created_by)
        values (${credential.id}, ${WORKSPACE_ID}, 'oauth', ${credential.displayName},
          'google-calendar', ${accountId}, ${owner.id})`
      await tx`insert into credential_member (id, credential_id, user_id, role, status, joined_at)
        values (${`${credential.id}-admin`}, ${credential.id}, ${owner.id}, 'admin', 'active', now())`
    })
  )
  try {
    await check(credential)
  } finally {
    await withLiveDatabase(async (sql) => {
      await sql`delete from credential where id = ${credential.id}`
      await sql`delete from account where id = ${accountId}`
    })
  }
}

test('a member account and a workspace credential for one app list it once, and its slug opens one page with both', async ({
  page,
}) => {
  await withWorkspaceCalendarCredential(connectedEmail(), async (credential) => {
    await signIn(page, connectedEmail(), liveRoute(`/integrations?workspace=${WORKSPACE_ID}`))
    await expect(
      page.getByRole('main').getByRole('link', { name: /^Google Calendar\b/ })
    ).toHaveCount(1)
    // The slug a saved link may carry lands on the app's one canonical page, query kept.
    await page.goto(liveRoute(`/integrations/google-calendar?workspace=${WORKSPACE_ID}`))
    await expect(page).toHaveURL(
      new RegExp(
        `${escapeRegExp(liveRoute('/integrations/google_calendar'))}\\?workspace=${WORKSPACE_ID}$`
      )
    )
    const connected = page.getByRole('region', { name: 'Connected credentials', exact: true })
    await expect(connected.getByText(connectedEmail(), { exact: true })).toBeVisible()
    await expect(connected.getByText(credential.displayName, { exact: true })).toBeVisible()
  })
})

test('a workspace credential renames from its page, and the name survives a reload', async ({
  page,
}) => {
  await withWorkspaceCalendarCredential(connectedEmail(), async (credential) => {
    const renamed = `${credential.displayName} renamed`
    await signIn(
      page,
      connectedEmail(),
      liveRoute(`/integrations/google_calendar?workspace=${WORKSPACE_ID}&account=${credential.id}`)
    )
    const details = page.getByRole('form', { name: 'Credential details' })
    const name = details.getByRole('textbox', { name: 'Display name' })
    await expect(name).toHaveValue(credential.displayName)
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname === `/api/credentials/${credential.id}`
    )
    await name.fill(renamed)
    await details.getByRole('button', { name: 'Save changes', exact: true }).click()
    const response = await saved
    expect(response.ok()).toBe(true)
    expect(new URL(response.url()).searchParams.get('workspaceId')).toBe(WORKSPACE_ID)
    await page.reload()
    await expect(name).toHaveValue(renamed)
  })
})
