import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { ADMIN, OUTSIDER, STANDARD_GROUP_ID } from '@/scripts/org-redesign-e2e/fixture'
import {
  artifactDirectory,
  asPlatformAdmin,
  check,
  DESKTOP,
  expect,
  orgUrl,
  type Persona,
  PHONE,
  section,
  sql,
  withSession,
} from '@/scripts/org-redesign-e2e/harness'
import { expectPageNotFound, openOrgCard } from '@/scripts/org-redesign-e2e/locators'

interface StateShot {
  name: string
  path: string
  /** Before the page loads, for a read this suite has no upstream for. */
  stub?: (page: Page) => Promise<void>
  /** Opens the state after the page loads. */
  open?: (page: Page) => Promise<void>
  /** On a phone, where the sidebar sits behind the navigation toggle. */
  openOnPhone?: (page: Page) => Promise<void>
  /** A state the phone layout does not have. */
  desktopOnly?: boolean
  persona?: Persona
}

const STATE_SHOTS: readonly StateShot[] = [
  { name: 'settings-admin', path: 'settings/admin?q=member' },
  {
    name: 'settings-mothership',
    path: 'settings/mothership',
    // The proxy needs an upstream and super admin mode; the page's own gate is what the shot shows.
    stub: async (page) => {
      await page.route('**/api/admin/mothership**', (route) =>
        route.fulfill({
          json: {
            total_requests: 3,
            total_users: 1,
            count: 1,
            users: [
              {
                user_id: 'user-1',
                request_count: 3,
                total_cost: 0.25,
                last_request: '2026-11-05T10:00:00.000Z',
              },
            ],
            requests: [
              {
                request_id: 'request-1',
                model: 'claude-model',
                duration_ms: 1200,
                billed_total_cost: 0.25,
                tool_call_count: 1,
                error: false,
                aborted: false,
                created_at: '2026-11-05T10:00:00.000Z',
              },
            ],
          },
        })
      )
    },
  },
  { name: 'not-found', path: 'settings/does-not-exist' },
  {
    name: 'collapsed-sidebar',
    path: 'home',
    desktopOnly: true,
    open: (page) => page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click(),
  },
  {
    name: 'menu-row-actions',
    path: 'settings/members',
    open: (page) =>
      page
        .getByRole('button', { name: /^Actions for / })
        .first()
        .click(),
  },
  {
    name: 'flyout-organization',
    path: 'home',
    open: async (page) => {
      await openOrgCard(page)
    },
    openOnPhone: async (page) => {
      await page
        .getByRole('button', { name: /open (sidebar|menu|navigation)/i })
        .first()
        .click()
      await openOrgCard(page)
    },
  },
  {
    name: 'modal-invite',
    path: 'settings/members',
    open: (page) => page.getByRole('button', { name: 'Invite', exact: true }).click(),
  },
  {
    name: 'modal-create-group',
    path: 'settings/access-control',
    open: (page) => page.getByRole('button', { name: 'Create group', exact: true }).click(),
  },
  {
    name: 'modal-add-source',
    path: 'settings/integrations',
    open: (page) => page.getByRole('button', { name: 'Add source', exact: true }).click(),
  },
  {
    name: 'modal-add-user',
    path: 'settings/admin',
    open: (page) => page.getByRole('button', { name: 'Add user', exact: true }).click(),
  },
]

/** States a route walk never reaches. A shot that cannot open is a failure, not a missing file. */
export async function stateScreenshots() {
  section('State screenshots')
  for (const viewport of [DESKTOP, PHONE]) {
    await check(`${viewport.name}: states capture`, () =>
      asPlatformAdmin(async () => {
        const failures: string[] = []
        // The fixture's default group forbids invitations, and the invite modal is a state to shoot.
        await sql`update permission_group set config = config - 'disableInvitations' where id = ${STANDARD_GROUP_ID}`
        try {
          for (const shot of STATE_SHOTS) {
            if (shot.desktopOnly && viewport === PHONE) continue
            await withSession(
              shot.persona ?? ADMIN,
              async (session) => {
                await shot.stub?.(session.page)
                const response = await session.page.goto(orgUrl(`/${shot.path}`), {
                  timeout: 60_000,
                })
                await session.contentReady()
                if (shot.name === 'not-found') await expectPageNotFound(session.page)
                else
                  assert(
                    (response?.status() ?? 500) < 400,
                    `${shot.path} answered ${response?.status()}`
                  )
                const open = viewport === PHONE ? (shot.openOnPhone ?? shot.open) : shot.open
                await open?.(session.page)
                // A heading too narrow for its word breaks mid-word, the failure a role check misses.
                const broken = await session.page.getByRole('columnheader').evaluateAll((cells) =>
                  cells.flatMap((cell) => {
                    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
                    const words: string[] = []
                    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                      const text = node.textContent ?? ''
                      for (const match of text.matchAll(/\S+/g)) {
                        const range = document.createRange()
                        range.setStart(node, match.index ?? 0)
                        range.setEnd(node, (match.index ?? 0) + match[0].length)
                        const lines = new Set(
                          [...range.getClientRects()].map((rect) => Math.round(rect.top))
                        )
                        if (lines.size > 1) words.push(match[0])
                      }
                    }
                    return words
                  })
                )
                assert.deepEqual(broken, [], `${shot.name}: column headings break mid-word`)
                await sleep(200)
                await session.page.screenshot({
                  path: resolve(artifactDirectory, `state__${shot.name}__${viewport.name}.png`),
                  animations: 'disabled',
                  timeout: 20_000,
                })
              },
              { viewport, theme: 'light' }
            ).catch((error) => failures.push(`${shot.name}: ${getErrorMessage(error)}`))
          }
        } finally {
          await sql`update permission_group set config = config || '{"disableInvitations":true}'::jsonb where id = ${STANDARD_GROUP_ID}`
        }
        await withSession(
          OUTSIDER,
          async (session) => {
            await session.page.goto(orgUrl('/home'), { timeout: 60_000 })
            await expect(
              session.page.getByRole('link', { name: 'View your workspaces' })
            ).toBeVisible()
            await session.page.screenshot({
              path: resolve(artifactDirectory, `state__access-denied__${viewport.name}.png`),
              timeout: 20_000,
            })
          },
          { viewport, theme: 'light' }
        ).catch((error) => failures.push(`access-denied: ${getErrorMessage(error)}`))
        assert.deepEqual(failures, [])
      })
    )
  }
}
