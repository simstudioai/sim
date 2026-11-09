import assert from 'node:assert/strict'
import type { Page } from '@playwright/test'
import { workspaceEntry } from '@/lib/navigation/paths'
import { ADMIN, MEMBER, MEMBER_ADMIN_WORKSPACE } from '@/scripts/org-redesign-e2e/fixture'
import {
  check,
  expect,
  pathOf,
  refused,
  section,
  url,
  withSession,
} from '@/scripts/org-redesign-e2e/harness'

/** The workspace layout mounts the socket its tabs share; organization pages open none. */
const realtimePage = url(workspaceEntry(MEMBER_ADMIN_WORKSPACE.id))

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
  await check('a workspace page mints a real token and its socket connects', async () => {
    await withSession(
      MEMBER,
      async ({ page }) => {
        const connection = trackSocketConnected(page)
        const minted = page.waitForResponse(
          (response) => pathOf(response.url()) === '/api/auth/socket-token'
        )
        await page.goto(realtimePage)
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
          await page.goto(realtimePage)
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
