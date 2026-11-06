import { expect, type Page, test } from '@playwright/test'
import {
  adminEmail,
  memberEmail,
  organizationId,
  organizationName,
  signIn,
  signInThroughForm,
} from '@/platform/checks/live/session'

test('signing in through the zone lands on a shell showing the real organization', async ({
  page,
}) => {
  await page.goto('/org')
  await expect(page).toHaveURL(/\/login\?.*callbackUrl=%2Forg/)
  await signInThroughForm(page, adminEmail(), '/org')

  await expect(page).toHaveURL(/\/org(?:\/|$)/)
  await expect(page.getByRole('button', { name: 'Organization menu' })).toContainText(
    organizationName()
  )
})

async function open(page: Page, email: string) {
  await signIn(page, email, '/org')
  await expect(page.getByRole('button', { name: 'Organization menu' })).toBeVisible()
}

const openAsAdmin = (page: Page) => open(page, adminEmail())

test('an organization admin can rename the organization inline, and the name survives a reload', async ({
  page,
}) => {
  const original = organizationName()
  const renamed = `${original} renamed`
  await openAsAdmin(page)
  const menu = page.getByRole('button', { name: 'Organization menu' })

  async function rename(name: string) {
    await menu.click()
    await page.getByRole('button', { name: 'Rename organization' }).click()
    await page.getByRole('textbox', { name: 'Organization name' }).fill(name)
    await page.getByRole('textbox', { name: 'Organization name' }).press('Enter')
    await expect(menu).toContainText(name)
    await page.keyboard.press('Escape')
  }

  await rename(renamed)
  await page.reload()
  await expect(menu).toContainText(renamed)
  await rename(original)
})

test('a member sees no identity controls, and the server refuses the rename anyway', async ({
  page,
}) => {
  await open(page, memberEmail())

  await page.getByRole('button', { name: 'Organization menu' }).click()
  const card = page.getByRole('dialog', { name: 'Organization menu' })
  await expect(card.getByRole('button', { name: 'Settings' })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Invite' })).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Rename organization' })).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Change organization logo' })).toHaveCount(0)

  const rename = await page.request.put(`/api/organizations/${organizationId()}`, {
    data: { name: 'Not allowed' },
  })
  expect(rename.status()).toBe(403)
})

test('navigation lists what the surface grants, and leaves for legacy routes in a full navigation', async ({
  page,
}) => {
  await openAsAdmin(page)
  const surfaceResponse = await page.request.get('/api/organizations/surface')
  const surface = (await surfaceResponse.json()) as {
    mothershipAvailable: boolean
    canBuild: boolean
    searchAccess: { memberScoped: boolean }
    navFlags: { people: boolean; benchmark: boolean }
  }
  const nav = page.getByRole('navigation', { name: 'Main navigation' })
  const granted: Record<string, boolean> = {
    Home: surface.mothershipAvailable && surface.canBuild,
    Search: surface.searchAccess.memberScoped,
    People: surface.navFlags.people,
    Integrations: surface.searchAccess.memberScoped,
    Benchmark: surface.navFlags.benchmark,
  }
  for (const [label, visible] of Object.entries(granted)) {
    await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(visible ? 1 : 0)
  }

  await nav.getByRole('link', { name: 'Home', exact: true }).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Open in new tab' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Copy link' })).toBeVisible()
  await page.keyboard.press('Escape')
})

test('creating a workspace opens it on the legacy surface', async ({ page }) => {
  await openAsAdmin(page)
  const name = `Live check ${Date.now()}`
  await page
    .getByRole('region', { name: 'Workspaces', exact: true })
    .getByRole('button', { name: 'Add workspace' })
    .click()
  await page.getByRole('textbox', { name: 'Workspace name' }).fill(name)
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page).toHaveURL(/\/workspace\/[^/]+/)
})

test('a chat renames and deletes through the real API', async ({ page }) => {
  await openAsAdmin(page)
  const created = await page.request.post('/api/mothership/chats', {
    data: { organizationId: organizationId() },
  })
  expect(created.ok()).toBe(true)
  const { id } = (await created.json()) as { id: string }
  const title = `Live chat ${Date.now()}`

  await page.reload()
  const chats = page.getByRole('region', { name: 'Chats', exact: true })
  const row = chats.locator(`a[href$="/chat/${id}"]`)
  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.getByRole('textbox', { name: 'Chat name' }).fill(title)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(chats.getByRole('link', { name: title })).toBeVisible()

  await page.reload()
  await expect(chats.getByRole('link', { name: title })).toBeVisible()

  await chats.getByRole('link', { name: title }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page
    .getByRole('dialog', { name: 'Delete chat' })
    .getByRole('button', { name: 'Delete', exact: true })
    .click()
  await expect(chats.getByRole('link', { name: title })).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('button', { name: 'Organization menu' })).toBeVisible()
  await expect(chats.getByRole('link', { name: title })).toHaveCount(0)
})

test('sign out ends the session and the zone returns to login', async ({ page }) => {
  await signInThroughForm(page, adminEmail(), '/org')
  const footer = page.getByRole('complementary', { name: 'Platform sidebar' }).locator('footer')
  await footer.getByRole('button').first().click()
  await page
    .getByRole('dialog', { name: 'Account menu' })
    .getByRole('button', { name: 'Sign out' })
    .click()
  await expect(page).toHaveURL(/\/login/)
  await page.goto('/org')
  await expect(page).toHaveURL(/\/login\?.*callbackUrl=%2Forg/)
})
