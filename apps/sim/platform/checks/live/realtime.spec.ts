import { expect, type Page } from '@playwright/test'
import { memberEmail, signIn, signInAsAdmin } from '@/platform/checks/live/session'
import { test } from '@/platform/checks/test'

/**
 * The realtime server the job starts beside the app (`.github/scripts/http-e2e.sh`). The workspace
 * layout mounts the socket its tabs share; organization pages open none.
 */
const WORKSPACE_PAGE = '/workspace/platform-live-workspace-main/workflows'

/** Socket.IO acknowledges an authenticated connection with a `40` packet. */
function trackSocketConnected(page: Page) {
  const connection = { connected: false }
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      if (socket.url().includes('/socket.io/') && String(payload).startsWith('40'))
        connection.connected = true
    })
  })
  return connection
}

test('a workspace page mints a real token and its socket connects', async ({ page }) => {
  const connection = trackSocketConnected(page)
  const minted = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/auth/socket-token'
  )
  await signIn(page, memberEmail(), WORKSPACE_PAGE)
  expect((await minted).status()).toBe(200)
  await expect.poll(() => connection.connected).toBe(true)
})

test('a refused token waits out its Retry-After, then the socket connects', async ({ page }) => {
  const connection = trackSocketConnected(page)
  const attempts: number[] = []
  await page.route('**/api/auth/socket-token', async (route) => {
    attempts.push(Date.now())
    if (attempts.length > 1) return route.fallback()
    await route.fulfill({
      status: 429,
      headers: { 'retry-after': '2' },
      json: { error: 'Too many requests' },
    })
  })
  await signInAsAdmin(page, WORKSPACE_PAGE)
  await expect.poll(() => connection.connected).toBe(true)
  // A lower bound in the runner's time: the page cannot ask again sooner than it was told to.
  expect(attempts[1] - attempts[0]).toBeGreaterThanOrEqual(2_000)
})
