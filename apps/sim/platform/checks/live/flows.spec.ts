import { expect, type Page, test } from '@playwright/test'
import { escapeRegExp } from '@sim/utils/string'
import { adminEmail, requireEnv, signInAsAdmin } from '@/platform/checks/live/session'
import { liveRoute } from '@/platform/checks/routes'

/** What a member does day to day beyond each section's own spec, against the real API. */
const chats = (page: Page) => page.getByRole('region', { name: 'Chats', exact: true })
const workspaces = (page: Page) => page.getByRole('region', { name: 'Workspaces', exact: true })

test('a chat pins and marks unread, and both survive a reload', async ({ page }) => {
  await signInAsAdmin(page, liveRoute('/home'))
  const list = chats(page)
  await list.getByRole('button', { name: 'Actions for Quarterly review' }).click()
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click()
  await page.reload()
  await list.getByRole('link', { name: 'Quarterly review' }).hover()
  await list.getByRole('button', { name: 'Actions for Quarterly review' }).click()
  await expect(page.getByRole('menuitem', { name: 'Unpin', exact: true })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Mark as unread', exact: true }).click()
  await expect(
    page
      .getByRole('region', { name: 'Needs your attention', exact: true })
      .getByText('Quarterly review')
  ).toBeVisible()
  await page.reload()
  await list.getByRole('button', { name: 'Actions for Quarterly review' }).click()
  await page.getByRole('menuitem', { name: 'Mark as read', exact: true }).click()
  await list.getByRole('button', { name: 'Actions for Quarterly review' }).click()
  await page.getByRole('menuitem', { name: 'Unpin', exact: true }).click()
})

test('a workspace pins and renames through its row menu', async ({ page }) => {
  await signInAsAdmin(page, liveRoute('/home'))
  const list = workspaces(page)
  await list.getByRole('button', { name: 'Actions for Marketing' }).click()
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click()
  await page.reload()
  await list.getByRole('button', { name: 'Actions for Marketing' }).click()
  await expect(page.getByRole('menuitem', { name: 'Unpin', exact: true })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill('Growth')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(list.getByRole('link', { name: 'Growth', exact: true })).toBeVisible()
  await page.reload()
  await expect(list.getByRole('link', { name: 'Growth', exact: true })).toBeVisible()
})

test('Mod+B collapses the sidebar, the choice survives a reload, and Expand restores it', async ({
  page,
}) => {
  await signInAsAdmin(page, liveRoute('/home'))
  const sidebar = page.getByRole('complementary', { name: 'Platform sidebar' })
  await expect(sidebar).toBeVisible()
  await page.keyboard.press('ControlOrMeta+b')
  await expect(sidebar).toBeHidden()
  await page.reload()
  await expect(sidebar).toBeHidden()
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  await expect(sidebar).toBeVisible()
  await page.reload()
  await expect(sidebar).toBeVisible()
})

test('Mod+K opens the palette, which finds a real workspace and a chat', async ({ page }) => {
  await signInAsAdmin(page, liveRoute('/home'))
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Search' })
  await expect(palette).toBeVisible()
  const field = palette.getByRole('combobox', { name: 'Search the platform' })
  await field.fill('Operations')
  await expect(palette.getByText('Operations')).toBeVisible()
  await field.fill('Vendor')
  await expect(palette.getByText('Vendor renewals')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(palette).toBeHidden()
})

test('a deleted chat restores from Recently deleted back into the sidebar', async ({ page }) => {
  await signInAsAdmin(page, liveRoute('/settings/recently-deleted'))
  await page.getByRole('button', { name: 'Restore', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'No deleted chats' })).toBeVisible()
  await page.goto(liveRoute('/home'))
  await expect(chats(page).getByRole('link', { name: 'Retired plan' })).toBeVisible()
})

test('a pending invite resends and revokes from its row', async ({ page }) => {
  await signInAsAdmin(page, liveRoute('/settings/members'))
  const email = `platform-live-revoke-${Date.now()}@example.test`
  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Invite people' })
  await dialog.getByLabel('Email addresses').fill(`${email},`)
  await dialog.getByRole('button', { name: 'Send invites' }).click()
  await expect(dialog).toBeHidden()
  await page.reload()
  const row = page
    .getByText(email)
    .first()
    .locator('xpath=ancestor::div[.//button[starts-with(@aria-label, "Actions for")]][1]')
  await row.getByRole('button', { name: /^Actions for/ }).click()
  await page.getByRole('menuitem', { name: 'Resend invite' }).click()
  await expect(page.getByRole('menuitem', { name: 'Resend invite' })).toHaveCount(0)
  await row.getByRole('button', { name: /^Actions for/ }).click()
  await page.getByRole('menuitem', { name: 'Revoke invite' }).click()
  await expect(page.getByText(email)).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible()
  await expect(page.getByText(email)).toHaveCount(0)
})

test('member search lives in the URL and narrows the roster', async ({ page }) => {
  await signInAsAdmin(page, liveRoute('/settings/members'))
  await page.getByRole('searchbox', { name: /Search members/ }).fill(adminEmail())
  await expect(page).toHaveURL(/search=/)
  await expect(page.getByText(adminEmail()).first()).toBeVisible()
  await expect(page.getByText(requireEnv('PLATFORM_LIVE_OWNER_EMAIL'))).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('searchbox', { name: /Search members/ })).toHaveValue(adminEmail())
  await expect(page.getByText(requireEnv('PLATFORM_LIVE_OWNER_EMAIL'))).toHaveCount(0)
})

test('a notification preference writes and survives a reload', async ({ page }) => {
  await signInAsAdmin(page, liveRoute('/settings/notifications'))
  const toggle = page.getByRole('switch', { name: 'Canvas error notifications' })
  const before = await toggle.isChecked()
  await toggle.click()
  await expect
    .poll(async () => {
      await page.reload()
      return toggle.isChecked()
    })
    .toBe(!before)
  await toggle.click()
})

test('Search mode on Home offers Get started with its real steps', async ({ page }) => {
  await signInAsAdmin(page, liveRoute('/home'))
  await page.getByRole('radio', { name: 'Search' }).click()
  const started = page.getByRole('region', { name: 'Get started', exact: true })
  await expect(started).toBeVisible()
  await expect(started.getByText('Connect an integration')).toBeVisible()
  await page.getByRole('radio', { name: 'Build' }).click()
})

test('a permission group created in the form opens, saves its name and deletes', async ({
  page,
}) => {
  await signInAsAdmin(page, liveRoute('/settings/access-control'))
  const name = `Form group ${Date.now()}`
  await page.getByRole('button', { name: 'Create group' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create permission group' })
  await dialog.getByRole('textbox', { name: 'Name' }).fill(name)
  await dialog.getByText('Make this the organization default group').click()
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}`) }).click()
  await expect(page).toHaveURL(/group-id=/)
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue(name)
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page).not.toHaveURL(/group-id=/)
  await expect(page.getByText(name)).toHaveCount(0)
})

test('Requests opens for an administrator and switches views in the URL', async ({ page }) => {
  await signInAsAdmin(page, liveRoute('/settings/requests'))
  await expect(page.getByRole('heading', { name: 'Requests', level: 1 })).toBeVisible()
  await page.getByRole('radio', { name: 'My requests' }).click()
  await expect(page).toHaveURL(/view=/)
  await page.reload()
  await expect(page.getByRole('radio', { name: 'My requests' })).toBeChecked()
})

test('an unknown settings section is not found, inside the shell', async ({ page }) => {
  await signInAsAdmin(page, liveRoute('/settings/not-a-section'))
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})
