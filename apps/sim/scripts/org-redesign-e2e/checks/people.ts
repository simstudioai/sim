import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { fullPageScreenshot } from '@/scripts/org-redesign-e2e/checks/walk'
import { ADMIN, CONNECTED, MEMBER } from '@/scripts/org-redesign-e2e/fixture'
import {
  artifactDirectory,
  check,
  DESKTOP,
  expect,
  onHome,
  org,
  PHONE,
  section,
  url,
  withSession,
} from '@/scripts/org-redesign-e2e/harness'
import {
  mainNav,
  navLabels,
  pageTurn,
  routePrefetched,
  searchField,
} from '@/scripts/org-redesign-e2e/locators'

const directoryPath = `${org.people}?view=directory`

/** What the name keeps of the table at 390px, once its columns have joined the row's summary. */
const MIN_PHONE_NAME_SHARE = 0.7

export async function peoplePhaseChecks() {
  section('People with its flag on')
  // Links is a Settings section now (org-parity.md, "Sim Links entry"), so it leaves the nav.
  await check('nav: People sits after Search', async () => {
    await onHome(MEMBER, async ({ page }) => {
      assert.deepEqual(await navLabels(page), ['Home', 'Search', 'People', 'Integrations'])
    })
  })
  // Loading paints nothing (platform/AGENTS.md): People has no loading.tsx, so the shell keeps the
  // page it leaves on screen until People's own read lands.
  await check('People keeps Search on screen while it loads, then replaces it', async () => {
    await withSession(MEMBER, async ({ page }) => {
      const hold = createDeferred<void>()
      const requested = createDeferred<void>()
      const isPeoplePayload = (address: URL) =>
        address.pathname.endsWith('/people') && address.searchParams.has('_rsc')
      await page.route(isPeoplePayload, async (route) => {
        if (route.request().headers()['next-router-prefetch'] === undefined) {
          requested.resolve()
          await hold.promise
        }
        await route.continue()
      })
      const prefetched = routePrefetched(page, isPeoplePayload)
      await page.goto(url(org.search))
      const link = mainNav(page).getByRole('link', { name: 'People', exact: true })
      await link.hover()
      await prefetched()
      await link.click()
      await requested.promise
      await pageTurn(page)
      const heading = page.getByRole('heading', { name: 'People', exact: true })
      try {
        await expect(searchField(page)).toBeVisible()
        await expect(heading).toHaveCount(0)
        await expect(page.getByRole('status', { name: /loading/i })).toHaveCount(0)
      } finally {
        hold.resolve()
      }
      await expect(heading).toBeVisible()
    })
  })
  await check(
    'a member reads that an organization admin connects the directory, and no name',
    async () => {
      await withSession(MEMBER, async (session) => {
        const { page } = session
        await page.goto(url(org.people))
        await expect(page.getByRole('button', { name: 'Org chart' })).toBeVisible()
        await expect(page.getByText(/organization admin/i).first()).toBeVisible()
        await session.settle()
        await expect(page.getByText(ADMIN.name, { exact: true })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Directory sync' })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Connect Okta' })).toHaveCount(0)
      })
    }
  )
  await check('an admin can sync and import from the empty state', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(url(org.people))
      await expect(page.getByRole('button', { name: 'Connect Okta' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Import profiles' })).toBeVisible()
    })
  })
  await check('the directory lists the organization', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(url(directoryPath))
      await expect(
        page.getByRole('table', { name: 'People' }).getByText(ADMIN.name).first()
      ).toBeVisible()
    })
  })
  await check('a phone gives the directory to the name, unbroken', async () => {
    await withSession(
      MEMBER,
      async ({ page }) => {
        await page.goto(url(directoryPath))
        const email = page.getByText(CONNECTED.email, { exact: true }).first()
        await expect(email).toBeVisible()
        const layout = await email.evaluate((node) => {
          const lines = (element: Element) => {
            const range = document.createRange()
            range.selectNodeContents(element)
            return new Set(Array.from(range.getClientRects(), ({ top }) => Math.round(top))).size
          }
          const cell = node.closest('td')
          const table = node.closest('table')
          const name = node.previousElementSibling
          return {
            nameShare:
              (cell?.getBoundingClientRect().width ?? 0) /
              (table?.getBoundingClientRect().width ?? 1),
            emailLines: lines(node),
            nameLines: name ? lines(name) : 0,
          }
        })
        assert.ok(
          layout.nameShare >= MIN_PHONE_NAME_SHARE,
          `The name holds ${Math.round(layout.nameShare * 100)}% of the table`
        )
        assert.equal(layout.emailLines, 1, 'An ordinary email address breaks mid-word')
        assert.equal(layout.nameLines, 1, 'An ordinary name breaks mid-word')
      },
      { viewport: PHONE }
    )
  })
  await walkPeopleRoutes()
}

async function walkPeopleRoutes() {
  for (const persona of [MEMBER, ADMIN]) {
    for (const theme of ['light', 'dark'] as const) {
      await check(`${persona.key} ${theme}: People screenshots`, async () => {
        await withSession(
          persona,
          async (session) => {
            for (const viewport of [DESKTOP, PHONE]) {
              await session.page.setViewportSize({ width: viewport.width, height: viewport.height })
              for (const [name, path] of [
                ['chart', org.people],
                ['directory', directoryPath],
              ]) {
                const response = await session.page.goto(url(path))
                assert((response?.status() ?? 500) < 400, `${path} ${response?.status()}`)
                await session.contentReady()
                await expect(
                  session.page.getByRole('button', { name: 'Org chart' }),
                  `${path} rendered no People page`
                ).toBeVisible()
                await fullPageScreenshot(
                  session.page,
                  resolve(
                    artifactDirectory,
                    `${persona.key}__people-${name}__${viewport.name}__${theme}.png`
                  ),
                  viewport
                )
              }
            }
          },
          { theme }
        )
      })
    }
  }
}
