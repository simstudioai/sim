import { expect, type Page } from '@playwright/test'
import {
  memberEmail,
  organizationId,
  requireEnv,
  signIn,
  signInAsAdmin,
} from '@/platform/checks/live/session'
import { withLiveDatabase, withPerson } from '@/platform/checks/live/support/database'
import { liveRoute } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

/**
 * Mutates the seeded organization. `PLATFORM_LIVE_EMAIL` is an administrator,
 * `PLATFORM_LIVE_MEMBER_EMAIL` a plain member, `PLATFORM_LIVE_ROLE_TARGET_EMAIL` a member whose role
 * flips and flips back, and `PLATFORM_LIVE_REFUSED_INVITE_EMAIL` an address the batch invite always
 * refuses. The member a removal check removes is its own, seeded in `PLATFORM_LIVE_DATABASE_URL`, and
 * a role change is put back there whatever the check did.
 */
const MEMBERS = liveRoute('/settings/members')

async function openMembers(page: Page) {
  await signInAsAdmin(page, MEMBERS)
  await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible()
}

function memberRow(page: Page, email: string) {
  return page
    .getByText(email)
    .first()
    .locator('xpath=ancestor::div[.//button[starts-with(@aria-label, "Actions for")]][1]')
}

test('a partial invite failure keeps only the refused address, with its reason', async ({
  page,
}) => {
  await openMembers(page)
  const refused = requireEnv('PLATFORM_LIVE_REFUSED_INVITE_EMAIL')
  const accepted = `platform-live-${Date.now()}@example.test`

  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Invite people' })
  await dialog.getByLabel('Email addresses').fill(`${accepted}, ${refused},`)
  await dialog.getByRole('button', { name: 'Send invites' }).click()

  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByRole('button', { name: `Remove ${refused}` })).toBeVisible()
  await expect(dialog.getByRole('button', { name: `Remove ${accepted}` })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Close' }).click()

  await page.reload()
  await expect(page.getByText(accepted).first()).toBeVisible()
})

test('a role change persists and a failed one is reported', async ({ page }) => {
  await openMembers(page)
  const target = requireEnv('PLATFORM_LIVE_ROLE_TARGET_EMAIL')
  const roleSelect = () => memberRow(page, target).getByRole('button', { name: /^Role for/ })
  /** Picks `role` and waits for the server to answer: a reload sent first reads the old role. */
  async function chooseRole(role: 'Admin' | 'Member') {
    await roleSelect().click()
    const [saved] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          new URL(response.url()).pathname.includes('/members/')
      ),
      page.getByRole('menuitemradio', { name: role }).click(),
    ])
    expect(saved.ok()).toBe(true)
  }
  try {
    await chooseRole('Admin')
    await page.reload()
    await expect(roleSelect()).toHaveText(/Admin/)

    await page.route('**/api/organizations/*/members/*', (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({ status: 500, json: { error: 'Refused by the live check' } })
        : route.continue()
    )
    await roleSelect().click()
    await page.getByRole('menuitemradio', { name: 'Member' }).click()
    await expect(page.getByText("Couldn't change the role")).toBeVisible()
    await expect(roleSelect()).toHaveText(/Admin/)
    await page.unroute('**/api/organizations/*/members/*')

    await chooseRole('Member')
    await page.reload()
    await expect(roleSelect()).toHaveText(/Member/)
  } finally {
    // A failure part-way must not leave the seeded member an administrator for the next run.
    await withLiveDatabase(
      (sql) => sql`update member set role = 'member'
        where organization_id = ${organizationId()}
          and user_id = (select id from "user" where email = ${target})`
    )
  }
})

test('removal holds on its disclosure, keeps the dialog on failure, then removes', async ({
  page,
}) => {
  await withPerson(
    'removable',
    { organizationId: organizationId(), role: 'member' },
    async (person) => {
      const target = person.email
      await openMembers(page)
      await memberRow(page, target)
        .getByRole('button', { name: /^Actions for/ })
        .click()
      await page.getByRole('menuitem', { name: 'Remove', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Remove team member' })
      const confirm = dialog.getByRole('button', { name: 'Remove', exact: true })
      await expect(confirm).toBeEnabled()

      await page.route('**/api/organizations/*/members/*', (route) =>
        route.request().method() === 'DELETE'
          ? route.fulfill({ status: 403, json: { error: 'Refused by the live check' } })
          : route.continue()
      )
      await confirm.click()
      await expect(dialog.getByRole('alert')).toContainText('Refused by the live check')
      await page.unroute('**/api/organizations/*/members/*')

      await confirm.click()
      await expect(dialog).toBeHidden()
      await expect(page.getByText(target)).toHaveCount(0)
      await page.reload()
      await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible()
      await expect(page.getByText(target)).toHaveCount(0)
    }
  )
})

test('a plain member sees no controls the server would refuse', async ({ page }) => {
  await signIn(page, memberEmail(), MEMBERS)
  await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible()
  // The section and its roster have painted, so the absences below are read from them.
  await expect(page.getByRole('button', { name: 'Leave organization' })).toBeVisible()
  await expect(page.getByRole('main').getByText(memberEmail()).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Role for/ })).toHaveCount(0)
})
