import { expect, type Page } from '@playwright/test'
import { fixtureUrl } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

test.use({ viewport: { width: 1440, height: 900 } })

/** The visible page column; navigation keeps earlier pages mounted but hidden. */
function main(page: Page) {
  return page.locator('main:visible')
}

/** Record every DOM state of the content region while `action` runs. */
async function watchFrames(page: Page, action: () => Promise<void>) {
  await page.evaluate(() => {
    const region = document.querySelector('[class*="content"][data-scroll-axis]')
    const frames: { heading: boolean; blank: boolean }[] = []
    const record = () => {
      const visible = [...(region?.querySelectorAll('main') ?? [])].filter(
        (element) => element.getBoundingClientRect().height > 0
      )
      frames.push({
        heading: visible.some((element) =>
          element.querySelector('h1, nav[aria-label$="navigation"]')
        ),
        blank: visible.length === 0,
      })
    }
    const observer = new MutationObserver(record)
    if (region) observer.observe(region, { childList: true, subtree: true, attributes: true })
    Object.assign(window, { __frames: frames, __stopFrames: () => observer.disconnect() })
  })
  await action()
  return page.evaluate(() => {
    const state = window as unknown as {
      __frames: { heading: boolean; blank: boolean }[]
      __stopFrames: () => void
    }
    state.__stopFrames()
    return state.__frames
  })
}

async function box(page: Page, selector: string) {
  return page.locator(selector).filter({ visible: true }).first().boundingBox()
}

test('a workspace opens beside the organization sidebar, which stays as it is', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/home?state=full'))
  const sidebar = page.getByRole('complementary', { name: 'Platform sidebar' })
  const navigation = sidebar.getByRole('navigation', { name: 'Main navigation' })
  const workspaces = navigation.getByRole('region', { name: 'Workspaces', exact: true })
  const it = workspaces.getByRole('link', { name: 'IT operations', exact: true })
  const finance = workspaces.getByRole('link', { name: 'Finance', exact: true })
  await it.click()
  await expect(page).toHaveURL(/\/workspace\/it\/dashboards\?state=full/)
  await expect(main(page).getByRole('heading', { level: 1, name: 'IT operations' })).toBeVisible()
  await expect(navigation.getByRole('link', { name: 'Home', exact: true })).toBeVisible()
  await expect(navigation.getByRole('link', { name: 'Integrations', exact: true })).toBeVisible()
  await expect(it).toHaveAttribute('aria-current', 'page')
  await expect(sidebar.getByRole('link', { name: 'Back', exact: true })).toHaveCount(0)
  await main(page).getByRole('link', { name: 'Logs', exact: true }).click()
  await expect(page).toHaveURL(/\/workspace\/it\/logs\?state=full/)
  await expect(it).toHaveAttribute('aria-current', 'page')
  await finance.click()
  await expect(main(page).getByRole('heading', { level: 1, name: 'Finance' })).toBeVisible()
  await expect(page).toHaveURL(/\/workspace\/[^/]+\/dashboards\?state=full/)
  await expect(finance).toHaveAttribute('aria-current', 'page')
  await expect(it).not.toHaveAttribute('aria-current', 'page')
  await expect(navigation.getByRole('link', { name: 'Home', exact: true })).toBeVisible()
})

test('workspace tabs share the Integrations heading, tab row and control positions', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/integrations?state=full'))
  const reference = {
    heading: await box(page, 'main h1'),
    tabs: await box(page, 'main nav'),
    search: await box(page, 'main input'),
    sort: await box(page, 'main button[aria-label^="Sort"]'),
  }
  for (const [tab, searched, sorted] of [
    ['issues', true, true],
    ['logs', false, true],
    ['dashboards', false, false],
    ['changelog', false, false],
  ] as const) {
    await page.goto(fixtureUrl(`/workspace/it/${tab}?state=full`))
    await expect(main(page).getByRole('heading', { level: 1, name: 'IT operations' })).toBeVisible()
    const heading = await box(page, 'main h1')
    const tabs = await box(page, 'main nav')
    expect(heading?.x).toBe(reference.heading?.x)
    expect(heading?.y).toBe(reference.heading?.y)
    expect(tabs?.x).toBe(reference.tabs?.x)
    expect(tabs?.y).toBe(reference.tabs?.y)
    if (searched) {
      expect((await box(page, 'main input'))?.x).toBe(reference.search?.x)
      expect((await box(page, 'main input'))?.y).toBe(reference.search?.y)
    }
    if (sorted)
      expect((await box(page, 'main button[aria-label^="Sort"]'))?.x).toBe(reference.sort?.x)
  }
})

test('tab changes keep a heading on screen and mark the current tab', async ({ page }) => {
  await page.goto(fixtureUrl('/workspace/it/dashboards?state=full'))
  const tabs = main(page).getByRole('navigation', { name: 'IT operations pages' })
  await expect(tabs.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
    'aria-current',
    'page'
  )
  for (const name of ['Issues', 'Changelog', 'Logs', 'Dashboard']) {
    const frames = await watchFrames(page, async () => {
      await tabs.getByRole('link', { name, exact: true }).click()
      await expect(tabs.getByRole('link', { name, exact: true })).toHaveAttribute(
        'aria-current',
        'page'
      )
    })
    expect(frames.filter((frame) => frame.blank || !frame.heading)).toEqual([])
  }
})

test('a dashboard section choice changes only that section; the period changes the snapshot', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/workspace/it/dashboards?state=full'))
  const requests = main(page).getByRole('region', { name: 'Requests', exact: true })
  const mix = main(page).getByRole('region', { name: 'Request mix', exact: true })
  const mixLegend = await mix.getByRole('list', { name: 'Distribution legend' }).innerText()
  const before = await requests.locator('[aria-hidden="true"]').first().innerText()
  await requests.getByRole('button', { name: /Agent/ }).click()
  await page.getByRole('menuitemradio', { name: 'Incident digest' }).click()
  await expect(requests.locator('[aria-hidden="true"]').first()).not.toHaveText(before)
  expect(await mix.getByRole('list', { name: 'Distribution legend' }).innerText()).toBe(mixLegend)
  const total = mix.getByText(/^[\d,]+$/).first()
  const weekTotal = (await total.textContent()) ?? ''
  await main(page)
    .getByRole('button', { name: /Period/ })
    .click()
  await page.getByRole('menuitemradio', { name: 'Last 90 days' }).click()
  await expect(page).toHaveURL(/period=90d/)
  await expect(total).not.toHaveText(weekTotal)
})

test('chart points open the shared tooltip by pointer and by keyboard', async ({ page }) => {
  await page.goto(fixtureUrl('/workspace/it/dashboards?state=full'))
  const plot = main(page).getByRole('group', { name: 'Requests data' })
  await plot.hover({ position: { x: 40, y: 40 } })
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(page.getByRole('tooltip')).toBeHidden()
  await plot.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tooltip')).toContainText('Requests')
  const grouped = main(page).getByRole('group', { name: 'Handle time by agent data' })
  await grouped.focus()
  await page.keyboard.press('End')
  await expect(page.getByRole('tooltip')).toContainText('This period')
})

test('issue list to details and Back restores the filters, scroll and chrome', async ({ page }) => {
  await page.goto(fixtureUrl('/workspace/workspace-0/issues?state=stress&sort=oldest'))
  const search = main(page).getByRole('searchbox', { name: 'Search issues' })
  await search.fill('Escalate')
  await expect(page).toHaveURL(/q=Escalate/)
  await page.mouse.move(800, 600)
  await page.mouse.wheel(0, 1200)
  const row = main(page)
    .getByRole('link', { name: /Escalate/ })
    .filter({ visible: true })
    .nth(12)
  await row.scrollIntoViewIfNeeded()
  const readScroll = () =>
    page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLElement>('[data-scroll-axis="vertical"]')].find(
          (element) => element.scrollTop > 0 && element.querySelector('main')
        )?.scrollTop ?? 0
    )
  const scrolled = await readScroll()
  expect(scrolled).toBeGreaterThan(0)
  await row.click()
  await expect(page).toHaveURL(/\/issues\/[A-Z]+-\d+\?.*q=Escalate/)
  const back = main(page).getByRole('link', { name: 'Issues', exact: true })
  await expect(back).toHaveAttribute('href', /sort=oldest/)
  const frames = await watchFrames(page, async () => {
    await page.goBack()
    await expect(main(page).getByRole('searchbox', { name: 'Search issues' })).toHaveValue(
      'Escalate'
    )
  })
  expect(frames.filter((frame) => frame.blank || !frame.heading)).toEqual([])
  await expect.poll(readScroll).toBe(scrolled)
  await page.goForward()
  await main(page).getByRole('link', { name: 'Issues', exact: true }).click()
  await expect(main(page).getByRole('searchbox', { name: 'Search issues' })).toHaveValue('Escalate')
  await expect.poll(readScroll).toBe(scrolled)
  await main(page)
    .getByRole('navigation', { name: /pages$/ })
    .getByRole('link', { name: 'Logs' })
    .click()
  await main(page)
    .getByRole('navigation', { name: /pages$/ })
    .getByRole('link', { name: 'Issues' })
    .click()
  await expect.poll(readScroll).toBe(0)
})

test('long lists page quietly with edge fades only where content continues', async ({ page }) => {
  await page.goto(fixtureUrl('/workspace/workspace-0/logs?state=stress'))
  const rows = main(page).getByRole('list', { name: 'Runs' }).getByRole('listitem')
  await expect(rows).toHaveCount(50)
  const region = page
    .locator('[data-scroll-axis="vertical"]')
    .filter({ has: page.locator('main:visible') })
  await expect(region).toHaveAttribute('data-edges', 'end')
  await page.mouse.move(700, 500)
  for (let step = 0; step < 6; step += 1) await page.mouse.wheel(0, 4000)
  await expect.poll(() => rows.count()).toBeGreaterThan(50)
  await expect(region).toHaveAttribute('data-edges', /both|start/)
  await expect(main(page).getByText(/Loading|Load more/)).toHaveCount(0)
})

test('an issue decision changes only the session and moves the issue between groups', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/workspace/it/issues?state=full'))
  await main(page)
    .getByRole('link', { name: /Route expired access requests/ })
    .click()
  const facts = page.getByRole('complementary', { name: 'Facts' })
  await expect(facts.locator('dd', { hasText: /^Needs review$/ })).toBeVisible()
  const requests: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET') requests.push(request.url())
  })
  await main(page).getByRole('button', { name: 'Approve' }).click()
  await expect(facts.locator('dd', { hasText: /^Queued$/ })).toBeVisible()
  await expect(facts.getByText('Approved by')).toBeVisible()
  await main(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Cancel issue' }).click()
  await expect(facts.locator('dd', { hasText: /^Cancelled$/ })).toBeVisible()
  expect(requests).toEqual([])
  await main(page).getByRole('link', { name: 'Issues', exact: true }).click()
  await main(page)
    .getByRole('button', { name: /Status/ })
    .click()
  await page.getByRole('menuitemradio', { name: 'Closed' }).click()
  await expect(
    main(page)
      .getByRole('list', { name: 'Closed' })
      .getByRole('link', { name: /Route expired access requests/ })
  ).toBeVisible()
})

test('pages refresh themselves, keeping only when they last updated', async ({ page }) => {
  for (const tab of ['dashboards', 'changelog']) {
    await page.goto(fixtureUrl(`/workspace/it/${tab}?state=full`))
    await expect(main(page).getByText(/^Updated /)).toBeVisible()
    await expect(main(page).getByRole('button', { name: /refresh/i })).toHaveCount(0)
  }
  await page.goto(fixtureUrl('/workspace/it/logs?state=full'))
  const rows = main(page).getByRole('list', { name: 'Runs' }).getByRole('listitem')
  await expect(rows.first()).toContainText('Running')
  await expect(main(page).getByRole('button', { name: /new runs?$/ })).toHaveCount(0)
})

test('a record keeps its identifiers in its facts, and the rail line spans only them', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/workspace/it/issues/IT-136?state=full'))
  const facts = page.getByRole('complementary', { name: 'Facts' })
  await expect(facts.locator('dd', { hasText: /^IT-136$/ })).toBeVisible()
  const bar = main(page).getByRole('navigation', { name: 'Issues navigation' }).locator('xpath=..')
  await expect(bar).toContainText('Approve')
  await expect(bar).not.toContainText('IT-136')
  const rail = await facts.evaluate((aside) => {
    const box = aside.getBoundingClientRect()
    const first = aside.firstElementChild?.getBoundingClientRect()
    const last = aside.lastElementChild?.getBoundingClientRect()
    const reading = aside.previousElementSibling?.getBoundingClientRect()
    const heading = document.querySelector('main h1')?.getBoundingClientRect()
    if (!first || !last || !reading || !heading) return null
    return {
      above: first.top - box.top,
      below: box.bottom - last.bottom,
      height: box.height,
      reading: reading.height,
      level: Math.abs(first.top - heading.top),
    }
  })
  if (!rail) throw new Error('Rail geometry is unavailable')
  expect(rail.height).toBeLessThan(rail.reading / 2)
  expect(rail.above).toBeGreaterThan(0)
  expect(Math.abs(rail.above - rail.below)).toBeLessThanOrEqual(1)
  expect(rail.level).toBeLessThanOrEqual(1)
})

test('a run opens its trace and selected step, with its execution ID among its facts', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/workspace/it/logs?state=full'))
  const rows = main(page).getByRole('list', { name: 'Runs' }).getByRole('listitem')
  await expect(rows).toHaveCount(50)
  await rows.nth(4).getByRole('link').click()
  await expect(
    main(page).getByRole('heading', { level: 1, name: /^Run [0-9a-f]{8}$/ })
  ).toBeVisible()
  const executionId = new URL(page.url()).pathname.split('/').at(-1) ?? ''
  const runFacts = main(page).getByLabel('Run facts')
  await expect(runFacts.locator('dd', { hasText: new RegExp(`^${executionId}$`) })).toBeVisible()
  await expect(
    main(page).getByRole('navigation', { name: 'Logs navigation' }).locator('xpath=..')
  ).not.toContainText(executionId)
  const trace = main(page).getByRole('list', { name: /steps$/ })
  await trace.getByRole('button', { name: /search_knowledge/ }).click()
  await expect(main(page).getByRole('region', { name: 'search_knowledge step' })).toContainText(
    'Call ID'
  )
  await trace.getByRole('button', { name: 'Collapse Classify request' }).click()
  await expect(trace.getByRole('button', { name: /search_knowledge/ })).toHaveCount(0)
  await expect(runFacts).toContainText(/\d Compute Units/)
  await expect(runFacts).not.toContainText(/\bCU\b/)
  await expect(page.getByRole('complementary', { name: 'Selected step' })).toContainText(
    'search_knowledge'
  )
})

test('trace rows share one disclosure-to-name gap and hang guides under open parents', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/workspace/it/logs?state=full'))
  await main(page)
    .getByRole('list', { name: 'Runs' })
    .getByRole('listitem')
    .nth(3)
    .getByRole('link')
    .click()
  const trace = main(page).getByRole('list', { name: /steps$/ })
  await expect(trace.getByRole('button', { name: /^Classify request/ })).toBeVisible()
  const rows = await trace.locator(':scope > li').evaluateAll((items) =>
    items.slice(0, 6).map((item) => {
      const target = item.querySelector('[data-trace-target]')
      const disclosure = target?.previousElementSibling?.getBoundingClientRect()
      const name = target?.querySelector('[data-type="T060"]')?.getBoundingClientRect()
      const guides = [...item.children].filter(
        (child) => child !== target?.previousElementSibling && child !== target
      )
      const guide = guides.at(-1)
      return {
        marked: (target?.firstElementChild?.childElementCount ?? 0) > 0,
        gap: name && disclosure ? Math.round(name.left - disclosure.left) : null,
        disclosureCenter: disclosure ? disclosure.left + disclosure.width / 2 : null,
        depth: guides.length,
        guideCenter: guide
          ? guide.getBoundingClientRect().left + guide.getBoundingClientRect().width / 2
          : null,
        guideStyle: guide ? getComputedStyle(guide, '::before').borderInlineStartStyle : null,
      }
    })
  )
  expect(rows.every((row) => row.marked)).toBe(true)
  expect(new Set(rows.map((row) => row.gap)).size).toBe(1)
  for (const [index, row] of rows.entries()) {
    if (!row.depth) continue
    const parent = rows
      .slice(0, index)
      .reverse()
      .find((candidate) => candidate.depth === row.depth - 1)
    expect(row.guideStyle).toBe('solid')
    expect(
      Math.abs((row.guideCenter ?? 0) - (parent?.disclosureCenter ?? -99))
    ).toBeLessThanOrEqual(1)
  }
})

test('logs filter from the leading edge of the bar, with no search', async ({ page }) => {
  await page.goto(fixtureUrl('/workspace/it/logs?state=full'))
  await expect(main(page).getByRole('button', { name: /Status/ })).toBeVisible()
  await expect(main(page).getByRole('searchbox')).toHaveCount(0)
  const tabs = await main(page)
    .getByRole('navigation', { name: /pages$/ })
    .getByRole('link', { name: 'Dashboard' })
    .boundingBox()
  const status = await main(page)
    .getByRole('button', { name: /Status/ })
    .boundingBox()
  if (!tabs || !status) throw new Error('Control geometry is unavailable')
  expect(Math.abs(status.x - tabs.x)).toBeLessThanOrEqual(1)
})

test('the changelog ends each entry with its ticket, under the time', async ({ page }) => {
  await page.goto(fixtureUrl('/workspace/it/changelog?state=full'))
  const entry = main(page).getByRole('listitem').first()
  const time = await entry.locator('time').boundingBox()
  const ticket = await entry.getByRole('link', { name: /^[A-Z]+-\d+$/ }).boundingBox()
  const person = await entry
    .getByText(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
    .first()
    .boundingBox()
  if (!time || !ticket || !person) throw new Error('Entry geometry is unavailable')
  expect(Math.abs(ticket.x + ticket.width - (time.x + time.width))).toBeLessThanOrEqual(1)
  expect(
    Math.abs(ticket.y + ticket.height / 2 - (person.y + person.height / 2))
  ).toBeLessThanOrEqual(1)
})

test('the changelog labels each day once and links each change to its issue', async ({ page }) => {
  await page.goto(fixtureUrl('/workspace/it/changelog?state=full'))
  const days = await main(page).locator('section h2').allInnerTexts()
  expect(new Set(days).size).toBe(days.length)
  expect(days[0]).toBe('Today')
  const entry = main(page).getByRole('listitem').first()
  const issue = await entry.getByRole('link', { name: /^[A-Z]+-\d+$/ }).innerText()
  await entry.getByRole('link', { name: issue }).click()
  await expect(page).toHaveURL(new RegExp(`/issues/${issue}`))
  await expect(page.getByRole('complementary', { name: 'Facts' })).toContainText('Merged')
})

test('empty workspaces show one centered empty state per tab', async ({ page }) => {
  for (const [tab, title, action] of [
    ['dashboards', 'No dashboard yet', 'New chat'],
    ['issues', 'No issues yet', 'New chat'],
    ['changelog', 'No changes yet', 'View issues'],
    ['logs', 'No runs yet', undefined],
  ] as const) {
    await page.goto(fixtureUrl(`/workspace/it/${tab}?state=empty`))
    const heading = main(page).getByRole('heading', { level: 2, name: title })
    await expect(heading).toBeVisible()
    if (action) await expect(main(page).getByRole('link', { name: action })).toBeVisible()
    await expect(main(page).getByRole('searchbox')).toHaveCount(0)
    const tabs = await box(page, 'main nav')
    const empty = await heading.locator('xpath=ancestor::section[1]').boundingBox()
    const viewport = page.viewportSize()
    if (!tabs || !empty || !viewport) throw new Error('Empty state geometry is unavailable')
    const below = (tabs.y + tabs.height + viewport.height) / 2
    expect(Math.abs(empty.y + empty.height / 2 - below)).toBeLessThan(48)
  }
})
