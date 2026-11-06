import assert from 'node:assert/strict'
import type { Locator, Page } from '@playwright/test'
import {
  ADMIN,
  MEMBER,
  MEMBER_ADMIN_WORKSPACE,
  NAMED_LINKS,
  ORGANIZATION_ID,
} from '@/scripts/org-redesign-e2e/fixture'
import {
  check,
  expect,
  firstPaints,
  onHome,
  orgUrl,
  section,
  withSession,
} from '@/scripts/org-redesign-e2e/harness'
import { composer, searchField } from '@/scripts/org-redesign-e2e/locators'

const PREFETCHED_ON_LAYOUT = [
  { label: 'chat list', pattern: /^\/api\/mothership\/chats\?(?=.*organizationId=)/ },
  { label: 'profile', pattern: /^\/api\/users\/me\/profile/ },
  { label: 'workspace list', pattern: /^\/api\/workspaces(\?|$)/ },
]
const PREFETCHED_INVENTORY = [
  { label: 'connected accounts', pattern: /\/connected-accounts(\?|$)/ },
  { label: 'search integrations', pattern: /\/api\/knowledge\/sim-search\/integrations/ },
]
const PREFETCHED_HISTORY = [{ label: 'search history', pattern: /\/search\/history(\?|$)/ }]
const PREFETCHED_SECRET_SOURCE = [
  { label: 'secret source', pattern: /\/secrets\/source|\/secret-source/ },
]
const PREFETCHED_LINKS = [{ label: 'links first page', pattern: /\/sim-links(\?(?!.*cursor=)|$)/ }]

/** The composer's lists: about a dozen for each workspace, so they wait until someone asks. */
const PER_WORKSPACE_READ = [
  /^\/api\/skills\?/,
  /^\/api\/workflows\?/,
  /^\/api\/table\?/,
  /^\/api\/workspaces\/[^/]+\/files/,
  /^\/api\/knowledge\?/,
  /^\/api\/folders\?/,
  /^\/api\/mothership\/chats\?(?=.*workspaceId=)/,
  /^\/api\/permission-groups\/user/,
  /^\/api\/logs\?/,
]
const isPerWorkspaceRead = (path: string) => PER_WORKSPACE_READ.some((read) => read.test(path))

export async function firstPaintChecks() {
  section('6 First paint')
  const pages = [
    {
      name: 'Home',
      path: 'home',
      primary: (page: Page) => composer(page),
      prefetched: [...PREFETCHED_ON_LAYOUT, ...PREFETCHED_INVENTORY, ...PREFETCHED_HISTORY],
    },
    {
      name: 'Search',
      path: 'search?mode=search',
      primary: (page: Page) => searchField(page),
      prefetched: [...PREFETCHED_ON_LAYOUT, ...PREFETCHED_HISTORY],
    },
    {
      name: 'Integrations',
      path: 'integrations',
      primary: (page: Page) => page.getByRole('link', { name: /^Gmail/ }),
      prefetched: [...PREFETCHED_ON_LAYOUT, ...PREFETCHED_INVENTORY, ...PREFETCHED_SECRET_SOURCE],
    },
    {
      name: 'Links',
      path: 'links',
      primary: (page: Page) => page.getByRole('row').nth(1),
      prefetched: [...PREFETCHED_ON_LAYOUT, ...PREFETCHED_LINKS],
    },
    {
      name: 'Links by opens',
      path: 'links?sort=popular&dir=desc',
      primary: (page: Page) => page.getByRole('row').nth(1),
      prefetched: [...PREFETCHED_ON_LAYOUT, ...PREFETCHED_LINKS],
    },
  ] satisfies {
    name: string
    path: string
    primary: (page: Page) => Locator
    prefetched: { label: string; pattern: RegExp }[]
  }[]
  await check(
    'an admin composer reads no workspace list until its menu opens, then the menu fills',
    async () => {
      await withSession(ADMIN, async (session) => {
        const { page } = session
        await page.goto(orgUrl('/home'))
        await composer(page).first().waitFor({ timeout: 30_000 })
        await session.settle()
        const reads = () =>
          session.requests.map(({ path }) => path).filter((path) => isPerWorkspaceRead(path))
        assert.deepEqual(reads(), [], 'The composer read every workspace on load')
        await page.getByRole('button', { name: 'Add resources' }).click()
        const menu = page.getByRole('menu')
        await expect(
          menu.getByRole('menuitem', { name: MEMBER_ADMIN_WORKSPACE.name })
        ).toBeVisible()
        await expect.poll(() => reads().length).toBeGreaterThan(0)
        await session.settle()
        await expect(menu.getByText('Loading resources')).toHaveCount(0)
        await menu.getByPlaceholder('Search resources').fill(MEMBER_ADMIN_WORKSPACE.name)
        await expect(
          menu.getByRole('menuitem', { name: MEMBER_ADMIN_WORKSPACE.name })
        ).toBeVisible()
      })
    }
  )
  await check('a slash in an admin composer reads skills, not the resource lists', async () => {
    await withSession(ADMIN, async (session) => {
      const { page } = session
      await page.goto(orgUrl('/home'))
      await composer(page).first().waitFor({ timeout: 30_000 })
      await session.settle()
      await composer(page).first().pressSequentially('/')
      await expect(page.getByRole('menu').getByRole('menuitem').first()).toBeVisible()
      await session.settle()
      const reads = session.requests
        .map(({ path }) => path)
        .filter((path) => isPerWorkspaceRead(path))
      assert(reads.length > 0, 'The skills were never read')
      assert.deepEqual(
        reads.filter((path) => !path.startsWith('/api/skills?')),
        [],
        'A slash read the resource lists'
      )
    })
  })
  await check(
    'Links paints its first page from the server, even with the client read refused',
    async () => {
      await withSession(MEMBER, async (session) => {
        const { page } = session
        const reads: string[] = []
        await page.route(`**/api/organizations/${ORGANIZATION_ID}/sim-links**`, (route) => {
          reads.push(route.request().url())
          return route.fulfill({ status: 500, json: { error: 'The client must not need this' } })
        })
        await page.goto(orgUrl('/links'))
        await expect(
          page.getByRole('row').filter({ hasText: NAMED_LINKS.handbook.name })
        ).toBeVisible()
        await session.settle()
        await expect(page.getByRole('button', { name: /Retry/ })).toHaveCount(0)
        assert.deepEqual(
          reads.filter((address) => !address.includes('cursor=')),
          [],
          'The seeded first page was fetched again'
        )
        await page.goto(orgUrl('/links?sort=popular&dir=desc'))
        await expect(page.getByRole('row').nth(1)).toContainText(NAMED_LINKS.mostUsed.name)
        await page.goto(orgUrl(`/links?search=${NAMED_LINKS.mostUsed.name}`))
        await expect(page.getByRole('row').nth(1)).toContainText(NAMED_LINKS.mostUsed.name)
        await session.settle()
        assert.deepEqual(
          reads.filter((address) => !address.includes('cursor=')),
          [],
          'A seeded view of the URL was fetched again'
        )
      })
    },
    { allow: [/500 GET .*\/sim-links/] }
  )
  await check('the Links document already carries the first page of rows', async () => {
    await onHome(MEMBER, async ({ context }) => {
      const html = await (await context.request.get(orgUrl('/links'))).text()
      assert(html.includes(NAMED_LINKS.handbook.url), 'The document holds the seeded rows')
    })
  })
  for (const persona of [MEMBER, ADMIN]) {
    for (const entry of pages) {
      await check(
        `${persona.key} ${entry.name}: measured, no duplicate or prefetched-key fetch`,
        async () => {
          await withSession(persona, async (session) => {
            const { page } = session
            // A returning member's browser already holds the app's scripts.
            await page.goto(orgUrl(`/${entry.path}`))
            await entry.primary(page).first().waitFor({ timeout: 30_000 })
            await session.settle()
            session.requests.length = 0
            const started = performance.now()
            await page.goto(orgUrl(`/${entry.path}`), { waitUntil: 'commit' })
            await entry.primary(page).first().waitFor({ timeout: 30_000 })
            const primaryVisibleMs = Math.round(performance.now() - started)
            await session.settle()
            const paints = await page.evaluate(() =>
              Object.fromEntries(
                performance
                  .getEntriesByType('paint')
                  .map((item) => [item.name, Math.round(item.startTime)])
              )
            )
            const api = session.requests.filter(({ path }) => path.startsWith('/api/'))
            const labelled = api.map(({ method, path }) => `${method} ${path}`)
            const counts = new Map<string, number>()
            for (const label of labelled) counts.set(label, (counts.get(label) ?? 0) + 1)
            const duplicates = [...counts.entries()]
              .filter(([, count]) => count > 1)
              .map(([label, count]) => `${label} x${count}`)
            const perWorkspaceReads = labelled.filter((label) =>
              isPerWorkspaceRead(label.replace(/^\S+ /, ''))
            )
            const refetched = entry.prefetched.flatMap(({ label, pattern }) =>
              api.some(({ method, path }) => method === 'GET' && pattern.test(path)) ? [label] : []
            )
            firstPaints.push({
              persona: persona.key,
              page: entry.name,
              firstPaintMs: paints['first-paint'] ?? null,
              firstContentfulPaintMs: paints['first-contentful-paint'] ?? null,
              primaryVisibleMs,
              apiRequests: labelled,
              totalRequestCount: session.requests.length,
              duplicates,
              prefetchedAndRefetched: refetched,
              perWorkspaceReads,
            })
            assert.deepEqual(duplicates, [], 'A read was fetched twice on first paint')
            assert.deepEqual(refetched, [], 'A prefetched key was fetched again on first paint')
            assert.deepEqual(perWorkspaceReads, [], 'The composer read every workspace on load')
          })
        }
      )
    }
  }
}
