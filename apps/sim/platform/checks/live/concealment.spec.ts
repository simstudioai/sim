import { expect, type Page } from '@playwright/test'
import { generateId } from '@sim/utils/id'
import {
  adminEmail,
  memberEmail,
  organizationId,
  signIn,
  signInAsAdmin,
} from '@/platform/checks/live/session'
import { withLiveDatabase, withPerson } from '@/platform/checks/live/support/database'
import { liveRoute } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

/**
 * What the live app keeps out of reach. The live environment turns on the `dashboards`,
 * `changelog` and `workflow-tests` flags and leaves `platform-preview` off, as production does
 * (`.github/scripts/http-e2e.sh`), so whatever stays hidden here is hidden by `platform-preview`
 * alone.
 */
const WORKSPACE_ID = 'platform-live-workspace-main'
const WORKSPACE_NAME = 'Operations'
const PREVIEW_TABS = [
  ['dashboards', 'Dashboard'],
  ['changelog', 'Changelog'],
  ['tests', 'Tests'],
] as const

const notFound = (page: Page) => page.getByRole('heading', { name: 'Page not found' })

/** The organization Settings sections only an organization administrator may open. */
const ADMIN_SECTIONS = [
  'billing',
  'connected-accounts',
  'usage',
  'whitelabeling',
  'audit-logs',
  'access-control',
  'sso',
  'security',
  'data-retention',
  'data-drains',
  'integrations',
  'search-slack',
]

test('a member deep-linking to any admin section gets not found', async ({ page }) => {
  await signIn(page, memberEmail(), liveRoute('/settings'))
  for (const section of ADMIN_SECTIONS) {
    await page.goto(liveRoute(`/settings/${section}`))
    await expect(notFound(page), section).toBeVisible()
  }
})

test('a member who is not a platform administrator gets not found from the platform-admin sections', async ({
  page,
}) => {
  // An organization administrator, which is not a platform administrator.
  await signInAsAdmin(page, liveRoute('/settings'))
  const nav = page.getByRole('navigation', { name: 'Settings', exact: true })
  await expect(nav.getByRole('link', { name: 'General', exact: true })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0)
  for (const section of ['admin', 'mothership']) {
    await page.goto(liveRoute(`/settings/${section}`))
    await expect(notFound(page), section).toBeVisible()
  }
  // The same pages open for a platform administrator, so the not-found is the gate, not the page.
  await withPerson(
    'platform-admin',
    { organizationId: organizationId(), role: 'member' },
    async (person) => {
      await withLiveDatabase((sql) => sql`update "user" set role = 'admin' where id = ${person.id}`)
      await signIn(page, person.email, liveRoute('/settings/admin'))
      await expect(
        page.getByRole('heading', { name: 'Admin', exact: true, level: 1 })
      ).toBeVisible()
    }
  )
})

test.describe('with platform-preview off', () => {
  test('a workspace serves none of the preview tabs, from its tab row or a saved link', async ({
    page,
  }) => {
    await signInAsAdmin(page, `/workspace/${WORKSPACE_ID}/workflows`)
    const tabs = page.getByRole('navigation', { name: `${WORKSPACE_NAME} pages`, exact: true })
    await expect(tabs.getByRole('link', { name: 'Workflows', exact: true })).toBeVisible()
    for (const [section, label] of PREVIEW_TABS) {
      await expect(tabs.getByRole('link', { name: label, exact: true })).toHaveCount(0)
      await page.goto(`/workspace/${WORKSPACE_ID}/${section}`)
      await expect(notFound(page), section).toBeVisible()
    }
    await expect(tabs.getByRole('link', { name: 'Issues', exact: true })).toHaveCount(0)
  })

  test('Home reads and paints neither Needs your attention nor Workspaces', async ({ page }) => {
    const reads: string[] = []
    page.on('request', (request) => {
      const { pathname } = new URL(request.url())
      if (pathname.startsWith('/api/')) reads.push(pathname)
    })
    await signInAsAdmin(page, liveRoute('/home'))
    const main = page.getByRole('main')
    // Every section Home does show has read what it needs.
    for (const widget of ['Email', 'Calendar'])
      await expect(
        main.getByRole('region', { name: widget, exact: true }).getByText(/^Connect your /)
      ).toBeVisible()
    await expect(main.getByRole('region', { name: 'Tasks run', exact: true })).toBeVisible()
    await expect(main.getByRole('region', { name: 'Recents', exact: true })).toBeVisible()
    await expect(main.getByRole('region', { name: 'Needs your attention' })).toHaveCount(0)
    await expect(main.getByRole('region', { name: 'Workspaces', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Customize Home' }).click()
    await expect(page.getByRole('menuitemcheckbox', { name: 'Email', exact: true })).toBeVisible()
    await expect(
      page.getByRole('menuitemcheckbox', { name: 'Workspaces', exact: true })
    ).toHaveCount(0)
    await page.keyboard.press('Escape')
    expect(
      reads.filter(
        (path) =>
          path.endsWith('/home/workspace-activity') ||
          path === `/api/organizations/${organizationId()}/access-requests`
      )
    ).toEqual([])
  })

  test('the composer offers no dashboard the server lists', async ({ page }) => {
    const dashboardId = `platform-live-dashboard-${generateId()}`
    await withLiveDatabase(
      (sql) => sql`insert into dashboard (id, workspace_id, content, created_by)
        values (${dashboardId}, ${WORKSPACE_ID}, 'title: Live dashboard',
          (select id from "user" where email = ${adminEmail()}))`
    )
    try {
      await signInAsAdmin(page, liveRoute('/home'))
      const listed = page.waitForResponse(async (response) => {
        if (
          !new URL(response.url()).pathname.endsWith(`/organizations/${organizationId()}/mentions`)
        )
          return false
        const body = (await response.json()) as { rows?: { family: string; id: string }[] }
        return Boolean(
          body.rows?.some((row) => row.family === 'dashboards' && row.id === dashboardId)
        )
      })
      await page.getByRole('textbox', { name: /Ask about your business/ }).pressSequentially('@')
      // The server lists the dashboard; only the hidden tab keeps the picker from offering it.
      await listed
      await expect(page.getByRole('listbox').first()).toBeVisible()
      await expect(page.getByRole('option', { name: /^Dashboard\b/ })).toHaveCount(0)
      await expect(page.getByText('Dashboards', { exact: true })).toHaveCount(0)
    } finally {
      await withLiveDatabase((sql) => sql`delete from dashboard where id = ${dashboardId}`)
    }
  })
})
