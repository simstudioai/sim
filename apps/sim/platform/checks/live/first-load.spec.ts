import { expect } from '@playwright/test'
import { escapeRegExp } from '@sim/utils/string'
import { organizationId, seedSession, signIn, signInAsAdmin } from '@/platform/checks/live/session'
import { withLiveDatabase, withPerson } from '@/platform/checks/live/support/database'
import { liveRoute } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

/**
 * What a page's first load does on the server: the organization it provisions, the reads it seeds
 * into the document, and what it keeps out of it.
 */

test('two first page loads at once give an account in no organization exactly one personal organization', async ({
  browser,
  baseURL,
}) => {
  await withPerson('first-load', undefined, async (person) => {
    const contexts = await Promise.all([0, 1].map(() => browser.newContext({ baseURL })))
    try {
      const pages = await Promise.all(
        contexts.map(async (context) => {
          await context.addCookies([(await seedSession(person.email)).cookie])
          return context.newPage()
        })
      )
      await Promise.all(pages.map((page) => page.goto('/o')))
      for (const page of pages) await expect(page).toHaveURL(/\/o\/[^/?]+/)

      const memberships = await withLiveDatabase(
        (sql) => sql<{ organizationId: string; kind: string; role: string }[]>`
          select m.organization_id as "organizationId", o.kind, m.role
          from member m join organization o on o.id = m.organization_id
          where m.user_id = ${person.id}`
      )
      expect(memberships).toEqual([
        { organizationId: expect.any(String), kind: 'personal', role: 'owner' },
      ])
      const own = new RegExp(`/o/${escapeRegExp(memberships[0].organizationId)}(?:[/?]|$)`)
      for (const page of pages) await expect(page).toHaveURL(own)
    } finally {
      await Promise.all(contexts.map((context) => context.close()))
    }
  })
})

test('an account in no organization opening /home lands on Home in its own new organization', async ({
  page,
}) => {
  await withPerson('orgless-home', undefined, async (person) => {
    await signIn(page, person.email, '/home')
    await expect(page).toHaveURL(/\/o\/[^/?]+\/home(?:\?|$)/)
    const memberships = await withLiveDatabase(
      (sql) => sql<{ organizationId: string; kind: string; role: string }[]>`
        select m.organization_id as "organizationId", o.kind, m.role
        from member m join organization o on o.id = m.organization_id
        where m.user_id = ${person.id}`
    )
    expect(memberships).toEqual([
      { organizationId: expect.any(String), kind: 'personal', role: 'owner' },
    ])
    await expect(page).toHaveURL(
      new RegExp(`/o/${escapeRegExp(memberships[0].organizationId)}/home(?:\\?|$)`)
    )
  })
})

test('Search, Integrations and Links documents carry their first reads', async ({ page }) => {
  await signInAsAdmin(page, liveRoute('/home'))
  // Seeded rows only a server read can put in the document (`scripts/platform-live-seed.ts`).
  const firstReads = [
    [liveRoute('/search'), 'Renewal terms'],
    [liveRoute('/integrations'), 'platform-live-credential-group'],
    [liveRoute('/settings/links'), 'https://example.com/handbook'],
  ] as const
  for (const [route, seeded] of firstReads) {
    const response = await page.request.get(route)
    expect(response.status(), route).toBe(200)
    expect(await response.text(), `${route} paints without its first read`).toContain(seeded)
  }
})

test('a page document never carries the session token', async ({ page }) => {
  const { token } = await signInAsAdmin(page, liveRoute('/home'))
  for (const route of [liveRoute('/home'), liveRoute('/settings'), liveRoute('/search')]) {
    const response = await page.request.get(route)
    expect(response.status(), route).toBe(200)
    const html = await response.text()
    expect(html, `${route} lost its organization`).toContain(organizationId())
    expect(html, `${route} carries the session token`).not.toContain(token)
  }
})
