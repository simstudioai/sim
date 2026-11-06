import assert from 'node:assert/strict'
import type { Page } from '@playwright/test'
import { ADMIN, MEMBER } from '@/scripts/org-redesign-e2e/fixture'
import {
  check,
  expect,
  orgUrl,
  pathOf,
  refused,
  section,
  withSession,
} from '@/scripts/org-redesign-e2e/harness'

export async function realtimeChecks() {
  section('Realtime')
  /** Socket.IO acknowledges an authenticated connection with a `40` packet. */
  const trackSocketConnected = (page: Page) => {
    const connection = { connected: false }
    page.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload }) => {
        if (socket.url().includes('/socket.io/') && String(payload).startsWith('40'))
          connection.connected = true
      })
    })
    return connection
  }
  await check('a signed-in page mints a real token and its socket connects', async () => {
    await withSession(
      MEMBER,
      async ({ page }) => {
        const connection = trackSocketConnected(page)
        const minted = page.waitForResponse(
          (response) => pathOf(response.url()) === '/api/auth/socket-token'
        )
        await page.goto(orgUrl('/home'))
        assert.equal((await minted).status(), 200)
        await expect.poll(() => connection.connected).toBe(true)
      },
      { realtime: true }
    )
  })
  await check(
    'a refused token waits out its Retry-After, then the socket connects',
    async () => {
      await withSession(
        ADMIN,
        async ({ page }) => {
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
          await page.goto(orgUrl('/home'))
          await expect.poll(() => connection.connected).toBe(true)
          assert(
            attempts[1] - attempts[0] >= 2_000,
            `Retried after ${attempts[1] - attempts[0]}ms against a Retry-After of 2s`
          )
        },
        { realtime: true }
      )
    },
    { allow: [refused(429, 'POST', '/api/auth/socket-token')] }
  )
}
