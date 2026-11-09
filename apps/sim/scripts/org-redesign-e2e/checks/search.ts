import assert from 'node:assert/strict'
import type { Page } from '@playwright/test'
import {
  ADMIN,
  MEMBER,
  NAMED_LINKS,
  ORGANIZATION_ID,
  ORGANIZATION_NAME,
  SEEDED_SOURCE,
} from '@/scripts/org-redesign-e2e/fixture'
import {
  check,
  DESKTOP,
  expect,
  org,
  PHONE,
  refused,
  section,
  url,
  withSession,
  withTableHidden,
} from '@/scripts/org-redesign-e2e/harness'
import { clipboard, composer, menuEntry, searchField } from '@/scripts/org-redesign-e2e/locators'
import { searchResult, stubSearch } from '@/scripts/org-redesign-e2e/stubs'

/** Search with its query string, built on the organization's Search route. */
const searchUrl = (params: Record<string, string> = {}) => {
  const query = new URLSearchParams(params).toString()
  return url(query ? `${org.search}?${query}` : org.search)
}

/** The Search and Assistant switch: a radio group, in whichever view is showing. */
const modeSwitch = (page: Page) => page.getByRole('group', { name: 'Search mode' })
const modeRadio = (page: Page, name: 'Search' | 'Assistant') =>
  modeSwitch(page).getByRole('radio', { name, exact: true })
const historyRegion = (page: Page) => page.getByRole('region', { name: 'Search history' })

export async function searchChecks() {
  section('3 Search: Search view')
  await check('switch, landing heading, focused field, and history', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(searchUrl())
      await expect(modeRadio(page, 'Search')).toBeChecked()
      await expect(modeRadio(page, 'Assistant')).toBeVisible()
      await expect(page.getByRole('heading', { name: `Search ${ORGANIZATION_NAME}` })).toBeVisible()
      await expect(searchField(page)).toBeFocused()
      const history = historyRegion(page)
      const viewed = history.getByRole('list', { name: 'Recently viewed' })
      const searches = history.getByRole('list', { name: 'Recent searches' })
      await expect(viewed).toBeVisible()
      await expect(searches).toBeVisible()
      await expect(viewed.getByText(SEEDED_SOURCE.title, { exact: true })).toBeVisible()
      await stubSearch(page)
      await searches.getByRole('button', { name: SEEDED_SOURCE.query }).click()
      await expect(page).toHaveURL(
        (address) => address.searchParams.get('q') === SEEDED_SOURCE.query
      )
    })
  })
  await check('Back returns across a mode switch, and the mode survives a reload', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(searchUrl())
      await expect(page).toHaveURL(searchUrl({ mode: 'search' }))
      await modeRadio(page, 'Assistant').click()
      await expect(page).toHaveURL(searchUrl({ mode: 'assistant' }))
      await page.goBack()
      await expect(page).toHaveURL(searchUrl({ mode: 'search' }))
      await expect(searchField(page)).toBeVisible()
      await modeRadio(page, 'Assistant').click()
      await page.goto(searchUrl())
      await expect(page).toHaveURL(searchUrl({ mode: 'assistant' }))
      await expect(modeRadio(page, 'Assistant')).toBeChecked()
      await modeRadio(page, 'Search').click()
    })
  })
  await check('the one-line field submits on Enter, results follow the field', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await stubSearch(page)
      await page.goto(searchUrl({ mode: 'search' }))
      const field = searchField(page)
      // Emir's one-line Input, not a growing textarea.
      expect(await field.evaluate((element) => element.tagName)).toBe('INPUT')
      await field.fill('Parts recall')
      await field.press('Enter')
      await expect(page).toHaveURL((address) => address.searchParams.get('q') === 'Parts recall')
      // The page header keeps its heading; the results take the column under the field.
      await expect(page.getByRole('heading', { name: `Search ${ORGANIZATION_NAME}` })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Search results' })).toBeVisible()
      const newSearch = page.getByRole('search').getByRole('button', { name: 'New search' })
      await expect(newSearch).toBeVisible()
      await newSearch.click()
      await expect(page).toHaveURL(searchUrl({ mode: 'search' }))
      await expect(searchField(page)).toHaveValue('')
    })
  })
  await check('an unconnected member gets the connect prompt, not an empty result', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(searchUrl({ mode: 'search', q: 'warranty' }))
      await expect(page.getByText('No connected apps are available for this search.')).toBeVisible()
      // Where a member connects their own accounts.
      await expect(page.getByRole('link', { name: 'Connect apps' })).toHaveAttribute(
        'href',
        org.integrations
      )
    })
  })
  await check('results: filters, row menu, new tab link, keyboard movement', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await stubSearch(page)
      await page.goto(searchUrl({ mode: 'search', q: 'recall' }))
      const results = page.getByRole('region', { name: 'Search results' })
      await expect(results.getByText('Service bulletin', { exact: true }).first()).toBeVisible()
      const links = results.locator('a[data-source-link]')
      await expect(links.first()).toHaveAttribute('target', '_blank')
      const filters = page.getByRole('group', { name: 'Search filters' })
      await filters.getByRole('button', { name: /^Filter by date/ }).click()
      await page.getByRole('menuitemradio', { name: 'Past week' }).click()
      await expect(page).toHaveURL((address) => address.searchParams.get('updated') === '7d')
      await filters.getByRole('button', { name: /^Filter by source/ }).click()
      await page.keyboard.press('Escape')
      await links.first().focus()
      await page.keyboard.press('ArrowDown')
      await expect(links.nth(1)).toBeFocused()
    })
  })
  await check('Summarize moves to Assistant and sends a turn scoped to that document', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await stubSearch(page)
      await page.goto(searchUrl({ mode: 'search', q: 'recall' }))
      await page.getByRole('button', { name: 'Actions for Service bulletin', exact: true }).click()
      const posted = page.waitForRequest(
        (request) => request.method() === 'POST' && request.url().endsWith('/api/mothership/chat')
      )
      await menuEntry(page, 'Summarize').click()
      const body = (await posted).postDataJSON()
      assert.deepEqual(body.assistantSearch?.documentIds, ['bulletin-1'])
      assert.equal(body.mode, 'assistant')
      await expect(page).toHaveURL((address) => address.searchParams.get('mode') === 'assistant', {
        timeout: 30_000,
      })
    })
  })
  for (const viewport of [DESKTOP, { ...DESKTOP, name: 'narrow', width: 900 }, PHONE]) {
    await check(`field and results share one column (${viewport.name})`, async () => {
      await withSession(
        MEMBER,
        async ({ page }) => {
          await stubSearch(page)
          await page.goto(searchUrl({ mode: 'search', q: 'recall' }))
          const frame = page.getByRole('search')
          const row = page
            .getByRole('region', { name: 'Search results' })
            .getByRole('article')
            .filter({ has: page.getByRole('link', { name: 'Recall playbook' }) })
          await expect(row).toBeVisible()
          const [field, result] = [await frame.boundingBox(), await row.boundingBox()]
          assert(field && result, 'The field and a result are on screen')
          assert(Math.abs(field.x - result.x) <= 1, `Left ${field.x} and ${result.x}`)
          assert(
            Math.abs(field.x + field.width - (result.x + result.width)) <= 1,
            `Right ${field.x + field.width} and ${result.x + result.width}`
          )
        },
        { viewport }
      )
    })
  }
  await check("a phone's Search button keeps its size and widens its target to 44px", async () => {
    const drawnButton = async (page: Page) => {
      await page.goto(searchUrl({ mode: 'search' }))
      await searchField(page).fill('recall')
      const button = page.getByRole('search').getByRole('button', { name: 'Search', exact: true })
      const box = await button.boundingBox()
      assert(box, 'The button is on screen')
      return { button, box }
    }
    let desktopHeight = 0
    await withSession(MEMBER, async ({ page }) => {
      desktopHeight = (await drawnButton(page)).box.height
    })
    await withSession(
      MEMBER,
      async ({ page }) => {
        const { button, box } = await drawnButton(page)
        assert.equal(box.height, desktopHeight, 'The phone draws the button at its usual size')
        assert(box.height < 44, `At ${box.height}px the button needs no wider target`)
        const reach = (44 - box.height) / 2 - 1
        for (const y of [box.y - reach, box.y + box.height + reach]) {
          const hit = await button.evaluate(
            (node, point) => node.contains(document.elementFromPoint(point.x, point.y)),
            { x: box.x + box.width / 2, y }
          )
          assert(hit, `A touch ${Math.round(reach)}px off the drawn button still lands on it`)
        }
      },
      { viewport: PHONE }
    )
  })
  await check(
    'row menu: Copy link, Copy sim/name when a link exists, Create link when not, none on failure',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await stubSearch(page)
        await page.goto(searchUrl({ mode: 'search', q: 'recall' }))
        const bulletinMenu = page.getByRole('button', {
          name: 'Actions for Service bulletin',
          exact: true,
        })
        await bulletinMenu.click()
        await expect(menuEntry(page, `Copy sim/${NAMED_LINKS.handbook.name}`)).toBeVisible()
        await menuEntry(page, 'Copy link').click()
        await expect.poll(() => clipboard(page)).toBe(NAMED_LINKS.handbook.url)
        await bulletinMenu.click()
        await menuEntry(page, `Copy sim/${NAMED_LINKS.handbook.name}`).click()
        await expect.poll(() => clipboard(page)).toContain(`sim/${NAMED_LINKS.handbook.name}`)
        await page.getByRole('button', { name: 'Actions for Recall playbook', exact: true }).click()
        const create = menuEntry(page, 'Create link')
        await expect(create).toBeEnabled()
        await create.click()
        const form = page.getByRole('dialog').filter({ hasText: 'Destination URL' })
        await expect(form).toBeVisible()
        await expect(form.getByRole('checkbox', { name: 'Hide from the Links page' })).toBeVisible()
        await expect(form.getByRole('textbox', { name: 'Destination URL' })).toHaveValue(
          'https://wiki.example.com/recall'
        )
        await page.keyboard.press('Escape')
        await page.route(`**/api/organizations/${ORGANIZATION_ID}/sim-links?**`, (route) =>
          route.fulfill({ status: 500, json: { error: 'No' } })
        )
        await page.goto(searchUrl({ mode: 'search', q: 'other' }))
        await page.getByRole('button', { name: 'Actions for Recall playbook', exact: true }).click()
        await expect(menuEntry(page, 'Copy link')).toBeVisible()
        await expect(menuEntry(page, 'Create link')).toHaveCount(0, { timeout: 15_000 })
      })
    },
    { allow: [/500 GET .*\/sim-links\?/] }
  )
  await check(
    'states: failure with Retry, partial coverage, no results, custom range',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        let failing = true
        let partial = false
        await page.route('**/api/knowledge/search', async (route) => {
          if (failing) return route.fulfill({ status: 503, json: { error: 'Unavailable' } })
          const query = route.request().postDataJSON().query
          if (query === 'nothing')
            return route.fulfill({
              json: {
                success: true,
                data: { query, results: [], retrieval: { status: 'complete', timedOutLegs: [] } },
              },
            })
          const answer = searchResult(query)
          return route.fulfill({
            json: partial
              ? {
                  ...answer,
                  data: {
                    ...answer.data,
                    retrieval: { status: 'partial', timedOutLegs: [] },
                    live: {
                      backend: 'live',
                      guidance: '',
                      accounts: [
                        {
                          accountId: 'a',
                          provider: 'confluence',
                          displayName: 'x',
                          status: 'timeout',
                        },
                      ],
                    },
                  },
                }
              : answer,
          })
        })
        await page.goto(searchUrl({ mode: 'search', q: 'recall' }))
        await expect(page.getByText('Search couldn’t run.')).toBeVisible()
        failing = false
        await page.getByRole('button', { name: 'Retry', exact: true }).click()
        await expect(page.getByText('Service bulletin', { exact: true }).first()).toBeVisible()
        partial = true
        await page.goto(searchUrl({ mode: 'search', q: 'partial' }))
        await expect(
          page.getByText('Some apps couldn’t be searched. Showing available results.')
        ).toBeVisible()
        partial = false
        await page.goto(searchUrl({ mode: 'search', q: 'nothing' }))
        await expect(page.getByText(/Search found no results|No connected apps/)).toBeVisible()
        await page.goto(searchUrl({ mode: 'search', q: 'recall', updated: 'custom' }))
        await expect(page.getByText('Choose the days to search.')).toBeVisible()
      })
    },
    { allow: [/503 POST \/api\/knowledge\/search/] }
  )
  await check(
    'history states: failure retries, Clear history empties',
    async () => {
      await withSession(ADMIN, async (session) => {
        const { page } = session
        await withTableHidden('organization_search_history', async (restore) => {
          await page.goto(searchUrl({ mode: 'search' }))
          await expect(page.getByText('Your history could not load.')).toBeVisible({
            timeout: 40_000,
          })
          await restore()
          await page.getByRole('button', { name: 'Retry', exact: true }).click()
        })
        const clear = page.getByRole('button', { name: 'Clear history', exact: true })
        await expect(clear).toBeVisible()
        await clear.click()
        await expect(historyRegion(page)).toHaveCount(0)
        await page.reload()
        await expect(searchField(page)).toBeVisible()
        await session.settle()
        await expect(historyRegion(page)).toHaveCount(0)
      })
    },
    // The read whose table the check hides.
    { allow: [refused(500, 'GET', `/api/organizations/${ORGANIZATION_ID}/search/history`)] }
  )
  await check('a query keeps its edited draft on return', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await stubSearch(page)
      await page.goto(searchUrl({ mode: 'search', q: 'recall' }))
      await searchField(page).fill('recall edits')
      await page.goto(searchUrl({ mode: 'search', q: 'recall' }))
      await expect(searchField(page)).toHaveValue('recall edits')
    })
  })

  section('3 Search: Assistant view')
  await check('landing heading, composer, and Get started, not in the Search view', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(searchUrl({ mode: 'assistant' }))
      await expect(page.getByRole('heading', { name: `Ask ${ORGANIZATION_NAME}` })).toBeVisible()
      await expect(composer(page)).toHaveAttribute(
        'placeholder',
        'Ask about your company’s knowledge…'
      )
      await expect(page.getByText('Get started', { exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: /Connect an integration/ })).toHaveAttribute(
        'href',
        org.integrations
      )
      await page.goto(searchUrl({ mode: 'search' }))
      await expect(searchField(page)).toBeVisible()
      await expect(page.getByText('Get started', { exact: true })).toHaveCount(0)
    })
  })
  await check('chat URL keeps filters and mode', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(searchUrl({ mode: 'assistant', q: 'recall', source: 'slack', updated: '7d' }))
      await composer(page).fill('Filtered question')
      await composer(page).press('Enter')
      await expect(page).toHaveURL(
        (address) => address.pathname.startsWith(`${org.search}/chat/`),
        { timeout: 30_000 }
      )
      const parsed = new URL(page.url())
      assert.equal(parsed.searchParams.get('mode'), 'assistant')
      assert.equal(parsed.searchParams.get('source'), 'slack')
      assert.equal(parsed.searchParams.get('updated'), '7d')
      assert.equal(parsed.searchParams.get('q'), 'recall')
    })
  })
}
