import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  type Browser,
  type BrowserContext,
  chromium,
  expect,
  type Locator,
  type Page,
  type Video,
  webkit,
} from '@playwright/test'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'

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
const canonicalOrigin = new URL(process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.sim.ai').origin
const engine = process.env.DOCS_NAVIGATION_BROWSER ?? 'chromium'
if (engine !== 'chromium' && engine !== 'webkit')
  throw new Error('DOCS_NAVIGATION_BROWSER must be chromium or webkit')
const results: Array<{
  name: string
  status: 'passed' | 'failed' | 'unavailable'
  durationMs: number
  error?: string
}> = []
await mkdir(directory, { recursive: true })

async function check(name: string, action: () => Promise<void>, unavailable?: string) {
  if (process.env.DOCS_NAVIGATION_FILTER && !name.includes(process.env.DOCS_NAVIGATION_FILTER))
    return
  logger.info('Running', { name })
  const started = performance.now()
  if (unavailable) {
    results.push({ name, status: 'unavailable', durationMs: 0, error: unavailable })
    return
  }
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
  await writeFile(
    reportPath,
    `${JSON.stringify({ origin: target.origin, engine, results }, null, 2)}\n`
  )
}

async function open(page: Page, path: string) {
  const response = await page.goto(new URL(path, target).href, { waitUntil: 'domcontentloaded' })
  expect(response?.ok() || response?.status() === 304).toBe(true)
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await expect(
    page.getByRole('group', { name: 'Color theme' }).last().getByRole('button', { pressed: true })
  ).toHaveCount(1)
}

async function verifyClientMetadata(page: Page, path: string, title: string) {
  const description = (await page.locator('main > div > header > p').textContent())?.trim()
  expect(description).toBeTruthy()
  await expect(page).toHaveTitle(`${title} | Sim Docs`)
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `${canonicalOrigin}${path}`
  )
  await expect(page.locator('meta[name="description"]')).toHaveCount(1)
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    description ?? ''
  )
  return {
    path,
    title: await page.title(),
    canonical: await page.locator('link[rel="canonical"]').getAttribute('href'),
    description,
  }
}

async function copyMenu(page: Page) {
  const item = page.getByRole('menuitem', {
    name: /^(Copy Markdown|Copied|Copy prepared Markdown)$/,
  })
  if (!(await item.isVisible()))
    await page
      .getByRole('button', { name: /^(Page actions|Copy page options)$/, exact: true })
      .click()
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
  browser = await (engine === 'webkit' ? webkit : chromium).launch()
  const noScript = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1440, height: 1000 },
  })
  try {
    for (const scenario of [
      { path: '/getting-started', title: 'Getting started', tabbed: false },
      { path: '/mcp/overview', title: 'Sim MCP', tabbed: true },
      { path: '/api-reference/logs/getLog', title: 'Get log', tabbed: true },
    ]) {
      await check(`JavaScript-disabled reading: ${scenario.path}`, async () => {
        const page = await noScript.newPage()
        try {
          const response = await page.goto(new URL(scenario.path, target).href, {
            waitUntil: 'load',
          })
          expect(response?.ok()).toBe(true)
          await expect(
            page.getByRole('heading', { level: 1, name: scenario.title, exact: true })
          ).toBeVisible()
          const article = page.locator('main article')
          await expect(article).toBeVisible()
          expect((await article.innerText()).trim().length).toBeGreaterThan(100)
          const panels = page
            .getByRole('tabpanel', { includeHidden: true })
            .or(page.locator('[id^="response-example-"]'))
          const observations = []
          for (const panel of await panels.all()) {
            observations.push({
              id: await panel.getAttribute('id'),
              visible: await panel.isVisible(),
              contentLength: (await panel.textContent())?.trim().length ?? 0,
            })
          }
          const stem = scenario.path.replaceAll('/', '-')
          await writeFile(
            join(directory, `no-javascript${stem}.json`),
            `${JSON.stringify({ path: scenario.path, javaScriptEnabled: false, panels: observations }, null, 2)}\n`
          )
          await page.screenshot({ path: join(directory, `no-javascript${stem}.png`) })
          if (scenario.tabbed) {
            expect(observations.length).toBeGreaterThan(1)
            for (const panel of await panels.all()) {
              await expect(panel).toBeVisible()
              expect((await panel.innerText()).trim().length).toBeGreaterThan(0)
            }
          } else {
            const next = article.getByRole('link', { name: 'Build a research agent', exact: true })
            await next.click()
            await expect(page).toHaveURL(new URL('/getting-started/research-agent', target).href)
            await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
          }
          const disclosure = page
            .locator('main details:not([open])')
            .filter({ visible: true })
            .first()
          if (await disclosure.count()) {
            const element = await disclosure.elementHandle()
            if (!element) throw new Error('Native reference disclosure disappeared')
            await disclosure.locator('summary').first().click()
            await expect.poll(() => element.getAttribute('open')).toBe('')
          }
        } finally {
          await page.close()
        }
      })
    }
  } finally {
    await noScript.close()
  }
  const sidebarContext = await browser.newContext({
    viewport: { width: 1440, height: 640 },
    reducedMotion: 'reduce',
  })
  try {
    await check(
      'Sidebar keeps its scroll position when opening Logs and navigating back',
      async () => {
        const page = await sidebarContext.newPage()
        await open(page, '/introduction')
        await page
          .getByRole('heading', { name: /^Models and integrations/ })
          .scrollIntoViewIfNeeded()
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
        const navigation = page.getByRole('navigation', { name: 'Documentation sidebar' })
        const logs = navigation.getByRole('link', { name: 'Logs and debugging', exact: true })
        await logs.scrollIntoViewIfNeeded()
        const scrollPosition = () =>
          navigation.evaluate((element) => element.closest('aside')?.scrollTop ?? 0)
        const before = await scrollPosition()
        expect(before).toBeGreaterThan(0)
        await logs.click()
        await expect(page).toHaveURL(new URL('/logs-debugging', target).href)
        await expect(logs).toHaveAttribute('aria-current', 'page')
        await expect.poll(scrollPosition).toBeCloseTo(before, 0)
        await expect(logs).toBeInViewport()
        await expect(
          page.getByRole('heading', { level: 1, name: 'Logs', exact: true })
        ).toBeInViewport()
        const runLogs = navigation.getByRole('link', { name: 'Run logs', exact: true })
        await runLogs.scrollIntoViewIfNeeded()
        const nestedBefore = await scrollPosition()
        await runLogs.click()
        await expect(page).toHaveURL(new URL('/logs-debugging/logging', target).href)
        await expect(runLogs).toHaveAttribute('aria-current', 'page')
        await expect.poll(scrollPosition).toBeCloseTo(nestedBefore, 0)
        await expect(runLogs).toBeInViewport()
        await page.goBack()
        await expect(logs).toHaveAttribute('aria-current', 'page')
        await expect.poll(scrollPosition).toBeCloseTo(nestedBefore, 0)
        await page.mouse.move(720, 80)
        await page.screenshot({
          path: join(directory, 'sidebar-preserved.png'),
          animations: 'disabled',
        })
      }
    )
  } finally {
    await sidebarContext.close()
  }
  const drawerContext = await browser.newContext({ viewport: { width: 390, height: 640 } })
  try {
    await check(
      'Mobile sidebar keeps its scroll position when reopened after navigation',
      async () => {
        const page = await drawerContext.newPage()
        await open(page, '/introduction')
        await page.getByRole('button', { name: 'Menu', exact: true }).click()
        const navigation = page.getByRole('navigation', { name: 'Documentation sidebar' })
        await navigation.getByRole('button', { name: 'Expand Overview', exact: true }).click()
        const logs = navigation.getByRole('link', { name: 'Logs and debugging', exact: true })
        await logs.scrollIntoViewIfNeeded()
        const scrollPosition = () =>
          navigation.evaluate((element) => element.parentElement?.scrollTop ?? 0)
        const before = await scrollPosition()
        expect(before).toBeGreaterThan(0)
        await logs.click()
        await expect(page).toHaveURL(new URL('/logs-debugging', target).href)
        await expect(page.getByRole('dialog')).toBeHidden()
        await page.getByRole('button', { name: 'Menu', exact: true }).click()
        await expect(logs).toHaveAttribute('aria-current', 'page')
        await expect.poll(scrollPosition).toBeCloseTo(before, 0)
        await expect(logs).toBeInViewport()
        await page.getByRole('button', { name: 'Close navigation' }).click()
        await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeFocused()
      }
    )
  } finally {
    await drawerContext.close()
  }
  for (const { width, dpr } of [
    { width: 390, dpr: 3 },
    { width: 768, dpr: 2 },
    { width: 1440, dpr: 1 },
  ]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      deviceScaleFactor: dpr,
    })
    try {
      for (const scene of [
        {
          path: '/introduction',
          image: 'platform.webp',
          background: 'san-francisco',
          variant: 'hero',
        },
        {
          path: '/files',
          image: 'files-markdown.webp',
          background: 'architecture',
          variant: 'overview',
        },
        {
          path: '/logs-debugging',
          image: 'log-trace.webp',
          background: 'canyon',
          variant: 'detail',
        },
        {
          path: '/search/ask-questions',
          image: 'launch-update-draft.webp',
          background: 'architecture',
          variant: 'result',
        },
      ]) {
        await check(`Screenshot framing: ${scene.variant} at ${width}px DPR${dpr}`, async () => {
          const page = await context.newPage()
          try {
            await open(page, scene.path)
            const figure = page
              .locator('figure')
              .filter({ has: page.locator(`img[src*="${scene.image.replace('.webp', '')}"]`) })
            const screenshot = figure.getByRole('img')
            await figure.scrollIntoViewIfNeeded()
            await expect
              .poll(() =>
                screenshot.evaluate(
                  (element) =>
                    element instanceof HTMLImageElement &&
                    element.complete &&
                    element.naturalWidth > 0
                )
              )
              .toBe(true)
            const background = figure.locator('img[aria-hidden="true"]')
            await expect(background).toHaveCount(1)
            await expect
              .poll(() =>
                background.evaluate(
                  (element) =>
                    element instanceof HTMLImageElement &&
                    element.complete &&
                    element.naturalWidth > 0
                )
              )
              .toBe(true)
            await expect(background).toHaveAttribute(
              'src',
              new RegExp(`${scene.background}(?:\\.[a-zA-Z0-9_-]+)?\\.webp`)
            )
            const delivery = await screenshot.evaluate((element) => {
              if (!(element instanceof HTMLImageElement)) throw new Error('Screenshot is missing')
              const source = new URL(element.currentSrc)
              return {
                currentSrc: element.currentSrc,
                srcset: element.srcset,
                sizes: element.sizes,
                requestedWidth: Number(source.searchParams.get('w')),
                renderedWidth: element.getBoundingClientRect().width,
                sourceWidth: Number(element.getAttribute('width')),
                dpr: devicePixelRatio,
                resources: performance
                  .getEntriesByName(element.currentSrc)
                  .map((entry) => entry.toJSON()),
              }
            })
            await writeFile(
              join(directory, `image-delivery-${scene.variant}-${width}-dpr${dpr}.json`),
              `${JSON.stringify(delivery, null, 2)}\n`
            )
            expect(delivery.requestedWidth).toBeGreaterThan(0)
            expect(delivery.requestedWidth).toBeLessThanOrEqual(
              Math.max(delivery.sourceWidth, delivery.renderedWidth * dpr * 2)
            )
            const geometry = await screenshot.evaluate((element) => {
              const backdrop = element.closest('figure')?.querySelector('img[aria-hidden="true"]')
              const frame = backdrop?.parentElement?.getBoundingClientRect()
              const image = element.getBoundingClientRect()
              if (!frame) throw new Error('Screenshot has no background frame')
              return {
                left: (image.left - frame.left) / frame.width,
                right: (frame.right - image.right) / frame.width,
                top: (image.top - frame.top) / frame.width,
                bottom: (frame.bottom - image.bottom) / frame.width,
                aspect: frame.width / frame.height,
                heroTop: (image.top - frame.top) / frame.height,
                width: image.width / frame.width,
              }
            })
            if (scene.variant === 'hero') {
              expect(geometry.aspect).toBeCloseTo(width < 640 ? 2 : 50 / 19, 1)
              expect(Math.abs(geometry.left - (width < 640 ? 0.06 : 0.11))).toBeLessThan(0.008)
              expect(Math.abs(geometry.width - (width < 640 ? 0.88 : 0.78))).toBeLessThan(0.012)
              expect(Math.abs(geometry.heroTop - (width < 640 ? 0.14 : 0.184))).toBeLessThan(0.015)
              expect(geometry.bottom).toBeLessThan(0)
            } else {
              const side = scene.variant === 'overview' ? 0.07 : 0.05
              expect(Math.abs(geometry.left - side)).toBeLessThan(0.008)
              expect(Math.abs(geometry.right - side)).toBeLessThan(0.008)
              expect(
                Math.abs(geometry.top - (scene.variant === 'overview' ? 0.06 : 0.05))
              ).toBeLessThan(0.008)
              expect(
                Math.abs(geometry.bottom - (scene.variant === 'detail' ? 0.05 : 0))
              ).toBeLessThan(0.008)
            }
            await page.mouse.move(width - 5, 5)
            await page.screenshot({
              path: join(directory, `image-${scene.variant}-${width}.png`),
              animations: 'disabled',
            })
            await figure.getByRole('button').click()
            const viewer = page.getByRole('dialog')
            await expect(viewer.getByRole('img')).toBeVisible()
            await expect
              .poll(() =>
                viewer
                  .getByRole('img')
                  .evaluate(
                    (element) =>
                      element instanceof HTMLImageElement &&
                      element.complete &&
                      element.naturalWidth > 0
                  )
              )
              .toBe(true)
            const expandedImage = await viewer.getByRole('img').evaluate((element) => {
              if (!(element instanceof HTMLImageElement)) throw new Error('Viewer image is missing')
              const rect = element.getBoundingClientRect()
              const style = getComputedStyle(element)
              const width =
                rect.width -
                Number.parseFloat(style.borderLeftWidth) -
                Number.parseFloat(style.borderRightWidth)
              const height =
                rect.height -
                Number.parseFloat(style.borderTopWidth) -
                Number.parseFloat(style.borderBottomWidth)
              return {
                ratio: width / height,
                naturalRatio: element.naturalWidth / element.naturalHeight,
                radius: Number.parseFloat(style.borderTopLeftRadius),
              }
            })
            expect(Math.abs(expandedImage.ratio - expandedImage.naturalRatio)).toBeLessThan(0.01)
            expect(expandedImage.radius).toBeGreaterThan(0)
            await expect(viewer.locator('img[aria-hidden="true"]')).toHaveAttribute(
              'src',
              new RegExp(`${scene.background}(?:\\.[a-zA-Z0-9_-]+)?\\.webp`)
            )
            if (scene.variant === 'hero')
              await page.screenshot({
                path: join(directory, `expanded-platform-${width}.png`),
                animations: 'disabled',
              })
            await page.keyboard.press('Escape')
            await expect(viewer).toHaveCount(0)
          } finally {
            await page.close()
          }
        })
      }
    } finally {
      await context.close()
    }
  }
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
          `${viewport.name}: navigation${engine === 'chromium' ? ' and complete copy' : ''}${viewport.name === 'desktop' && scenario.path === '/introduction' ? ' and client metadata' : ''} for ${scenario.path}`,
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
            const checkMetadata = viewport.name === 'desktop' && scenario.path === '/introduction'
            const sourceMetadata = checkMetadata
              ? await verifyClientMetadata(page, scenario.path, scenario.title)
              : undefined
            const sourceTimeOrigin = checkMetadata
              ? await page.evaluate(() => performance.timeOrigin)
              : undefined
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
            if (viewport.name === 'desktop' && engine === 'chromium') {
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
              if (checkMetadata) {
                const destinationMetadata = await verifyClientMetadata(
                  page,
                  '/platform/costs',
                  'Credits, billing and limits'
                )
                expect(await page.evaluate(() => performance.timeOrigin)).toBe(sourceTimeOrigin)
                expect(destinationMetadata.description).not.toBe(sourceMetadata?.description)
                await writeFile(
                  join(directory, 'metadata-after-client-navigation.json'),
                  `${JSON.stringify({ source: sourceMetadata, destination: destinationMetadata, sameDocument: true }, null, 2)}\n`
                )
              }
              if (viewport.name === 'mobile') {
                await expect(page.getByRole('dialog')).not.toBeVisible()
                await page.getByRole('button', { name: 'Menu', exact: true }).click()
              }
              await expect(costs).toHaveAttribute('aria-current', 'page')
              await expect(branch).toHaveAttribute('aria-expanded', 'true')
              if (viewport.name === 'mobile')
                await page.getByRole('button', { name: 'Close navigation' }).click()
              else if (engine === 'chromium')
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

  const languageContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  try {
    await check('API language preference survives navigation and reload', async () => {
      const page = await languageContext.newPage()
      await open(page, '/api-reference/workflows/listWorkflows')
      const sourceMetadata = await verifyClientMetadata(
        page,
        '/api-reference/workflows/listWorkflows',
        'List workflows'
      )
      const sourceTimeOrigin = await page.evaluate(() => performance.timeOrigin)
      const languages = page.getByRole('tablist', { name: 'Request language', exact: true })
      const javascript = languages.getByRole('tab', { name: /^(JavaScript|TypeScript)$/ })
      await javascript.click()
      await expect(javascript).toHaveAttribute('aria-selected', 'true')
      const navigation = page.getByRole('navigation', { name: 'Documentation sidebar' })
      const destination = navigation.locator('a[href="/api-reference/logs/getLog"]')
      if (!(await destination.isVisible()))
        await navigation.getByRole('button', { name: /^(Expand |Collapse )?Logs$/ }).click()
      await destination.click()
      await expect(page).toHaveURL(new URL('/api-reference/logs/getLog', target).href)
      await expect(
        page.getByRole('heading', { level: 1, name: 'Get log', exact: true })
      ).toBeVisible()
      const destinationMetadata = await verifyClientMetadata(
        page,
        '/api-reference/logs/getLog',
        'Get log'
      )
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(sourceTimeOrigin)
      await writeFile(
        join(directory, 'api-metadata-after-client-navigation.json'),
        `${JSON.stringify({ source: sourceMetadata, destination: destinationMetadata, sameDocument: true }, null, 2)}\n`
      )
      await page.screenshot({ path: join(directory, 'api-language-after-navigation.png') })
      await expect(javascript).toHaveAttribute('aria-selected', 'true')
      await page.reload()
      await expect(javascript).toHaveAttribute('aria-selected', 'true')
      const panelId = await javascript.getAttribute('aria-controls')
      if (!panelId) throw new Error('Selected language has no sample panel')
      await expect(page.locator(`[id="${panelId}"]`)).toBeVisible()
      await page.screenshot({ path: join(directory, 'api-language-after-reload.png') })
    })
    await check(
      'Streaming response formats expose their type without changing request language',
      async () => {
        const page = await languageContext.newPage()
        try {
          await open(page, '/api-reference/workflows/executeWorkflowV2')
          const language = page.getByRole('combobox', { name: 'Request status', exact: true })
          const python = await language
            .getByRole('option', { name: /^Python/ })
            .first()
            .getAttribute('value')
          if (!python) throw new Error('Execute workflow has no Python request example')
          await language.selectOption(python)
          await expect(language).toHaveValue(python)
          const requestId = await language.getAttribute('aria-controls')
          if (!requestId) throw new Error('Selected request has no sample panel')
          const request = page.locator(`[id="${requestId}"] code`)
          const originalSample = await request.textContent()
          const formats = page.getByRole('tablist', {
            name: '200 response content type',
            exact: true,
          })
          const observations = []
          const missingTypes: string[] = []
          for (const [index, format] of [
            'application/json',
            'application/x-ndjson',
            'text/event-stream',
          ].entries()) {
            const tab = formats.getByRole('tab', { name: format, exact: true })
            await tab.click()
            await expect(tab).toHaveAttribute('aria-selected', 'true')
            const panelId = await tab.getAttribute('aria-controls')
            if (!panelId) throw new Error(`Response format ${format} has no panel`)
            const panel = page.locator(`[id="${panelId}"]`)
            await expect(panel).toBeVisible()
            await expect(language).toHaveValue(python)
            await expect(request).toHaveText(originalSample ?? '')
            const stringTypeVisible = await panel
              .getByText('string', { exact: true })
              .first()
              .isVisible()
            if (format !== 'application/json' && !stringTypeVisible) missingTypes.push(format)
            if (format === 'application/json')
              expect((await panel.innerText()).trim().length).toBeGreaterThan(0)
            observations.push({
              format,
              stringTypeVisible,
              requestLanguage: 'Python',
              requestSampleUnchanged: true,
              contentLength: (await panel.innerText()).trim().length,
            })
            await panel.scrollIntoViewIfNeeded()
            await page.screenshot({
              path: join(directory, `streaming-response-format-${index}.png`),
            })
          }
          await writeFile(
            join(directory, 'streaming-response-formats.json'),
            `${JSON.stringify(observations, null, 2)}\n`
          )
          expect(missingTypes, 'Streaming response schemas must display their string type').toEqual(
            []
          )
        } finally {
          await page.close()
        }
      }
    )
    await check('API language preference tolerates an unavailable stored language', async () => {
      const page = await languageContext.newPage()
      await open(page, '/api-reference/logs/getLog')
      await page.evaluate(() => sessionStorage.setItem('docs-tab:api-request-language', 'rust'))
      await page.reload()
      const languages = page.getByRole('tablist', { name: 'Request language', exact: true })
      await expect(languages.getByRole('tab', { name: 'cURL', exact: true })).toHaveAttribute(
        'aria-selected',
        'true'
      )
      expect(
        await page.evaluate(() => sessionStorage.getItem('docs-tab:api-request-language'))
      ).toBe('rust')
      await languages.getByRole('tab', { name: 'Python', exact: true }).click()
      await expect(languages.getByRole('tab', { name: 'Python', exact: true })).toHaveAttribute(
        'aria-selected',
        'true'
      )
      await page.screenshot({ path: join(directory, 'api-language-unavailable-fallback.png') })
      expect(
        await page.evaluate(() => sessionStorage.getItem('docs-tab:api-request-language'))
      ).toBe('python')
      await page.reload()
      await expect(languages.getByRole('tab', { name: 'Python', exact: true })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    })
  } finally {
    await languageContext.close()
  }

  const legacy = await browser.newContext({
    permissions: engine === 'chromium' ? ['clipboard-read', 'clipboard-write'] : [],
  })
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
      },
      engine === 'webkit'
        ? 'Playwright WebKit does not support granting clipboard-read/write permissions; Chromium owns clipboard readback verification.'
        : undefined
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
          if (width >= 1280) {
            const outline = await page
              .getByRole('navigation', { name: 'On this page', exact: true })
              .filter({ visible: true })
              .boundingBox()
            const action = await page
              .getByRole('link', { name: 'Try for free', exact: true })
              .boundingBox()
            const article = await page.getByRole('main').boundingBox()
            if (!outline || !action || !article)
              throw new Error('Desktop reading columns are missing')
            expect(Math.abs(outline.x + outline.width - action.x - action.width)).toBeLessThan(1)
            expect(article.width).toBeGreaterThan(680)
          }
          await page.screenshot({ path: join(directory, `responsive-${colorScheme}-${width}.png`) })
        })
      } finally {
        await context.close()
      }
    }
  }

  for (const viewport of [
    { name: 'short phone', width: 320, height: 480, dpr: 2 },
    { name: 'landscape phone', width: 844, height: 390, dpr: 3 },
    { name: 'short laptop', width: 1280, height: 600, dpr: 1 },
    { name: '200 percent zoom-equivalent viewport', width: 720, height: 450, dpr: 2 },
  ]) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: viewport.dpr,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    })
    try {
      await check(`Constrained viewport: ${viewport.name}`, async () => {
        const page = await context.newPage()
        await open(page, '/getting-started')
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        )
        if (viewport.width < 1024) {
          await page.getByRole('button', { name: 'Menu', exact: true }).click()
          const close = page.getByRole('button', { name: 'Close navigation', exact: true })
          await expect(close).toBeInViewport()
          await close.click()
        }
        await page.keyboard.press('Control+k')
        const search = page.getByRole('dialog', { name: 'Search documentation', exact: true })
        await expect(search).toBeVisible()
        await expect(search.getByRole('combobox')).toBeFocused()
        await expect(search.getByRole('button', { name: 'Close search' })).toBeInViewport()
        const bounds = await search.boundingBox()
        if (!bounds) throw new Error('Search dialog has no bounds')
        expect(bounds.y).toBeGreaterThanOrEqual(0)
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
        await page.screenshot({
          path: join(directory, `constrained-${viewport.width}-${viewport.height}.png`),
        })
        await page.keyboard.press('Escape')
        await expect(search).toHaveCount(0)
      })
    } finally {
      await context.close()
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
            for (const currentLink of await page
              .locator('nav[aria-label="On this page"] a[href="#create-a-workflow"]')
              .all()) {
              await expect(currentLink).toHaveAttribute('aria-current', 'location')
            }
            const heading = await page.locator('#create-a-workflow').boundingBox()
            const header = await page.getByRole('banner').boundingBox()
            const menu = page.getByRole('button', { name: 'Menu', exact: true })
            const toolbar = (await menu.isVisible()) ? await menu.boundingBox() : null
            const chromeBottom = toolbar ? toolbar.y + toolbar.height : (header?.height ?? 0)
            expect(heading?.y).toBeGreaterThan(chromeBottom + 8)
            expect(heading?.y).toBeLessThan(chromeBottom + 40)
            await page.screenshot({
              path: join(directory, `toc-anchor-${width}.png`),
              animations: 'disabled',
            })
            if (width < 1280)
              await page
                .getByText('On this page', { exact: true })
                .filter({ visible: true })
                .click()
            await page.getByRole('link', { name: 'Next steps', exact: true }).click()
            for (const lastLink of await page
              .locator('nav[aria-label="On this page"] a[href="#next-steps"]')
              .all()) {
              await expect(lastLink).toHaveAttribute('aria-current', 'location')
            }
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
        const trigger = page.getByRole('button', {
          name: /^(Search documentation|Search docs)$/,
          exact: true,
        })
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
          await page
            .getByRole('button', { name: /^(Search documentation|Search docs)$/, exact: true })
            .click()
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
        const trigger = page.getByRole('button', {
          name: /^(Search documentation|Search docs)$/,
          exact: true,
        })
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
        await page
          .getByRole('button', { name: /^(Search documentation|Search docs)$/, exact: true })
          .click()
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
          page.getByRole('button', { name: /^(Search documentation|Search docs)$/, exact: true })
        ).toBeFocused()
      }
    )
    await check('Closing search aborts a pending request', async () => {
      const page = await interactive.newPage()
      try {
        await open(page, '/introduction')
        await page.route('**/api/search?query=cancel-request', () => {})
        await page
          .getByRole('button', { name: /^(Search documentation|Search docs)$/, exact: true })
          .click()
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
        expect((await failed).failure()?.errorText).toMatch(/abort|cancel/i)
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
  const interactionRecording: { video: Video | null } = { video: null }
  const mobileSearch = await browser.newContext({
    viewport: { width: 390, height: 844 },
    recordVideo:
      engine === 'chromium'
        ? { dir: join(directory, 'recording'), size: { width: 390, height: 844 } }
        : undefined,
  })
  try {
    await check(
      'Mobile navigation search opens its result and dismisses both dialogs',
      async () => {
        const page = await mobileSearch.newPage()
        interactionRecording.video = page.video()
        await open(page, '/introduction')
        // Hold verified states for the review recording, outside performance measurements.
        if (interactionRecording.video) await sleep(600)
        await page.getByRole('button', { name: 'Menu', exact: true }).click()
        await expect(page.getByRole('dialog', { name: 'Documentation', exact: true })).toBeVisible()
        if (interactionRecording.video) await sleep(600)
        await page
          .getByRole('dialog', { name: 'Documentation', exact: true })
          .getByRole('button', { name: /^(Search documentation|Search docs)$/, exact: true })
          .click()
        const search = page.getByRole('combobox', { name: 'Search documentation' })
        await search.fill('Slack')
        await expect(page.getByRole('option').first()).toBeVisible()
        await page.screenshot({ path: join(directory, 'mobile-search-results.png') })
        if (interactionRecording.video) await sleep(600)
        await search.press('Enter')
        await expect(page).toHaveURL(new URL('/integrations/slack', target).href)
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await expect(
          page.getByRole('heading', { level: 1, name: 'Slack', exact: true })
        ).toBeVisible()
        await page.screenshot({ path: join(directory, 'mobile-search-navigation.png') })
        if (interactionRecording.video) await sleep(600)
      }
    )
  } finally {
    await mobileSearch.close()
    if (interactionRecording.video) {
      await interactionRecording.video.saveAs(
        join(directory, 'mobile-drawer-search-navigation.webm')
      )
      await interactionRecording.video.delete()
    }
  }
  const darkSurfaces = await browser.newContext({
    colorScheme: 'dark',
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  })
  try {
    await check(
      'Dark theme respects reduced transparency across navigation and portals',
      async () => {
        const page = await darkSurfaces.newPage()
        const session = await darkSurfaces.newCDPSession(page)
        await session.send('Emulation.setEmulatedMedia', {
          features: [
            { name: 'prefers-color-scheme', value: 'dark' },
            { name: 'prefers-reduced-transparency', value: 'reduce' },
          ],
        })
        await open(page, '/introduction')
        await expect(page.locator('html')).toHaveClass(/dark/)
        const assertOpaque = async (surface: Locator) => {
          await expect(surface).toBeVisible()
          const styles = await surface.evaluate((element) => {
            const style = getComputedStyle(element)
            return { background: style.backgroundColor, blur: style.backdropFilter }
          })
          expect(styles.background).toMatch(/^rgb\(\d+, \d+, \d+\)$/)
          expect(['none', 'blur(0px)']).toContain(styles.blur)
        }
        await assertOpaque(page.locator('header').first())
        await copyMenu(page)
        await assertOpaque(page.getByRole('menu'))
        await page.screenshot({ path: join(directory, 'dark-opaque-menu.png') })
        await page.keyboard.press('Escape')
        await page.keyboard.press('Control+k')
        await assertOpaque(page.getByRole('dialog', { name: 'Search documentation', exact: true }))
        await page.screenshot({ path: join(directory, 'dark-opaque-search.png') })
        await page.keyboard.press('Escape')
        await page
          .getByRole('button', { name: /Open .* in media viewer/ })
          .first()
          .click()
        await assertOpaque(page.getByRole('dialog'))
        await page.screenshot({ path: join(directory, 'dark-opaque-media.png') })
        await page.keyboard.press('Escape')
      },
      engine === 'webkit'
        ? 'Chromium CDP reduced-transparency emulation is unavailable in Playwright WebKit; native OS preference needs manual Safari verification.'
        : undefined
    )
  } finally {
    await darkSurfaces.close()
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
  await writeFile(
    reportPath,
    `${JSON.stringify({ origin: target.origin, engine, limitations: engine === 'webkit' ? ['Clipboard readback and reduced-transparency emulation remain Chromium-only; this is Playwright WebKit, not native Safari.'] : [], results }, null, 2)}\n`
  )
}
logger.info('Verified documentation navigation', { checks: results.length, reportPath })
if (results.some((result) => result.status === 'failed')) process.exitCode = 1
