import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type Browser, type BrowserContext, chromium, expect, type Page } from '@playwright/test'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'

const logger = createLogger('DocsNavigationE2E', { logLevel: 'INFO' })
const origin = process.env.DOCS_E2E_BASE_URL
const reportSetting = process.env.DOCS_NAVIGATION_REPORT_PATH
if (!origin || !reportSetting)
  throw new Error('DOCS_E2E_BASE_URL and DOCS_NAVIGATION_REPORT_PATH are required')
const reportPath: string = reportSetting
const target = new URL(origin)
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))
  throw new Error('Only a loopback docs server may be tested')
const directory = dirname(reportPath)
const results: Array<{
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  error?: string
}> = []
await mkdir(directory, { recursive: true })

async function check(name: string, action: () => Promise<void>) {
  if (process.env.DOCS_NAVIGATION_FILTER && !name.includes(process.env.DOCS_NAVIGATION_FILTER))
    return
  logger.info('Running', { name })
  const started = performance.now()
  try {
    await action()
    results.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) })
    logger.info('Passed', { name })
  } catch (error) {
    results.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: getErrorMessage(error),
    })
    logger.error('Failed', { name, error: getErrorMessage(error) })
  }
  await writeFile(reportPath, `${JSON.stringify({ origin: target.origin, results }, null, 2)}\n`)
}

async function open(page: Page, path: string) {
  const response = await page.goto(new URL(path, target).href, { waitUntil: 'domcontentloaded' })
  expect(response?.ok()).toBe(true)
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await expect(
    page.getByRole('group', { name: 'Color theme' }).last().getByRole('button', { pressed: true })
  ).toHaveCount(1)
}

async function copyMenu(page: Page) {
  const item = page.getByRole('menuitem', {
    name: /^(Copy Markdown|Copied|Copy prepared Markdown)$/,
  })
  if (!(await item.isVisible()))
    await page.getByRole('button', { name: 'Page actions', exact: true }).click()
  return item
}

async function verifyClipboard(
  page: Page,
  context: BrowserContext,
  path: string,
  title: string,
  content: string
) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const markdownUrl = new URL(`${path}.md`, target).href
  const response = await page.request.get(markdownUrl)
  expect(response.ok()).toBe(true)
  const markdown = await response.text()
  expect(markdown).toContain(`# ${title} (${path})`)
  expect(markdown).toContain(content)
  await (await copyMenu(page)).click()
  await expect(page.getByRole('menuitem', { name: 'Copied', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(markdown)
  for (const failure of [
    { status: 503, body: 'Unavailable' },
    { status: 200, body: ' \n ' },
  ]) {
    await page.route(markdownUrl, (route) => route.fulfill(failure))
    await (await copyMenu(page)).click()
    await expect(page.getByRole('status').filter({ hasText: 'Could not copy.' })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(markdown)
    await expect(page.getByRole('menuitem', { name: 'Copied', exact: true })).toHaveCount(0)
    await page.unroute(markdownUrl)
    await (await copyMenu(page)).click()
    await expect(page.getByRole('menuitem', { name: 'Copied', exact: true })).toBeVisible()
  }
  await page.keyboard.press('Escape')
}

let browser: Browser | undefined
try {
  browser = await chromium.launch()
  const scenarios = [
    { path: '/introduction', title: 'Introduction', content: '## Models and integrations' },
    { path: '/getting-started', title: 'Getting started', content: '## Start in Chat' },
    { path: '/files', title: 'Files', content: '## Upload or create a file' },
    { path: '/integrations/apollo', title: 'Apollo', content: '### Apollo People Search' },
    {
      path: '/api-reference/workflows/listWorkflows',
      title: 'List workflows',
      content: 'GET /api/v2/workflows',
    },
  ]
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    for (const scenario of scenarios) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' })
      try {
        await check(
          `${viewport.name}: navigation and complete copy for ${scenario.path}`,
          async () => {
            const page = await context.newPage()
            const errors: string[] = []
            const markdownRequests: string[] = []
            page.on('pageerror', (error) => errors.push(error.message))
            page.on('request', (request) => {
              if (/\.(md|mdx)$/.test(new URL(request.url()).pathname))
                markdownRequests.push(request.url())
            })
            await open(page, scenario.path)
            expect(markdownRequests).toEqual([])
            if (scenario.path.startsWith('/api-reference/')) {
              const tabs = page.getByRole('tablist', { name: 'Request language' }).getByRole('tab')
              expect(await tabs.count()).toBeGreaterThan(1)
              for (let index = 0; index < (await tabs.count()); index += 1) {
                await tabs.nth(index).click()
                await expect(tabs.nth(index)).toHaveAttribute('aria-selected', 'true')
                const panelId = await tabs.nth(index).getAttribute('aria-controls')
                expect(panelId).toBeTruthy()
                const panel = page.locator(`[id="${panelId}"]`)
                await expect(panel).toBeVisible()
                expect((await panel.locator('code').textContent())?.trim()).toBeTruthy()
              }
            }
            if (viewport.name === 'desktop') {
              await verifyClipboard(page, context, scenario.path, scenario.title, scenario.content)
              expect(markdownRequests[0]).toBe(new URL(`${scenario.path}.md`, target).href)
            }
            if (scenario.path === '/introduction') {
              if (viewport.name === 'mobile')
                await page.getByRole('button', { name: 'Menu', exact: true }).click()
              const navigation = page.getByRole('navigation', {
                name: 'Documentation sidebar',
                exact: true,
              })
              const branch = navigation.getByRole('button', {
                name: /^(Expand |Collapse )?Platform$/,
              })
              const costs = navigation.getByRole('link', {
                name: 'Credits, billing and limits',
                exact: true,
              })
              if (!(await costs.isVisible())) await branch.click()
              await expect(costs).toBeVisible()
              await branch.press('Enter')
              await expect(costs).toBeHidden()
              await branch.press('Enter')
              await costs.click()
              await expect(page).toHaveURL(new URL('/platform/costs', target).href)
              await expect(
                page.getByRole('heading', {
                  level: 1,
                  name: 'Credits, billing and limits',
                  exact: true,
                })
              ).toBeVisible()
              if (viewport.name === 'mobile') {
                await expect(page.getByRole('dialog')).not.toBeVisible()
                await page.getByRole('button', { name: 'Menu', exact: true }).click()
              }
              await expect(costs).toHaveAttribute('aria-current', 'page')
              await expect(branch).toHaveAttribute('aria-expanded', 'true')
              if (viewport.name === 'mobile')
                await page.getByRole('button', { name: 'Close navigation' }).click()
              else
                await verifyClipboard(
                  page,
                  context,
                  '/platform/costs',
                  'Credits, billing and limits',
                  '## What a workflow run costs'
                )
            }
            expect(
              await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
            ).toBe(true)
            await page.screenshot({
              path: join(directory, `${viewport.name}${scenario.path.replaceAll('/', '-')}.png`),
            })
            expect(errors).toEqual([])
          }
        )
      } finally {
        await context.close()
      }
    }
  }

  for (const reveal of ['fragment', 'beforematch'] as const) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    try {
      await check(`Nested response tabs reveal their ancestors through ${reveal}`, async () => {
        const page = await context.newPage()
        await open(page, '/api-reference/logs/getLog')
        const status = page.locator('#response-400')
        const media = status.getByRole('tabpanel', { includeHidden: true }).first()
        const statuses = page.getByRole('tablist', { name: 'Response status' })
        await expect(page.locator('#response-200')).toBeVisible()
        await expect(status).toBeHidden()
        const mediaId = await media.getAttribute('id')
        if (!mediaId) throw new Error('Response media panel has no fragment identifier')
        if (reveal === 'fragment')
          await page.evaluate((id) => {
            window.location.hash = encodeURIComponent(id)
          }, mediaId)
        else await media.dispatchEvent('beforematch')
        await expect(statuses.getByRole('tab', { name: '400', exact: true })).toHaveAttribute(
          'aria-selected',
          'true'
        )
        await expect(status).toBeVisible()
        await expect(media).toBeVisible()
        await expect(page.locator('#response-200')).toBeHidden()
        await statuses.getByRole('tab', { name: '200', exact: true }).click()
        await expect(page.locator('#response-200')).toBeVisible()
        await expect(status).toBeHidden()
        await page.screenshot({ path: join(directory, `nested-tabs-${reveal}.png`) })
      })
    } finally {
      await context.close()
    }
  }

  const legacy = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  try {
    await check(
      'Legacy clipboard preserves activation and invalidates prepared content after navigation',
      async () => {
        await legacy.addInitScript(() => {
          Object.defineProperty(window, 'ClipboardItem', { value: undefined })
          const write = navigator.clipboard.writeText.bind(navigator.clipboard)
          navigator.clipboard.writeText = (text) => {
            document.documentElement.dataset.clipboardActivation = String(
              navigator.userActivation.isActive
            )
            return write(text)
          }
        })
        const page = await legacy.newPage()
        const requests: string[] = []
        await page.route('**/*.md', async (route) => {
          requests.push(route.request().url())
          await page.waitForFunction(() => !navigator.userActivation.isActive, undefined, {
            timeout: 9000,
          })
          await route.continue()
        })
        await open(page, '/introduction')
        const firstPrepared = page.waitForResponse(new URL('/introduction.md', target).href)
        await (await copyMenu(page)).click()
        await firstPrepared
        await expect(page.getByRole('menuitem', { name: 'Copy prepared Markdown' })).toBeVisible({
          timeout: 12000,
        })
        await expect(page.locator('html')).not.toHaveAttribute('data-clipboard-activation')
        await page.getByRole('menuitem', { name: 'Copy prepared Markdown' }).click()
        await expect(page.getByRole('menuitem', { name: 'Copied', exact: true })).toBeVisible()
        await expect(page.locator('html')).toHaveAttribute('data-clipboard-activation', 'true')
        const first = await page.evaluate(() => navigator.clipboard.readText())
        expect(first).toContain('# Introduction (/introduction)')
        await page.keyboard.press('Escape')
        const navigation = page.getByRole('navigation', {
          name: 'Documentation sidebar',
          exact: true,
        })
        const costs = navigation.getByRole('link', {
          name: 'Credits, billing and limits',
          exact: true,
        })
        if (!(await costs.isVisible()))
          await navigation.getByRole('button', { name: /^(Expand |Collapse )?Platform$/ }).click()
        await costs.click()
        await expect(page).toHaveURL(new URL('/platform/costs', target).href)
        const nextPrepared = page.waitForResponse(new URL('/platform/costs.md', target).href)
        await (await copyMenu(page)).click()
        await nextPrepared
        await expect(page.getByRole('menuitem', { name: 'Copy prepared Markdown' })).toBeVisible({
          timeout: 12000,
        })
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first)
        await page.getByRole('menuitem', { name: 'Copy prepared Markdown' }).click()
        await expect(page.getByRole('menuitem', { name: 'Copied', exact: true })).toBeVisible()
        await expect(page.locator('html')).toHaveAttribute('data-clipboard-activation', 'true')
        expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
          '# Credits, billing and limits (/platform/costs)'
        )
        expect(requests).toEqual([
          new URL('/introduction.md', target).href,
          new URL('/platform/costs.md', target).href,
        ])
        await page.screenshot({ path: join(directory, 'legacy-clipboard.png') })
      }
    )
  } finally {
    await Promise.all(legacy.pages().map((page) => page.unrouteAll({ behavior: 'ignoreErrors' })))
    await legacy.close()
  }

  for (const colorScheme of ['light', 'dark'] as const) {
    for (const width of [320, 390, 639, 640, 767, 768, 1023, 1024, 1279, 1280, 1440, 1920]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme,
        reducedMotion: 'reduce',
      })
      try {
        await check(`Responsive ${colorScheme} at ${width}px`, async () => {
          const page = await context.newPage()
          await open(page, '/getting-started')
          await expect(page.locator('html')).toHaveClass(new RegExp(colorScheme))
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
          ).toBe(true)
          if (width < 1024) {
            await page.getByRole('button', { name: 'Menu', exact: true }).click()
            await expect(page.getByRole('dialog')).toBeVisible()
            await page.keyboard.press('Escape')
            await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeFocused()
          }
          await page.screenshot({ path: join(directory, `responsive-${colorScheme}-${width}.png`) })
        })
      } finally {
        await context.close()
      }
    }
  }

  const interactive = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  try {
    await check(
      'Docs polish: nested TOC anchors track the selected section across breakpoints',
      async () => {
        const page = await interactive.newPage()
        try {
          for (const width of [1440, 1024, 768, 390]) {
            await page.setViewportSize({ width, height: 900 })
            await open(page, '/getting-started')
            if (width < 1280)
              await page
                .getByText('On this page', { exact: true })
                .filter({ visible: true })
                .click()
            const link = page.getByRole('link', { name: 'Create a workflow', exact: true })
            await link.click()
            await expect(page).toHaveURL(/#create-a-workflow$/)
            await expect
              .poll(() =>
                page
                  .locator('nav[aria-label="On this page"] a[aria-current="location"]')
                  .first()
                  .getAttribute('href')
              )
              .toBe('#create-a-workflow')
            const heading = await page.locator('#create-a-workflow').boundingBox()
            const header = await page.getByRole('banner').boundingBox()
            expect(heading?.y).toBeGreaterThan((header?.height ?? 0) + 8)
            expect(heading?.y).toBeLessThan((header?.height ?? 0) + 40)
            await page.screenshot({ path: join(directory, `toc-anchor-${width}.png`) })
          }
        } finally {
          await page.close()
        }
      }
    )
    await check('Docs polish: shortcut dismissal restores the opening trigger', async () => {
      const page = await interactive.newPage()
      try {
        await open(page, '/introduction')
        const trigger = page.getByRole('button', { name: 'Search documentation', exact: true })
        await trigger.click()
        await page.getByRole('combobox').press('Control+k')
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await expect(trigger).toBeFocused()
      } finally {
        await page.close()
      }
    })
    for (const path of [
      '/introduction',
      '/api-reference/getting-started',
      '/cli',
      '/mcp/overview',
    ]) {
      await check(`Docs polish: empty search navigates within ${path}`, async () => {
        const page = await interactive.newPage()
        try {
          await open(page, path)
          const sidebarLinks = page
            .getByRole('navigation', { name: 'Documentation sidebar' })
            .getByRole('link')
          const destinations = await sidebarLinks.evaluateAll((links) =>
            links.map((link) => link.getAttribute('href'))
          )
          await page.getByRole('button', { name: 'Search documentation', exact: true }).click()
          const search = page.getByRole('combobox')
          await expect(page.getByRole('option').first()).toBeVisible()
          await page.route('**/api/search?*', (route) => route.fulfill({ status: 503, body: '{}' }))
          await search.fill('failure-case')
          await expect(page.getByRole('status')).toContainText('Search is unavailable')
          await search.fill('')
          await expect(page.getByRole('option').first()).toBeVisible()
          await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0)
          await search.press('ArrowDown')
          await search.press('Enter')
          await expect(page.getByRole('dialog')).toHaveCount(0)
          await expect(page).not.toHaveURL(new URL(path, target).href)
          expect(destinations).toContain(new URL(page.url()).pathname)
        } finally {
          await page.close()
        }
      })
    }
    await check(
      'Search keyboard navigation, empty/error states and focus restoration',
      async () => {
        const page = await interactive.newPage()
        await open(page, '/introduction')
        const trigger = page.getByRole('button', { name: 'Search documentation', exact: true })
        await trigger.focus()
        await page.keyboard.press('Control+k')
        const search = page.getByRole('combobox', { name: 'Search documentation' })
        await expect(search).toBeFocused()
        await search.fill('Slack')
        await expect(page.getByRole('option').first()).toBeVisible()
        await page.screenshot({ path: join(directory, 'search-results.png') })
        await search.press('ArrowDown')
        await search.press('Enter')
        await expect(page).not.toHaveURL(new URL('/introduction', target).href)
        await page.getByRole('button', { name: 'Search documentation', exact: true }).click()
        await search.fill('zzzz-no-such-content-zzzz')
        await expect(page.getByRole('status')).toContainText('No results')
        await page.route('**/api/search?*', (route) => route.fulfill({ status: 503, body: '{}' }))
        await search.fill('failure-case')
        await expect(page.getByRole('status')).toContainText('Search is unavailable')
        await page.unroute('**/api/search?*')
        await page.getByRole('button', { name: 'Try again', exact: true }).click()
        await expect(page.getByRole('status')).toContainText('No results')
        await search.press('Escape')
        await expect(
          page.getByRole('button', { name: 'Search documentation', exact: true })
        ).toBeFocused()
      }
    )
    await check('Closing search aborts a pending request', async () => {
      const page = await interactive.newPage()
      try {
        await open(page, '/introduction')
        await page.route('**/api/search?query=cancel-request', () => {})
        await page.getByRole('button', { name: 'Search documentation', exact: true }).click()
        const requested = page.waitForRequest((request) =>
          request.url().includes('query=cancel-request')
        )
        const failed = page.waitForEvent('requestfailed', {
          predicate: (request) => request.url().includes('query=cancel-request'),
          timeout: 10000,
        })
        await page.getByRole('combobox', { name: 'Search documentation' }).fill('cancel-request')
        await requested
        await page.keyboard.press('Escape')
        expect((await failed).failure()?.errorText).toContain('ERR_ABORTED')
        await expect(page.getByRole('dialog')).toHaveCount(0)
      } finally {
        await page.unrouteAll({ behavior: 'ignoreErrors' })
        await page.close()
      }
    })
    await check('Explicit theme choice survives reload', async () => {
      const page = await interactive.newPage()
      await open(page, '/introduction')
      await page.getByRole('button', { name: 'Dark', exact: true }).click()
      await expect(page.locator('html')).toHaveClass(/dark/)
      await page.reload()
      await expect(page.locator('html')).toHaveClass(/dark/)
      await page.getByRole('button', { name: 'Light', exact: true }).click()
      await expect(page.locator('html')).toHaveClass(/light/)
    })
  } finally {
    await interactive.close()
  }
  const mobileSearch = await browser.newContext({ viewport: { width: 390, height: 844 } })
  try {
    await check(
      'Mobile navigation search opens its result and dismisses both dialogs',
      async () => {
        const page = await mobileSearch.newPage()
        await open(page, '/introduction')
        await page.getByRole('button', { name: 'Menu', exact: true }).click()
        await page
          .getByRole('dialog', { name: 'Documentation', exact: true })
          .getByRole('button', { name: 'Search documentation', exact: true })
          .click()
        const search = page.getByRole('combobox', { name: 'Search documentation' })
        await search.fill('Slack')
        await expect(page.getByRole('option').first()).toBeVisible()
        await page.screenshot({ path: join(directory, 'mobile-search-results.png') })
        await search.press('Enter')
        await expect(page).toHaveURL(new URL('/integrations/slack', target).href)
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await expect(
          page.getByRole('heading', { level: 1, name: 'Slack', exact: true })
        ).toBeVisible()
        await page.screenshot({ path: join(directory, 'mobile-search-navigation.png') })
      }
    )
  } finally {
    await mobileSearch.close()
  }
  const largeReference = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  })
  try {
    await check(
      'Large Cloudflare reference remains responsive with contained tables and keyboard search',
      async () => {
        const page = await largeReference.newPage()
        await open(page, '/integrations/cloudflare')
        const metrics = await page.evaluate(() => ({
          readyAtMs: performance.now(),
          navigation: performance.getEntriesByType('navigation').map((entry) => entry.toJSON()),
          scripts: performance
            .getEntriesByType('resource')
            .filter((entry) => (entry as PerformanceResourceTiming).initiatorType === 'script')
            .map((entry) => entry.toJSON()),
        }))
        await writeFile(
          join(directory, 'cloudflare-performance.json'),
          `${JSON.stringify(metrics, null, 2)}\n`
        )
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        ).toBe(true)
        const disclosure = page.locator('main details').first()
        await disclosure.locator('summary').click()
        await expect(disclosure).toHaveAttribute('open', '')
        const table = disclosure.getByRole('region', { name: 'Scrollable reference table' }).first()
        await expect(table).toBeVisible()
        const geometry = await table.evaluate((element) => ({
          left: element.getBoundingClientRect().left,
          right: element.getBoundingClientRect().right,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          codeEntries: element.querySelectorAll('code').length,
        }))
        expect(geometry.left).toBeGreaterThanOrEqual(0)
        expect(geometry.right).toBeLessThanOrEqual(390)
        expect(geometry.codeEntries).toBeGreaterThan(0)
        if (geometry.scrollWidth > geometry.clientWidth + 1) {
          await table.focus()
          await table.press('ArrowRight')
          await expect
            .poll(() => table.evaluate((element) => element.scrollLeft))
            .toBeGreaterThan(0)
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        ).toBe(true)
        await page.screenshot({ path: join(directory, 'cloudflare-mobile-table.png') })
        await page.keyboard.press('Control+k')
        const search = page.getByRole('combobox', { name: 'Search documentation' })
        await expect(search).toBeFocused()
        await search.fill('Slack')
        await expect(page.getByRole('option').first()).toBeVisible()
        await page.screenshot({ path: join(directory, 'cloudflare-mobile-search.png') })
        await search.press('Escape')
        await expect(page.getByRole('dialog')).toHaveCount(0)
      }
    )
  } finally {
    await largeReference.close()
  }
} catch (error) {
  results.push({
    name: 'Browser lifecycle',
    status: 'failed',
    durationMs: 0,
    error: getErrorMessage(error),
  })
} finally {
  await browser?.close()
  await writeFile(reportPath, `${JSON.stringify({ origin: target.origin, results }, null, 2)}\n`)
}
logger.info('Verified documentation navigation', { checks: results.length, reportPath })
if (results.some((result) => result.status === 'failed')) process.exitCode = 1
