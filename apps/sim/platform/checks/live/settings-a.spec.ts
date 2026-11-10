import { expect } from '@playwright/test'
import {
  adminEmail,
  organizationId,
  organizationName,
  signIn,
  signInAsAdmin,
} from '@/platform/checks/live/session'
import { withLiveDatabase, withPerson } from '@/platform/checks/live/support/database'
import { liveRoute } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

const settings = (path = '') => liveRoute(`/settings${path}`)

// Settings itself, not the bare organization URL: that one renders, then redirects in the browser,
// and the redirect aborts a navigation a test starts before it lands.
test.beforeEach(async ({ page }) => {
  await signInAsAdmin(page, settings())
})

test('a theme chosen here persists across a reload and repaints the shell', async ({ page }) => {
  await page.goto(settings())
  const theme = page.getByRole('button', { name: /^Theme:/ })
  const surface = page.locator('[data-platform-ui]').first()
  try {
    await theme.click()
    await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click()
    await expect(surface).toHaveAttribute('data-theme', 'dark')
    await page.reload()
    await expect(surface).toHaveAttribute('data-theme', 'dark')
    await theme.click()
    await page.getByRole('menuitemradio', { name: 'System', exact: true }).click()
    await expect(surface).toHaveAttribute('data-theme', 'system')
  } finally {
    // Every later check, and its screenshots, paints in the seeded System theme.
    await withLiveDatabase(
      (sql) => sql`update settings set theme = 'system'
        where user_id = (select id from "user" where email = ${adminEmail()})`
    )
  }
})

test('a display name saves through the profile read', async ({ page }) => {
  await page.goto(settings())
  const name = `Live ${Date.now()}`
  try {
    // The row's button is named by the value it edits: the seeded name, or an earlier run's.
    await page
      .getByRole('region', { name: 'Profile' })
      .getByRole('button', { name: /^(?:Ada Admin|Live \d+)$/ })
      .click()
    await page
      .getByRole('dialog', { name: 'Edit display name' })
      .getByRole('textbox', { name: 'Display name' })
      .fill(name)
    const [saved] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          new URL(response.url()).pathname === '/api/users/me/profile'
      ),
      page.getByRole('button', { name: 'Save', exact: true }).click(),
    ])
    expect(saved.ok(), 'the profile write was refused').toBe(true)
    await page.reload()
    await expect(page.getByRole('region', { name: 'Profile' })).toContainText(name)
  } finally {
    // Home greets the administrator by the seeded first name.
    await withLiveDatabase(
      (sql) => sql`update "user" set name = 'Ada Admin' where email = ${adminEmail()}`
    )
  }
})

test('unbacked preferences stay out of live settings', async ({ page }) => {
  await page.goto(settings())
  // The backed row first, so the absences below are read from a painted section.
  await expect(page.getByRole('switch', { name: 'Canvas error notifications' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Interface font' })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Code font' })).toHaveCount(0)
  await expect(page.getByRole('switch', { name: 'In-app notifications' })).toHaveCount(0)
  await expect(page.getByRole('switch', { name: 'Play sound' })).toHaveCount(0)
})

test('the time zone row reads Auto or a saved zone', async ({ page }) => {
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
  await page.clock.install()
  await page.route('**/billing-summary', (route) => route.abort())
  const failedReads: string[] = []
  page.on('requestfailed', (request) => {
    if (request.url().includes('/billing-summary')) failedReads.push(request.url())
  })
  await page.goto(settings('/billing'))
  await expect(page.getByText('Enterprise plan')).toBeVisible()
  // The server's read is fresh for 30 seconds and the web app does not refetch on focus, so the
  // browser reads it itself only once it is stale and the connection comes back.
  await page.clock.fastForward('00:31')
  await page.context().setOffline(true)
  await page.context().setOffline(false)
  // The read and its one retry (`shouldRetrySettingsRead`) both fail before the outcome is read.
  await expect
    .poll(() => failedReads.length, 'the browser never gave up on its read')
    .toBeGreaterThanOrEqual(2)
  await expect(page.getByRole('region', { name: 'Subscription' })).toBeVisible()
  await expect(page.getByText('Enterprise plan')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)
})

test('Insights keeps its window in the URL and carries it to the events ledger', async ({
  page,
}) => {
  const response = await page.goto(settings('/usage'))
  expect(response?.status(), 'hosted Enterprise serves Insights').toBe(200)
  const activity = page.getByRole('radio', { name: 'Activity' })
  await activity.click()
  // The tab commits to the URL once React has taken the choice; a URL read first can race it.
  await expect(activity).toBeChecked()
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
  expect(response?.status(), 'the live environment turns Sim Links on').toBe(200)
  const name = `live-${Date.now()}`
  await page.getByRole('button', { name: 'New link', exact: true }).first().click()
  await expect(page).toHaveURL(/create=/)
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Destination URL').fill('https://example.com/{*}')
  await expect(dialog.getByLabel('Default destination')).toBeVisible()
  await dialog.getByLabel('Destination URL').fill('https://example.com/')
  await dialog.getByLabel('Name').fill(`sim/${name}`)
  await expect(dialog.getByLabel('Name')).toHaveValue(name)
  await dialog.getByRole('button', { name: 'Create link', exact: true }).click()
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
  await expect(page.getByRole('heading', { name: `No results for “${name}”` })).toBeVisible()
})

test('an unknown sim/ link opens the editor here, prefilled', async ({ page }) => {
  const name = `missing-${Date.now()}`
  const response = await page.goto(settings(`/links?create=${name}`))
  expect(response?.status(), 'the live environment turns Sim Links on').toBe(200)
  await expect(page.getByRole('dialog').getByLabel('Name')).toHaveValue(name)
})

test('white-labeling reports its entitlement from the read', async ({ page }) => {
  const response = await page.goto(settings('/whitelabeling'))
  expect(response?.status(), 'hosted Enterprise serves White-labeling').toBe(200)
  // The seeded organization holds an active Enterprise subscription.
  await expect(page.getByRole('region', { name: 'Brand identity' })).toBeVisible()
})

test('recently deleted lists the seeded deleted chat, and says so when there is none', async ({
  page,
}) => {
  await page.goto(settings('/recently-deleted'))
  // `scripts/platform-live-seed.ts` deletes the administrator's Retired plan; no check restores it.
  await expect(
    page.getByRole('region', { name: 'Deleted chats' }).getByText('Retired plan', { exact: true })
  ).toBeVisible()
  await withPerson(
    'nothing-deleted',
    { organizationId: organizationId(), role: 'admin' },
    async (person) => {
      await signIn(page, person.email, settings('/recently-deleted'))
      await expect(page.getByRole('heading', { name: 'No deleted chats' })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Deleted chats' })).toHaveCount(0)
    }
  )
})
