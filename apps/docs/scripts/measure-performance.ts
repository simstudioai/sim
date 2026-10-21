import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type Browser, chromium, expect } from '@playwright/test'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'

const logger = createLogger('DocsPerformance', { logLevel: 'INFO' })
const origin = process.env.DOCS_PERFORMANCE_BASE_URL ?? process.env.DOCS_E2E_BASE_URL
const reportPath = process.env.DOCS_PERFORMANCE_REPORT_PATH
if (!origin || !reportPath) {
  throw new Error('A docs base URL and DOCS_PERFORMANCE_REPORT_PATH are required')
}
const target = new URL(origin)
if (
  target.protocol !== 'https:' &&
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
) {
  throw new Error('Remote measurements require HTTPS')
}

interface BrowserMetrics {
  lcpMs: number | null
  layoutShiftSum: number
  longTasks: number
  blockingMs: number
  tabPaintMs: number[]
}

declare global {
  interface Window {
    docsPerformance: BrowserMetrics
  }
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
      page.on('pageerror', (error) => errors.push(error.message))
      await page.addInitScript(() => {
        const metrics: BrowserMetrics = {
          lcpMs: null,
          layoutShiftSum: 0,
          longTasks: 0,
          blockingMs: 0,
          tabPaintMs: [],
        }
        window.docsPerformance = metrics
        for (const type of ['largest-contentful-paint', 'layout-shift', 'longtask']) {
          if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (entry.entryType === 'largest-contentful-paint') metrics.lcpMs = entry.startTime
              if (entry.entryType === 'layout-shift' && 'value' in entry) {
                if ('hadRecentInput' in entry && entry.hadRecentInput) continue
                metrics.layoutShiftSum += Number(entry.value)
              }
              if (entry.entryType === 'longtask') {
                metrics.longTasks += 1
                metrics.blockingMs += Math.max(0, entry.duration - 50)
              }
            }
          }).observe({ type, buffered: true })
        }
        document.addEventListener(
          'pointerdown',
          (event) => {
            if (!(event.target instanceof Element)) return
            const tab = event.target.closest('[role="tab"]')
            if (!tab || !tab.closest('[aria-label="Request language"]')) return
            const started = performance.now()
            const measurePaint = () => {
              const panelId = tab.getAttribute('aria-controls')
              const panel = panelId ? document.getElementById(panelId) : null
              if (
                tab.getAttribute('aria-selected') === 'true' &&
                panel &&
                panel.getBoundingClientRect().height > 0 &&
                panel.querySelector('code')?.textContent?.trim()
              ) {
                requestAnimationFrame(() => {
                  if (metrics.tabPaintMs.length < 20)
                    metrics.tabPaintMs.push(performance.now() - started)
                })
              } else if (performance.now() - started < 10000) {
                requestAnimationFrame(measurePaint)
              }
            }
            requestAnimationFrame(measurePaint)
          },
          true
        )
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
        const initial = await page.evaluate(() => {
          const navigation = performance.getEntriesByType('navigation')[0] as
            | PerformanceNavigationTiming
            | undefined
          const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
          return {
            ...window.docsPerformance,
            fcpMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
            ttfbMs: navigation?.responseStart ?? null,
            loadMs: navigation?.loadEventEnd ?? null,
            htmlBytes: navigation?.decodedBodySize ?? null,
            scriptBytes: resources
              .filter((entry) => entry.initiatorType === 'script')
              .reduce((total, entry) => total + entry.encodedBodySize, 0),
            requests: resources.length,
            domElements: document.querySelectorAll('*').length,
          }
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
            await page.evaluate(
              () =>
                new Promise<void>((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
                )
            )
          }
          const recorded = await page.evaluate(() => window.docsPerformance.tabPaintMs.length)
          if (recorded !== count)
            throw new Error(`Expected ${count} tab measurements; recorded ${recorded}`)
        }
        const tabPaintMs = await page.evaluate(() => window.docsPerformance.tabPaintMs)
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
        }
        results.push({
          path,
          viewport: viewport.name,
          status: errors.length ? 'failed' : 'passed',
          durationMs: Math.round(performance.now() - started),
          ...initial,
          tabPaintMs,
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
    `${JSON.stringify({ measuredAt: new Date().toISOString(), origin: target.origin, results }, null, 2)}\n`
  )
}
logger.info('Recorded documentation performance', { pages: results.length, reportPath })
if (failed) process.exitCode = 1
