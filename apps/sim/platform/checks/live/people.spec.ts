import { expect, test } from '@playwright/test'
import {
  adminEmail,
  memberEmail,
  organizationId,
  signIn,
  signInAsAdmin,
} from '@/platform/checks/live/session'

/** `PLATFORM_LIVE_EMAIL` is an administrator in an organization with the `people` flag on. */

test('the directory filters, pages and opens a profile that returns to the same view', async ({
  page,
}) => {
  await signInAsAdmin(page, '/org/people')
  await expect(page.getByRole('heading', { name: 'People', level: 1 })).toBeVisible()
  await page.getByRole('radio', { name: 'Directory' }).check({ force: true })
  const table = page.getByRole('table', { name: 'People' })
  await expect(table.getByRole('row').nth(1)).toBeVisible()

  const email = adminEmail()
  await page.getByRole('searchbox', { name: 'Search people' }).fill(email)
  await expect(page).toHaveURL(/search=/)
  await table.getByRole('row').nth(1).getByRole('button').first().click()
  await expect(page).toHaveURL(/\/org\/people\/[^/?]+\?.*search=/)
  await page.getByRole('main').getByRole('link', { name: 'People' }).first().click()
  await expect(page).toHaveURL(/\/org\/people\?.*view=directory/)
  await expect(page.getByRole('searchbox', { name: 'Search people' })).toHaveValue(email)
})

test('the chart reads without a canvas and an unknown focus says so', async ({ page }) => {
  await signInAsAdmin(page, '/org/people?view=chart')
  await expect(page.getByRole('heading', { name: 'People', level: 1 })).toBeVisible()
  await expect(page.locator('.react-flow')).toHaveCount(0)
  await page.goto('/org/people?view=chart&focus=platform-live-missing')
  await expect(page.getByRole('heading', { name: 'Person unavailable' })).toBeVisible()
})

test('a member withheld the directory gets no People, from the sidebar or a saved link', async ({
  page,
  browser,
  baseURL,
}) => {
  await signInAsAdmin(page, '/org/home')
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
    await signIn(member, memberEmail(), '/org')
    await expect(member.getByRole('button', { name: 'Organization menu' })).toBeVisible()
    await expect(member.getByRole('link', { name: 'People', exact: true })).toHaveCount(0)
    await member.goto('/org/people')
    await expect(member.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  } finally {
    await context.close()
    expect((await page.request.delete(`${groups}/${id}`)).ok()).toBe(true)
  }
})
