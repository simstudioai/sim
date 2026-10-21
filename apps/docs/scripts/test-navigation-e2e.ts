import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type Browser, chromium, expect } from '@playwright/test'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'

const logger = createLogger('DocsNavigationE2E', { logLevel: 'INFO' })
const origin = process.env.DOCS_E2E_BASE_URL
const reportPath = process.env.DOCS_NAVIGATION_REPORT_PATH
if (!origin || !reportPath) {
  throw new Error('A docs base URL and DOCS_NAVIGATION_REPORT_PATH are required')
}
const target = new URL(origin)
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
  throw new Error('The documentation server must use a loopback origin')
}

const pages = [
  '/introduction',
  '/getting-started',
  '/files',
  '/integrations/apollo',
  '/api-reference/workflows/listWorkflows',
] as const
const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
] as const
const results: Record<string, unknown>[] = []
let failed = false
await mkdir(dirname(reportPath), { recursive: true })
let browser: Browser | undefined
try {
  browser = await chromium.launch()
  for (const viewport of viewports) {
    for (const path of pages) {
      const started = performance.now()
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' })
      const page = await context.newPage()
      const errors: string[] = []
      const markdownRequests: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('request', (request) => {
        if (new URL(request.url()).pathname.startsWith('/llms.mdx')) {
          markdownRequests.push(request.url())
        }
      })
      try {
        const response = await page.goto(new URL(path, origin).toString(), {
          waitUntil: 'networkidle',
        })
        if (!response?.ok()) throw new Error(`Page returned ${response?.status() ?? 'no response'}`)
        await page.getByRole('heading', { level: 1 }).waitFor()
        await page.evaluate(async () => {
          await document.fonts.ready
        })
        if (path.startsWith('/api-reference/')) {
          const tabs = page.getByRole('tablist', { name: 'Request language' }).getByRole('tab')
          const count = await tabs.count()
          if (count < 2) throw new Error('API request-language controls are missing')
          const selectedIndex = await tabs.evaluateAll((elements) =>
            elements.findIndex((element) => element.getAttribute('aria-selected') === 'true')
          )
          if (selectedIndex < 0) throw new Error('API request language has no selected tab')
          for (let offset = 1; offset <= count; offset += 1) {
            const tab = tabs.nth((selectedIndex + offset) % count)
            await tab.click()
            await expect(tab).toHaveAttribute('aria-selected', 'true')
            await page.waitForFunction(() => {
              const selected = document.querySelector(
                '[aria-label="Request language"] [aria-selected="true"]'
              )
              const panelId = selected?.getAttribute('aria-controls')
              const panel = panelId ? document.getElementById(panelId) : null
              return Boolean(
                panel &&
                  panel.getBoundingClientRect().height > 0 &&
                  panel.querySelector('code')?.textContent?.trim()
              )
            })
          }
        }
        if (viewport.name === 'desktop') {
          const markdownUrl = new URL(`/llms.mdx${path}`, origin).toString()
          const markdown = await page.request.get(markdownUrl)
          expect(markdown.ok()).toBe(true)
          const expected = await markdown.text()
          const copy = page.getByRole('button', { name: 'Copy page content', exact: true })
          await context.grantPermissions(['clipboard-read', 'clipboard-write'])
          expect(markdownRequests).toEqual([])
          await copy.click()
          await expect(page.getByRole('button', { name: 'Copied to clipboard' })).toBeVisible()
          expect(markdownRequests).toEqual([markdownUrl])
          await expect
            .poll(() => page.evaluate(() => navigator.clipboard.readText()))
            .toBe(expected)
          await page.route(markdownUrl, (route) =>
            route.fulfill({ status: 503, body: 'Unavailable' })
          )
          await page.getByRole('button', { name: 'Copied to clipboard' }).click()
          await expect(page.getByRole('status')).toHaveText('Could not copy. Try again.')
          await expect(page.getByRole('button', { name: 'Copied to clipboard' })).toHaveCount(0)
          await expect
            .poll(() => page.evaluate(() => navigator.clipboard.readText()))
            .toBe(expected)
          await page.unroute(markdownUrl)
          await copy.click()
          await expect(page.getByRole('button', { name: 'Copied to clipboard' })).toBeVisible()
        }
        await page.screenshot({
          path: join(dirname(reportPath), `${viewport.name}${path.replaceAll('/', '-')}.png`),
        })
        if (path === '/introduction') {
          const mobile = viewport.name === 'mobile'
          if (mobile) await page.getByRole('button', { name: 'Open Sidebar', exact: true }).click()
          const navigation = page.getByRole(mobile ? 'dialog' : 'complementary', {
            name: 'Documentation navigation',
          })
          const platform = navigation.getByRole('button', { name: 'Platform', exact: true })
          const costs = navigation.getByRole('link', {
            name: 'Credits, billing and limits',
            exact: true,
          })
          await platform.click()
          await expect(costs).toBeVisible()
          await platform.press('Enter')
          await expect(costs).toBeHidden()
          await platform.press('Enter')
          await costs.click()
          await expect(page).toHaveURL(new URL('/platform/costs', origin).toString())
          await expect(
            page.getByRole('heading', {
              level: 1,
              name: 'Credits, billing and limits',
              exact: true,
            })
          ).toBeVisible()
          if (mobile) {
            await expect(navigation).not.toBeVisible()
            await page.getByRole('button', { name: 'Open Sidebar', exact: true }).click()
          }
          await expect(costs).toHaveAttribute('aria-current', 'page')
          await expect(platform).toHaveAttribute('aria-expanded', 'true')
          if (!mobile) {
            const markdown = await page.request.get(
              new URL('/llms.mdx/platform/costs', origin).toString()
            )
            expect(markdown.ok()).toBe(true)
            await page.getByRole('button', { name: 'Copy page content', exact: true }).click()
            await expect(page.getByRole('button', { name: 'Copied to clipboard' })).toBeVisible()
            await expect
              .poll(() => page.evaluate(() => navigator.clipboard.readText()))
              .toBe(await markdown.text())
          }
        }
        results.push({
          path,
          viewport: viewport.name,
          status: errors.length ? 'failed' : 'passed',
          durationMs: Math.round(performance.now() - started),
          errors,
        })
        if (errors.length) failed = true
      } catch (error) {
        failed = true
        results.push({
          path,
          viewport: viewport.name,
          status: 'failed',
          durationMs: Math.round(performance.now() - started),
          error: getErrorMessage(error),
          errors,
        })
      } finally {
        await context.close()
      }
    }
  }
} catch (error) {
  failed = true
  results.push({ path: 'browser', status: 'failed', error: getErrorMessage(error) })
} finally {
  await browser?.close()
  await writeFile(
    reportPath,
    `${JSON.stringify({ checkedAt: new Date().toISOString(), origin: target.origin, results }, null, 2)}\n`
  )
}
logger.info('Verified documentation navigation', { pages: results.length, reportPath })
if (failed) process.exitCode = 1
