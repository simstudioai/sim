import { expect, type Page } from '@playwright/test'
import { memberEmail, organizationId, signIn, signInAsAdmin } from '@/platform/checks/live/session'
import { test } from '@/platform/checks/test'

/** Where the organization surface ends: workspace pages and the extension panel read none of Home. */
const WORKSPACE_ID = '5e1d7c3a-0b6f-4a2e-9c41-7d8e0f1a2b01'
const WORKSPACE_NAME = 'Operations'
/** The tabs every live workspace serves whatever the rollout flags say (`WORKSPACE_TABS`). */
const LIVE_WORKSPACE_TABS = ['Logs', 'Tables', 'Files', 'Knowledge bases', 'Workflows', 'Settings']
/** Reads only organization Home makes: its widgets and its activity chart. */
const HOME_READ = /\/home\/|\/usage\/activity/

/** The API reads `page` sends from now on, by path. */
function recordReads(page: Page) {
  const reads: string[] = []
  page.on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (pathname.startsWith('/api/')) reads.push(pathname)
  })
  return reads
}

test('a workspace opens on Workflows in the shared shell, with its tabs and no Home reads', async ({
  page,
}) => {
  const reads = recordReads(page)
  await signInAsAdmin(page, `/workspace/${WORKSPACE_ID}`)
  await expect(page).toHaveURL((url) => url.pathname === `/workspace/${WORKSPACE_ID}/workflows`)
  await expect(page.getByRole('complementary', { name: 'Platform sidebar' })).toBeVisible()
  const tabs = page.getByRole('navigation', { name: `${WORKSPACE_NAME} pages`, exact: true })
  for (const label of LIVE_WORKSPACE_TABS)
    await expect(tabs.getByRole('link', { name: label, exact: true })).toBeVisible()
  // Issues has no backend, so live workspaces hide its tab.
  await expect(tabs.getByRole('link', { name: 'Issues', exact: true })).toHaveCount(0)
  expect(reads.filter((path) => HOME_READ.test(path))).toEqual([])
})

test('the extension panel has no platform surface and reads no Home data', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 })
  // Opened outside the extension's frame, where a chrome-extension target has no meaning.
  await page.addInitScript(() => {
    const post = window.postMessage.bind(window)
    window.postMessage = ((...args: Parameters<typeof post>) => {
      if (!String(args[1]).startsWith('chrome-extension://')) post(...args)
    }) as typeof window.postMessage
  })
  const reads = recordReads(page)
  await signIn(page, memberEmail(), `/extension/o/${organizationId()}`)
  // The panel keeps its own composer, outside the product shell.
  await expect(page.getByRole('textbox', { name: 'Ask Sim' })).toBeVisible()
  await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Email', exact: true })).toHaveCount(0)
  expect(reads.filter((path) => HOME_READ.test(path))).toEqual([])
  const createLink = await page.goto('/extension/create-link')
  expect(createLink?.status(), 'the create-link panel').toBe(200)
  await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
})
