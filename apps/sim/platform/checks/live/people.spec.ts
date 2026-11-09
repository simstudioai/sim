import { expect, test } from '@playwright/test'
import {
  adminEmail,
  memberEmail,
  organizationId,
  signIn,
  signInAsAdmin,
} from '@/platform/checks/live/session'
import { liveRoute, liveRoutePattern } from '@/platform/checks/routes'

test('the directory filters, pages and opens a profile that returns to the same view', async ({
  page,
}) => {
  await signInAsAdmin(page, liveRoute('/people'))
  await expect(page.getByRole('heading', { name: 'People', level: 1 })).toBeVisible()
  await page
    .getByRole('navigation', { name: 'People view' })
    .getByRole('button', { name: 'Directory', exact: true })
    .click()
  const table = page.getByRole('table', { name: 'People' })
  await expect(table.getByRole('row').nth(1)).toBeVisible()

  const email = adminEmail()
  await page.getByRole('searchbox', { name: 'Search people' }).fill(email)
  await expect(page).toHaveURL(/search=/)
  await table.getByRole('row').nth(1).getByRole('link').first().click()
  await expect(page).toHaveURL(liveRoutePattern('/people', '/[^/?]+\\?.*search='))
  await page.getByRole('link', { name: 'Back to directory', exact: true }).click()
  await expect(page).toHaveURL(liveRoutePattern('/people', '\\?.*view=directory'))
  await expect(page.getByRole('searchbox', { name: 'Search people' })).toHaveValue(email)
})

test('the org chart opens, and an unknown focus says so', async ({ page }) => {
  await signInAsAdmin(page, liveRoute('/people?view=chart'))
  await expect(page.getByRole('heading', { name: 'People', level: 1 })).toBeVisible()
  await page.goto(liveRoute('/people?view=chart&focus=platform-live-missing'))
  await expect(page.getByRole('heading', { name: 'This profile is unavailable' })).toBeVisible()
})

test('a member withheld the directory gets no People, from the sidebar or a saved link', async ({
  page,
  browser,
  baseURL,
}) => {
  await signInAsAdmin(page, liveRoute('/home'))
  const groups = `/api/organizations/${organizationId()}/permission-groups`
  const created = await page.request.post(groups, {
    data: { name: 'Withhold directory', isDefault: true, config: { hideOrgMemberDirectory: true } },
  })
  expect(created.status(), await created.text()).toBeLessThan(300)
  const {
    permissionGroup: { id },
  } = (await created.json()) as { permissionGroup: { id: string } }
  const context = await browser.newContext({ baseURL })
  try {
    const member = await context.newPage()
    await signIn(member, memberEmail(), liveRoute(''))
    await expect(member.getByRole('button', { name: 'Organization menu' })).toBeVisible()
    await expect(member.getByRole('link', { name: 'People', exact: true })).toHaveCount(0)
    await member.goto(liveRoute('/people'))
    await expect(member.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  } finally {
    await context.close()
    expect((await page.request.delete(`${groups}/${id}`)).ok()).toBe(true)
  }
})
