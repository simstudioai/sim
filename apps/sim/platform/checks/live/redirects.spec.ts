import { expect } from '@playwright/test'
import { escapeRegExp } from '@sim/utils/string'
import {
  adminEmail,
  organizationId,
  organizationName,
  signInAsAdmin,
} from '@/platform/checks/live/session'
import { withLiveDatabase, withPerson } from '@/platform/checks/live/support/database'
import { firstHopFrom, pathOf } from '@/platform/checks/live/support/navigation'
import { liveRoute } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

/** Seeded workspaces (`scripts/platform-live-seed.ts`): one of the organization's, one outside it. */
const WORKSPACE_ID = 'platform-live-workspace-main'
const WORKSPACE = `/workspace/${WORKSPACE_ID}`
const OUTSIDE_WORKSPACE = '/workspace/platform-live-workspace-outside'
const SEEDED_CHAT = '11111111-1111-4111-8111-111111111111'

/** Saved links from before the product routes, each to where it now lands, query kept. */
const REDIRECTS: readonly (readonly [string, string])[] = [
  [liveRoute('/settings/team'), liveRoute('/settings/members')],
  [liveRoute('/settings/subscription?from=mail'), liveRoute('/settings/billing?from=mail')],
  [liveRoute('/links?search=hand'), liveRoute('/settings/links?search=hand')],
  [`${WORKSPACE}/w`, `${WORKSPACE}/workflows`],
  [`${WORKSPACE}/home`, liveRoute('/home')],
  // The upgrade prompt carries why it was shown and nothing else.
  [
    `${WORKSPACE}/upgrade?reason=credits&ref=x`,
    liveRoute('/settings/billing/plans?reason=credits'),
  ],
]

for (const [from, to] of REDIRECTS) {
  test(`a saved ${from} lands on ${to}`, async ({ page }) => {
    await signInAsAdmin(page, from)
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(to)}$`))
  })
}

/**
 * Saved workspace links that carry state in their query, including the shapes an OAuth provider
 * returns to: each must reach its new home in one move with that state intact, since a second hop
 * through another legacy route is where a query gets dropped.
 */
const QUERY_REDIRECTS: readonly (readonly [string, string])[] = [
  [
    `${WORKSPACE}/integrations?provider=google-email&oauth=connected`,
    liveRoute(`/integrations?provider=google-email&oauth=connected&workspace=${WORKSPACE_ID}`),
  ],
  [
    `${WORKSPACE}/integrations/connected/platform-live-grant-gmail?oauth=success`,
    liveRoute(
      `/integrations/accounts/platform-live-grant-gmail?oauth=success&workspace=${WORKSPACE_ID}`
    ),
  ],
  [`${WORKSPACE}/chat/${SEEDED_CHAT}?resource=r1`, liveRoute(`/chat/${SEEDED_CHAT}?resource=r1`)],
  [
    `${WORKSPACE}/skills?skillId=skill-1`,
    liveRoute(`/integrations?tab=skills&workspace=${WORKSPACE_ID}&resource=skill-1`),
  ],
  [`${WORKSPACE}/settings/apikeys?from=mail`, `${WORKSPACE}/settings/api-keys?from=mail`],
  [
    `${WORKSPACE}/access-requests?requestId=req-1`,
    `${WORKSPACE}/settings/requests?requestId=req-1`,
  ],
]

for (const [from, to] of QUERY_REDIRECTS) {
  test(`a saved ${from} reaches ${to} in one hop, query kept`, async ({ page }) => {
    await signInAsAdmin(page, liveRoute('/home'))
    expect(await firstHopFrom(page, from)).toBe(to)
  })
}

test('a saved link to a workspace the viewer cannot open is not found, naming no organization', async ({
  page,
}) => {
  await signInAsAdmin(page, liveRoute('/home'))
  // The shell paints before the page decides, so the not-found page arrives in a 200 response; a
  // root layout's notFound() would answer 404 with Next's unbranded page instead.
  const response = await page.goto(`${OUTSIDE_WORKSPACE}/home`)
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(OUTSIDE_WORKSPACE)}/home$`))
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  expect(await response?.text()).not.toContain(`${organizationId()}-outside`)
})

test('every legacy sub-path of a workspace the viewer cannot open is a branded not-found that names no organization', async ({
  page,
}) => {
  await signInAsAdmin(page, liveRoute('/home'))
  const outside = `${organizationId()}-outside`
  for (const path of [
    `${OUTSIDE_WORKSPACE}/integrations?oauth=connected`,
    `${OUTSIDE_WORKSPACE}/integrations/connected/platform-live-grant-gmail?oauth=success`,
    `${OUTSIDE_WORKSPACE}/chat/${SEEDED_CHAT}`,
    `${OUTSIDE_WORKSPACE}/skills?skillId=skill-1`,
    `${OUTSIDE_WORKSPACE}/settings/apikeys`,
    `${OUTSIDE_WORKSPACE}/access-requests?requestId=req-1`,
  ]) {
    const response = await page.goto(path)
    const hops: string[] = []
    for (let request = response?.request() ?? null; request; request = request.redirectedFrom()) {
      const location = (await request.response())?.headers().location
      if (location) hops.push(location)
    }
    expect(hops, `${path} redirected`).toEqual([])
    expect(pathOf(page.url()), `${path} moved`).toBe(path)
    await expect(page.getByRole('heading', { name: 'Page not found' }), path).toBeVisible()
    expect(await response?.text(), `${path} named the organization`).not.toContain(outside)
    expect(await page.content(), `${path} named the organization`).not.toContain(outside)
  }
})

test('an organization the viewer does not belong to is the branded not-found, not a failed read', async ({
  page,
}) => {
  await signInAsAdmin(page, liveRoute('/home'))
  const outside = `/o/${organizationId()}-outside`
  for (const route of ['/home', '/settings/members']) {
    await page.goto(`${outside}${route}`)
    await expect(page.getByRole('heading', { name: 'Page not found' }), route).toBeVisible()
  }
})

test('a guest on a workspace in no organization opens it in their own organization', async ({
  page,
}) => {
  await withPerson('orgless-owner', undefined, async (owner) => {
    const workspaceId = `${owner.id}-workspace`
    await withLiveDatabase((sql) =>
      sql.begin(async (tx) => {
        await tx`insert into project (id, name, owner_id) values (${workspaceId}, 'Orgless', ${owner.id})`
        await tx`insert into workspace (id, project_id, name, owner_id, billed_account_user_id, workspace_mode)
          values (${workspaceId}, ${workspaceId}, 'Orgless', ${owner.id}, ${owner.id}, 'personal')`
        await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type)
          values (${`${workspaceId}-owner`}, ${owner.id}, 'workspace', ${workspaceId}, 'admin'),
            (${`${workspaceId}-guest`}, (select id from "user" where email = ${adminEmail()}),
              'workspace', ${workspaceId}, 'write')`
      })
    )
    await signInAsAdmin(page, `/workspace/${workspaceId}/workflows`)
    await expect(page).toHaveURL(new RegExp(`/workspace/${escapeRegExp(workspaceId)}/workflows`))
    await expect(page.getByRole('button', { name: 'Organization menu' })).toContainText(
      organizationName()
    )
    expect(await firstHopFrom(page, `/workspace/${workspaceId}/home`)).toBe(liveRoute('/home'))
  })
})

test('the retired /org paths lead to the product home', async ({ page }) => {
  await signInAsAdmin(page, liveRoute('/home'))
  await page.goto('/org/settings/members')
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(liveRoute('/home'))}(?:\\?|$)`))
})

test('product pages carry the security headers', async ({ page }) => {
  await signInAsAdmin(page, liveRoute('/home'))
  const response = await page.goto(liveRoute('/home'))
  const headers = response?.headers() ?? {}
  expect(headers['content-security-policy']).toBeTruthy()
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['x-frame-options']).toBe('SAMEORIGIN')
})
