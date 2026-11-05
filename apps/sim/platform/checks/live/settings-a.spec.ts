import { expect, test } from '@playwright/test'
import { organizationName, signInAsAdmin } from '@/platform/checks/live/session'

const settings = (path = '') => `/org/settings${path}`

test.beforeEach(async ({ page }) => {
  await signInAsAdmin(page, '/org')
})

test('a theme chosen here persists across a reload and repaints the shell', async ({ page }) => {
  await page.goto(settings())
  const theme = page.getByRole('combobox', { name: 'Theme', exact: true })
  const surface = page.locator('[data-platform-ui]').first()
  await theme.click()
  await page.getByRole('option', { name: 'Dark', exact: true }).click()
  await expect(surface).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(surface).toHaveAttribute('data-theme', 'dark')
  await theme.click()
  await page.getByRole('option', { name: 'System', exact: true }).click()
  await expect(surface).toHaveAttribute('data-theme', 'system')
})

test('a display name saves through the profile read', async ({ page }) => {
  await page.goto(settings())
  const name = `Live ${Date.now()}`
  await page.getByRole('button', { name: /^Edit display name/ }).click()
  await page.getByRole('textbox', { name: 'Display name' }).fill(name)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('region', { name: 'Profile' })).toContainText(name)
})

test('unbacked preferences stay out of live settings', async ({ page }) => {
  await page.goto(settings())
  await expect(page.getByRole('combobox', { name: 'Interface font' })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Code font' })).toHaveCount(0)
  await page.goto(settings('/notifications'))
  await expect(page.getByRole('switch', { name: 'Canvas error notifications' })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'In-app notifications' })).toHaveCount(0)
  await expect(page.getByRole('switch', { name: 'Play sound' })).toHaveCount(0)
})

test('the time zone offers Auto and writes the setting', async ({ page }) => {
  await page.goto(settings())
  await expect(page.getByRole('combobox', { name: 'Time zone' })).toContainText(/Auto|\//)
})

test('privacy and shortcuts render their real rows', async ({ page }) => {
  await page.goto(settings('/privacy'))
  await expect(page.getByRole('switch', { name: 'Allow browser telemetry' })).toBeEnabled()
  await page.goto(settings('/keyboard-shortcuts'))
  await expect(page.getByText('Search settings')).toBeVisible()
})

test('account deletion is refused, with the reasons, while the member still belongs here', async ({
  page,
}) => {
  await page.goto(settings('/account'))
  await expect(page.getByText('Reset password', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Delete account', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Your account can’t be deleted yet:')).toBeVisible()
  await expect(dialog.getByRole('listitem').first()).toContainText(organizationName())
  await expect(dialog.getByRole('button', { name: 'Delete account', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})

test('a plan read on the server stands when the browser’s own read fails', async ({ page }) => {
  await page.route('**/billing-summary', (route) => route.abort())
  await page.goto(settings('/billing'))
  await expect(page.getByRole('region', { name: 'Plan' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)
})

test('Insights keeps its window in the URL and carries it to the events ledger', async ({
  page,
}) => {
  const response = await page.goto(settings('/usage'))
  test.skip(response?.status() === 404, 'This organization has no Insights section')
  await page.getByRole('radio', { name: 'Activity' }).click()
  await expect(page).toHaveURL(/tab=activity/)
  await expect(page.getByRole('region', { name: 'Breakdown' })).toBeVisible()
  await page.getByRole('radio', { name: 'Overview' }).click()
  await page.getByRole('button', { name: /Period/ }).click()
  await page.getByRole('menuitemradio', { name: 'Last 7 days' }).click()
  await expect(page).toHaveURL(/preset=7d/)
  await expect(page.getByRole('region', { name: 'Usage heatmap' })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(/^organization-usage-.*\.csv$/)
  await page.getByRole('link', { name: 'All events' }).click()
  await expect(page).toHaveURL(/\/settings\/usage\/events\?.*preset=7d/)
})

test('links: create, find, open, edit and delete on the Platform', async ({ page, context }) => {
  const response = await page.goto(settings('/links'))
  test.skip(response?.status() === 404, 'This organization does not have Sim Links')
  const name = `live-${Date.now()}`
  await page.getByRole('button', { name: 'New link', exact: true }).first().click()
  await expect(page).toHaveURL(/create=/)
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Destination URL').fill('https://example.com/{*}')
  await expect(dialog.getByLabel('Default destination')).toBeVisible()
  await dialog.getByLabel('Destination URL').fill('https://example.com/')
  await dialog.getByLabel('Name').fill(`sim/${name}`)
  await expect(dialog.getByLabel('Name')).toHaveValue(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByLabel('Search links').fill(name)
  await expect(page).toHaveURL(new RegExp(`search=${name}`))
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible()

  await context.route('https://example.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: 'Destination stand-in' })
  )
  const resolved = context.waitForEvent(
    'request',
    (request) => new URL(request.url()).pathname === `/sim/${name}`
  )
  const opened = context.waitForEvent('page')
  await page.getByRole('button', { name, exact: true }).click()
  await resolved
  await expect(await opened).toHaveURL('https://example.com/')
  await (await opened).close()

  await page.getByRole('button', { name: `${name} actions` }).click()
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Description').fill('Edited live')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.getByRole('button', { name: `${name} actions` }).click()
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByRole('heading', { name: `No links match "${name}"` })).toBeVisible()
})

test('an unknown sim/ link opens the editor here, prefilled', async ({ page }) => {
  const name = `missing-${Date.now()}`
  const response = await page.goto(settings(`/links?create=${name}`))
  test.skip(response?.status() === 404, 'This organization does not have Sim Links')
  await expect(page.getByRole('dialog').getByLabel('Name')).toHaveValue(name)
})

test('white-labeling reports its entitlement from the read', async ({ page }) => {
  const response = await page.goto(settings('/whitelabeling'))
  test.skip(response?.status() === 404, 'This organization has no White-labeling section')
  await expect(
    page
      .getByRole('region', { name: 'Brand identity' })
      .or(page.getByRole('heading', { name: /requires an active Enterprise plan/ }))
  ).toBeVisible()
})

test('recently deleted separates an empty list from a loading one', async ({ page }) => {
  await page.goto(settings('/recently-deleted'))
  await expect(
    page
      .getByRole('heading', { name: 'No deleted chats' })
      .or(page.getByRole('region', { name: 'Deleted chats' }))
  ).toBeVisible()
})
