import { expect, type Page } from '@playwright/test'
import { escapeRegExp } from '@sim/utils/string'
import {
  adminEmail,
  organizationId,
  requireEnv,
  signInAsAdmin,
} from '@/platform/checks/live/session'
import { openChatMenu, revealChat, withSeededChat } from '@/platform/checks/live/support/chats'
import { withLiveDatabase } from '@/platform/checks/live/support/database'
import { liveRoute } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

/** What a member does day to day beyond each section's own spec, against the real API. */
const workspaces = (page: Page) => page.getByRole('region', { name: 'Workspaces', exact: true })

/**
 * Presses a shortcut once. The suite's `test` waits for hydration after every load, and the shell
 * attaches its shortcut listener in an effect of that commit, which has run a frame later.
 */
/**
 * Chooses `item` and waits for the write it sends to be answered, so a reload after it reads the
 * saved state rather than racing the request.
 */
async function chooseAndSave(page: Page, item: string, method: string, path: RegExp) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.request().method() === method && path.test(new URL(candidate.url()).pathname)
    ),
    page.getByRole('menuitem', { name: item, exact: true }).click(),
  ])
  expect(response.ok(), `${item} was refused`).toBe(true)
}

const CHAT_WRITE = /^\/api\/mothership\/chats\/[^/]+$/

async function pressShortcut(page: Page, key: string) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => setTimeout(done))))
  await page.keyboard.press(key)
}

test('a chat pins and marks unread, and both survive a reload', async ({ page }) => {
  await withSeededChat({ email: adminEmail() }, async ({ title }) => {
    await signInAsAdmin(page, liveRoute('/home'))
    await openChatMenu(page, title)
    await chooseAndSave(page, 'Pin', 'PATCH', CHAT_WRITE)
    await page.reload()
    await openChatMenu(page, title)
    await expect(page.getByRole('menuitem', { name: 'Unpin', exact: true })).toBeVisible()
    await chooseAndSave(page, 'Mark as unread', 'PATCH', CHAT_WRITE)
    await page.reload()
    await openChatMenu(page, title)
    await expect(page.getByRole('menuitem', { name: 'Mark as read', exact: true })).toBeVisible()
  })
})

test('a workspace pins and renames through its row menu', async ({ page }) => {
  await signInAsAdmin(page, liveRoute('/home'))
  const list = workspaces(page)
  try {
    await list.getByRole('button', { name: 'Actions for Marketing' }).click()
    await chooseAndSave(page, 'Pin', 'POST', /^\/api\/pinned-items$/)
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
  } finally {
    // The seeded name is what every other check and a rerun look the workspace up by, and a pin
    // reorders the section every later check reads.
    await withLiveDatabase(async (sql) => {
      await sql`update workspace set name = 'Marketing' where id = '5e1d7c3a-0b6f-4a2e-9c41-7d8e0f1a2b02'`
      await sql`delete from pinned_item where resource_type = 'workspace'
        and resource_id = '5e1d7c3a-0b6f-4a2e-9c41-7d8e0f1a2b02'
        and user_id = (select id from "user" where email = ${adminEmail()})`
    })
  }
})

test('Mod+B collapses the sidebar, the choice survives a reload, and Expand restores it', async ({
  page,
}) => {
  await signInAsAdmin(page, liveRoute('/home'))
  const sidebar = page.getByRole('complementary', { name: 'Platform sidebar' })
  await expect(sidebar).toBeVisible()
  // Mod+B leaves a focused field alone, as legacy did, so the press starts off any field. The
  // server paints the sidebar before the shortcut listens: press again only while it is showing.
  await page.locator('body').click({ position: { x: 700, y: 20 } })
  await expect(async () => {
    if (await sidebar.isVisible()) await pressShortcut(page, 'ControlOrMeta+b')
    await expect(sidebar).toBeHidden({ timeout: 1_000 })
  }).toPass()
  await page.reload()
  await expect(sidebar).toBeHidden()
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  await expect(sidebar).toBeVisible()
  await page.reload()
  await expect(sidebar).toBeVisible()
})

test('Mod+K opens the palette, which finds a real workspace and a chat', async ({ page }) => {
  await signInAsAdmin(page, liveRoute('/home'))
  const palette = page.getByRole('dialog', { name: 'Search' })
  await pressShortcut(page, 'ControlOrMeta+k')
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
  await withSeededChat({ email: adminEmail(), deleted: true }, async ({ title }) => {
    await signInAsAdmin(page, liveRoute('/settings/recently-deleted'))
    await page.getByRole('searchbox', { name: 'Search deleted chats' }).fill(title)
    const row = page.getByRole('region', { name: 'Deleted chats' })
    await expect(row.getByText(title, { exact: true })).toBeVisible()
    await row.getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'No chats match your search' })).toBeVisible()
    await page.goto(liveRoute('/home'))
    await revealChat(page, title)
  })
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
  await chooseAndSave(page, 'Resend invite', 'POST', /^\/api\/invitations\/[^/]+\/resend$/)
  await expect(page.getByRole('menuitem', { name: 'Resend invite' })).toHaveCount(0)
  await row.getByRole('button', { name: /^Actions for/ }).click()
  await page.getByRole('menuitem', { name: 'Revoke invite' }).click()
  const confirm = page.getByRole('dialog', { name: 'Revoke invite' })
  await expect(confirm).toContainText(email)
  const [revoked] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.request().method() === 'DELETE' &&
        /^\/api\/invitations\/[^/]+$/.test(new URL(candidate.url()).pathname)
    ),
    confirm.getByRole('button', { name: 'Revoke', exact: true }).click(),
  ])
  expect(revoked.ok(), 'Revoke invite was refused').toBe(true)
  await expect(confirm).toBeHidden()
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
  // The seeded administrator has no settings row, so the preference reads its default: on.
  await expect(toggle).toBeChecked()
  try {
    await toggle.click()
    await expect
      .poll(async () => {
        await page.reload()
        return toggle.isChecked()
      })
      .toBe(false)
  } finally {
    await withLiveDatabase(
      (sql) => sql`update settings set error_notifications_enabled = true
        where user_id = (select id from "user" where email = ${adminEmail()})`
    )
  }
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
  try {
    await page.getByRole('button', { name: 'Create group' }).click()
    const dialog = page.getByRole('dialog', { name: 'Create permission group' })
    await dialog.getByRole('textbox', { name: 'Name' }).fill(name)
    await dialog.getByText('Make this the organization default group').click()
    await dialog.getByRole('button', { name: 'Create group', exact: true }).click()
    await expect(dialog).toBeHidden()
    await page.getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}`) }).click()
    await expect(page).toHaveURL(/group-id=/)
    await page.reload()
    await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue(name)
    await page.getByRole('button', { name: 'Delete', exact: true }).first().click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page).not.toHaveURL(/group-id=/)
    await expect(page.getByText(name)).toHaveCount(0)
  } finally {
    // While it stands it is the organization's default group, which governs every later check.
    await withLiveDatabase(
      (sql) =>
        sql`delete from permission_group where organization_id = ${organizationId()} and name = ${name}`
    )
  }
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
