import { expect, type Page, test } from '@playwright/test'
import {
  memberEmail,
  signInAsAdmin as openAsAdmin,
  requireEnv,
  signIn,
} from '@/platform/checks/live/session'

/**
 * Mutates the seeded organization. `PLATFORM_LIVE_EMAIL` is an administrator,
 * `PLATFORM_LIVE_MEMBER_EMAIL` a plain member, `PLATFORM_LIVE_ROLE_TARGET_EMAIL` a member whose role
 * flips and flips back, `PLATFORM_LIVE_REMOVABLE_EMAIL` someone reseeded before each run, and
 * `PLATFORM_LIVE_REFUSED_INVITE_EMAIL` an address the batch invite always refuses.
 */
const MEMBERS = '/org/settings/members'

async function signInAsAdmin(page: Page) {
  await openAsAdmin(page, MEMBERS)
  await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible()
}

function memberRow(page: Page, email: string) {
  return page
    .getByText(email)
    .locator('xpath=ancestor::div[.//button[starts-with(@aria-label, "Actions for")]][1]')
}

test('a partial invite failure keeps only the refused address, with its reason', async ({
  page,
}) => {
  await signInAsAdmin(page)
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
  await signInAsAdmin(page)
  const target = requireEnv('PLATFORM_LIVE_ROLE_TARGET_EMAIL')
  await memberRow(page, target).getByRole('combobox').click()
  await page.getByRole('option', { name: 'Admin' }).click()
  await page.reload()
  await expect(memberRow(page, target).getByRole('combobox')).toHaveText(/Admin/)

  await page.route('**/api/organizations/*/members/*', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 500, json: { error: 'Refused by the live check' } })
      : route.continue()
  )
  await memberRow(page, target).getByRole('combobox').click()
  await page.getByRole('option', { name: 'Member' }).click()
  await expect(page.getByText("Couldn't change the role")).toBeVisible()
  await expect(memberRow(page, target).getByRole('combobox')).toHaveText(/Admin/)
  await page.unroute('**/api/organizations/*/members/*')

  await memberRow(page, target).getByRole('combobox').click()
  await page.getByRole('option', { name: 'Member' }).click()
  await page.reload()
  await expect(memberRow(page, target).getByRole('combobox')).toHaveText(/Member/)
})

test('removal holds on its disclosure, keeps the dialog on failure, then removes', async ({
  page,
}) => {
  await signInAsAdmin(page)
  const target = requireEnv('PLATFORM_LIVE_REMOVABLE_EMAIL')
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
})

test('a plain member sees no controls the server would refuse', async ({ page }) => {
  await signIn(page, memberEmail(), MEMBERS)
  await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: /^Role for/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Leave organization' })).toBeVisible()
})
