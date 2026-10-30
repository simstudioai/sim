import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Locator,
  type Page,
  type Request,
} from '@playwright/test'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'

/** Bounded production measurements: no builds, writes to services, or corpus crawling. */
const logger = createLogger('DocsReadinessBenchmark', { logLevel: 'INFO' })
const exec = promisify(execFile)
const LIGHTHOUSE_VERSION = '13.6.0'
const DEFAULT_ROUTES = [
  '/introduction',
  '/getting-started',
  '/files/editor',
  '/search/find-content',
  '/integrations/cloudflare',
  '/api-reference/logs/getLog',
  '/workflows',
] as const
const PROFILES = [
  { name: 'desktop', width: 1440, height: 1000, dpr: 1, mobile: false, cpu: 1 },
  { name: 'mobile', width: 390, height: 844, dpr: 3, mobile: true, cpu: 4 },
] as const
type Profile = (typeof PROFILES)[number]
interface NetworkRecord {
  url: string
  type: string
  method: string
  prefetch: boolean
  status?: number
  headers?: Record<string, string>
  sizes?: Awaited<ReturnType<Request['sizes']>>
  timing?: ReturnType<Request['timing']>
  failure?: string
}
interface BrowserObservations {
  longTasks: Array<{ startTime: number; duration: number }>
  shifts: Array<{ startTime: number; value: number; hadRecentInput: boolean }>
  events: Array<{ name: string; startTime: number; duration: number }>
  lcp: Array<{ startTime: number; size?: number; url?: string; element?: string }>
  shell?: Element | null
}
interface BrowserWindow extends Window {
  docsBenchmark?: BrowserObservations
}
interface Measurement {
  profile: string
  route: string
  repetition: number
  scenario: string
  status: 'completed' | 'failed' | 'unavailable'
  durationMs: number
  meaningfulPaintMs?: number
  feedbackMs?: number
  mediaReadyMs?: number
  data?: unknown
  error?: string
}

const baseSetting = process.env.DOCS_BENCHMARK_BASE_URL
const revision = process.env.DOCS_BENCHMARK_REVISION
const reportSetting = process.env.DOCS_BENCHMARK_REPORT_PATH
if (!baseSetting || !revision || !reportSetting)
  throw new Error(
    'DOCS_BENCHMARK_BASE_URL, DOCS_BENCHMARK_REVISION and DOCS_BENCHMARK_REPORT_PATH are required'
  )
const reportPath: string = reportSetting
const base = new URL(baseSetting)
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password)
  throw new Error('Use a public HTTP(S) docs URL without credentials')
const mode = process.env.DOCS_BENCHMARK_MODE ?? 'navigation'
if (!['navigation', 'lighthouse'].includes(mode))
  throw new Error('Mode must be navigation or lighthouse')
const repetitions = Number(process.env.DOCS_BENCHMARK_REPETITIONS ?? 3)
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5)
  throw new Error('Repetitions must be an integer from 1 through 5')
const routes = process.env.DOCS_BENCHMARK_ROUTES?.split(',') ?? [...DEFAULT_ROUTES]
if (routes.length > 8 || routes.some((route) => !route.startsWith('/') || route.startsWith('//')))
  throw new Error('Provide at most eight same-origin route paths')
const profiles = PROFILES.filter((profile) =>
  (process.env.DOCS_BENCHMARK_PROFILES?.split(',') ?? ['desktop', 'mobile']).includes(profile.name)
)
if (!profiles.length) throw new Error('No valid benchmark profile selected')
const directory = dirname(reportPath)
const results: Measurement[] = []
const titles = new Map<string, string>()
const startedAt = new Date().toISOString()
const scenarios = new Set(
  process.env.DOCS_BENCHMARK_SCENARIOS?.split(',') ?? ['cold', 'warm', 'navigation', 'interactions']
)
await mkdir(directory, { recursive: true })

function stats(values: number[]) {
  if (!values.length) return { count: 0, median: null, min: null, max: null, raw: values }
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return {
    count: sorted.length,
    median:
      sorted.length % 2 ? sorted[middle] : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2,
    min: sorted[0],
    max: sorted.at(-1),
    raw: values,
  }
}

async function save() {
  const groups = new Map<string, Measurement[]>()
  for (const result of results) {
    const key = `${result.profile}:${result.scenario}:${result.route}`
    groups.set(key, [...(groups.get(key) ?? []), result])
  }
  const summary = [...groups].map(([key, samples]) => ({
    key,
    completed: samples.filter((sample) => sample.status === 'completed').length,
    meaningfulPaintMs: stats(
      samples.flatMap((sample) =>
        sample.meaningfulPaintMs === undefined ? [] : [sample.meaningfulPaintMs]
      )
    ),
    feedbackMs: stats(
      samples.flatMap((sample) => (sample.feedbackMs === undefined ? [] : [sample.feedbackMs]))
    ),
    mediaReadyMs: stats(
      samples.flatMap((sample) => (sample.mediaReadyMs === undefined ? [] : [sample.mediaReadyMs]))
    ),
  }))
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        baseUrl: base.href,
        revision,
        startedAt,
        updatedAt: new Date().toISOString(),
        mode,
        runtime: {
          node: process.version,
          bun: process.versions.bun,
          platform: process.platform,
          architecture: process.arch,
        },
        profiles,
        repetitions,
        routes,
        lighthouseVersion: LIGHTHOUSE_VERSION,
        methodology: {
          concurrency: 1,
          viewportPaint:
            'Visible destination h1 and nonempty article, followed by two animation frames; URL alone is insufficient.',
          feedback:
            'Input action to observable UI state followed by two animation frames; automation overhead is included.',
          media:
            'Visible article images have decoded; measured separately from useful article paint.',
          navigation:
            'Existing site links only. No-hover case aborts prefetch requests and has HTTP cache disabled by Playwright routing. Intent case preserves normal caching and allows 500ms hover/focus dwell.',
          mobileNetwork:
            'Chromium CDP: 150ms latency, 1.6Mbps download, 750Kbps upload, 4x CPU slowdown.',
          lighthouse:
            'Desktop uses provided/unthrottled conditions; mobile uses Lighthouse default simulated throttling. Read each raw report configSettings for exact values.',
          limits:
            'Lab observations, not field Core Web Vitals; three repetitions are reported as median/range, never p95. Performance targets are observations, not brittle pass/fail timing assertions.',
        },
        summary,
        results,
      },
      null,
      2
    )}\n`
  )
}

async function measure(
  profile: Profile,
  route: string,
  repetition: number,
  scenario: string,
  action: () => Promise<
    Omit<Measurement, 'profile' | 'route' | 'repetition' | 'scenario' | 'durationMs'>
  >
) {
  const start = performance.now()
  logger.info('Measuring', { profile: profile.name, route, repetition, scenario })
  try {
    const observation = await action()
    results.push({
      profile: profile.name,
      route,
      repetition,
      scenario,
      durationMs: performance.now() - start,
      ...observation,
    })
  } catch (error) {
    results.push({
      profile: profile.name,
      route,
      repetition,
      scenario,
      status: 'failed',
      durationMs: performance.now() - start,
      error: getErrorMessage(error),
    })
    logger.error('Measurement failed', { route, scenario, error: getErrorMessage(error) })
  }
  await save()
}

async function instrument(context: BrowserContext) {
  await context.addInitScript(() => {
    const state: BrowserObservations = { longTasks: [], shifts: [], events: [], lcp: [] }
    ;(window as BrowserWindow).docsBenchmark = state
    performance.setResourceTimingBufferSize(5000)
    for (const type of ['longtask', 'layout-shift', 'event', 'largest-contentful-paint']) {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (type === 'longtask' && state.longTasks.length < 2000)
            state.longTasks.push({ startTime: entry.startTime, duration: entry.duration })
          else if (type === 'layout-shift' && state.shifts.length < 2000) {
            const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean }
            state.shifts.push({
              startTime: entry.startTime,
              value: shift.value,
              hadRecentInput: shift.hadRecentInput,
            })
          } else if (type === 'event' && state.events.length < 2000)
            state.events.push({
              name: entry.name,
              startTime: entry.startTime,
              duration: entry.duration,
            })
          else if (type === 'largest-contentful-paint') {
            const paint = entry as PerformanceEntry & {
              size?: number
              url?: string
              element?: Element
            }
            state.lcp.push({
              startTime: entry.startTime,
              size: paint.size,
              url: paint.url,
              element: paint.element?.tagName,
            })
          }
        }
      }).observe({ type, buffered: true, ...(type === 'event' ? { durationThreshold: 16 } : {}) })
    }
  })
}

async function contextFor(browser: Browser, profile: Profile, disablePrefetch = false) {
  const context = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: profile.dpr,
    isMobile: profile.mobile,
    hasTouch: profile.mobile,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  })
  if (disablePrefetch)
    await context.route('**/*', async (route) => {
      const headers = route.request().headers()
      if (
        headers['next-router-prefetch'] ||
        headers['next-router-segment-prefetch'] ||
        headers.purpose === 'prefetch'
      )
        await route.abort()
      else await route.continue()
    })
  await instrument(context)
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  page.setDefaultNavigationTimeout(60_000)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  if (profile.mobile) {
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: 1_600_000 / 8,
      uploadThroughput: 750_000 / 8,
    })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu })
  }
  const network: NetworkRecord[] = []
  const requests = new Map<Request, NetworkRecord>()
  const pending: Promise<void>[] = []
  page.on('request', (request) => {
    if (network.length >= 5000) return
    const headers = request.headers()
    const record = {
      url: request.url(),
      type: request.resourceType(),
      method: request.method(),
      prefetch: Boolean(
        headers['next-router-prefetch'] ||
          headers['next-router-segment-prefetch'] ||
          headers.purpose === 'prefetch'
      ),
    }
    requests.set(request, record)
    network.push(record)
  })
  page.on('response', (response) => {
    const record = requests.get(response.request())
    if (!record) return
    record.status = response.status()
    const headers = response.headers()
    record.headers = Object.fromEntries(
      [
        'content-type',
        'content-encoding',
        'content-length',
        'cache-control',
        'etag',
        'last-modified',
        'age',
        'vary',
        'x-vercel-cache',
        'cf-cache-status',
      ].flatMap((key) => (headers[key] ? [[key, headers[key]]] : []))
    )
  })
  page.on('requestfinished', (request) => {
    const record = requests.get(request)
    if (record)
      pending.push(
        request
          .sizes()
          .then((sizes) => {
            record.sizes = sizes
            record.timing = request.timing()
          })
          .catch(() => {})
      )
  })
  page.on('requestfailed', (request) => {
    const record = requests.get(request)
    if (record) record.failure = request.failure()?.errorText
  })
  return { context, page, network, pending, cdp }
}

async function painted(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
}

async function meaningful(page: Page, path: string, title?: string) {
  await page.waitForFunction(
    ({ expectedPath, expectedTitle }) => {
      const heading = document.querySelector('main h1') ?? document.querySelector('h1')
      const article =
        document.querySelector('main article') ??
        document.querySelector('article') ??
        document.querySelector('main')
      return (
        location.pathname.replace(/\/$/, '') === expectedPath.replace(/\/$/, '') &&
        heading instanceof HTMLElement &&
        heading.getClientRects().length > 0 &&
        (!expectedTitle || heading.textContent?.trim() === expectedTitle) &&
        article instanceof HTMLElement &&
        article.getClientRects().length > 0 &&
        (article.textContent?.trim().length ?? 0) > 80
      )
    },
    { expectedPath: path, expectedTitle: title }
  )
  await painted(page)
}

async function visibleMedia(page: Page) {
  return page.evaluate(async () => {
    const images = [...document.querySelectorAll<HTMLImageElement>('main img, article img')].filter(
      (image) => {
        const bounds = image.getBoundingClientRect()
        return (
          bounds.width > 0 && bounds.height > 0 && bounds.top < innerHeight && bounds.bottom > 0
        )
      }
    )
    await Promise.race([
      Promise.all(images.map((image) => image.decode().catch(() => {}))),
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error('Visible media did not decode within 20 seconds')),
          20_000
        )
      ),
    ])
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    return images.map((image) => ({
      src: image.currentSrc,
      loaded: image.complete && image.naturalWidth > 0,
    }))
  })
}

async function snapshot(page: Page, since = 0) {
  return page.evaluate((start) => {
    const state = (window as BrowserWindow).docsBenchmark
    const resources = performance
      .getEntriesByType('resource')
      .filter((entry) => entry.startTime >= start)
      .map((entry) => entry.toJSON())
    return {
      url: location.href,
      title: document.querySelector('h1')?.textContent?.trim(),
      now: performance.now(),
      timeOrigin: performance.timeOrigin,
      domElements: document.getElementsByTagName('*').length,
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      shellPreserved: state?.shell
        ? state.shell === document.querySelector('body header')
        : undefined,
      activeElement:
        document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName,
      navigation: performance.getEntriesByType('navigation').map((entry) => entry.toJSON()),
      resources,
      longTasks: state?.longTasks.filter((entry) => entry.startTime >= start),
      eventTimings: state?.events.filter((entry) => entry.startTime >= start),
      layoutShifts: state?.shifts.filter((entry) => entry.startTime >= start),
      lcp: state?.lcp,
      images: [...document.images].slice(0, 100).map((image) => {
        const bounds = image.getBoundingClientRect()
        return {
          src: image.src,
          currentSrc: image.currentSrc,
          srcset: image.srcset,
          sizes: image.sizes,
          alt: image.alt,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          width: bounds.width,
          height: bounds.height,
          dpr: devicePixelRatio,
          loading: image.loading,
          fetchPriority: image.fetchPriority,
          complete: image.complete,
          objectFit: getComputedStyle(image).objectFit,
          objectPosition: getComputedStyle(image).objectPosition,
        }
      }),
    }
  }, since)
}

async function existingLink(page: Page, route: string): Promise<Locator | null> {
  const exact = page.locator(`a[href="${route}"]`)
  for (let attempt = 0; attempt < 8; attempt++) {
    const visible = exact.filter({ visible: true }).first()
    if (await visible.count()) return visible
    if (attempt === 0) {
      const menu = page
        .getByRole('button', { name: /^(Menu|Open menu|Open navigation|Open sidebar)$/i })
        .filter({ visible: true })
        .first()
      if (await menu.count()) {
        await menu.click()
        continue
      }
    }
    if (await exact.count()) {
      const control = await exact.first().evaluate((element) => {
        let parent = element.parentElement
        while (parent) {
          if (getComputedStyle(parent).display === 'none' || parent.hidden) {
            const trigger = parent.id
              ? document.querySelector<HTMLButtonElement>(
                  `button[aria-controls="${CSS.escape(parent.id)}"]`
                )
              : null
            const candidate =
              trigger ??
              parent.parentElement?.querySelector<HTMLButtonElement>(
                'button[aria-expanded="false"]'
              )
            if (candidate)
              return candidate.getAttribute('aria-label') ?? candidate.textContent?.trim()
          }
          parent = parent.parentElement
        }
        return null
      })
      if (control) {
        const button = page
          .getByRole('button', { name: control, exact: true })
          .filter({ visible: true })
          .first()
        if (await button.count()) {
          await button.click()
          continue
        }
      }
    }
    const section = route.startsWith('/api-reference/') ? /^API reference$/i : /^Documentation$/i
    const sectionLink = page.getByRole('link', { name: section }).filter({ visible: true }).first()
    if (attempt < 2 && (await sectionLink.count())) {
      await sectionLink.click()
      await page.locator('h1').first().waitFor()
      continue
    }
    return null
  }
  return null
}

async function directSamples(
  browser: Browser,
  profile: Profile,
  route: string,
  repetition: number
) {
  const run = await contextFor(browser, profile)
  try {
    for (const scenario of ['cold', 'warm']) {
      if (!scenarios.has(scenario)) continue
      await measure(profile, route, repetition, scenario, async () => {
        const networkStart = run.network.length
        const response =
          scenario === 'cold' || run.page.url() === 'about:blank'
            ? await run.page.goto(new URL(route, base).href, { waitUntil: 'commit' })
            : await run.page.reload({ waitUntil: 'commit' })
        if (!response?.ok()) throw new Error(`Document returned ${response?.status()}`)
        await meaningful(run.page, new URL(route, base).pathname)
        const meaningfulPaintMs = await run.page.evaluate(() => performance.now())
        const media = await visibleMedia(run.page)
        const mediaReadyMs = await run.page.evaluate(() => performance.now())
        await run.page.waitForLoadState('load')
        await sleep(500)
        const data = await snapshot(run.page)
        if (data.title) titles.set(route, data.title)
        await Promise.allSettled(run.pending)
        const metrics = await run.cdp.send('Performance.getMetrics')
        if (repetition === 1 && scenario === 'cold')
          await run.page.screenshot({
            path: join(directory, `${profile.name}-${route.replaceAll('/', '_')}.png`),
          })
        return {
          status: 'completed',
          meaningfulPaintMs,
          mediaReadyMs,
          data: {
            ...data,
            media,
            network: run.network.slice(networkStart),
            chromiumMetrics: metrics,
          },
        }
      })
    }
  } finally {
    await run.context.close()
  }
}

async function navigationSample(
  browser: Browser,
  profile: Profile,
  route: string,
  repetition: number,
  intent: boolean
) {
  const run = await contextFor(browser, profile, !intent)
  try {
    await measure(
      profile,
      route,
      repetition,
      intent ? 'intent-navigation' : 'uncached-navigation',
      async () => {
        const source = route === '/introduction' ? '/getting-started' : '/introduction'
        await run.page.goto(new URL(source, base).href, { waitUntil: 'domcontentloaded' })
        await meaningful(run.page, new URL(source, base).pathname)
        const link = await existingLink(run.page, route)
        if (!link)
          return {
            status: 'unavailable',
            error:
              'No reachable existing navigation link found; do not substitute an injected link or router call.',
          }
        await link.scrollIntoViewIfNeeded()
        const beforeIntent = run.network.length
        if (intent) {
          if (profile.mobile) await link.focus()
          else await link.hover()
          await sleep(500)
        }
        const beforeClick = run.network.length
        const start = await run.page.evaluate(() => {
          const state = (window as BrowserWindow).docsBenchmark
          if (state) state.shell = document.querySelector('body header')
          return performance.now()
        })
        await link.click()
        await meaningful(run.page, new URL(route, base).pathname, titles.get(route))
        const meaningfulPaintMs = await run.page.evaluate((then) => performance.now() - then, start)
        const media = await visibleMedia(run.page)
        const mediaReadyMs = await run.page.evaluate((then) => performance.now() - then, start)
        await sleep(500)
        const data = await snapshot(run.page, start)
        await Promise.allSettled(run.pending)
        const network = run.network.slice(beforeClick)
        const documentReload = network.some((request) => request.type === 'document')
        return {
          status: 'completed',
          meaningfulPaintMs: documentReload ? undefined : meaningfulPaintMs,
          mediaReadyMs: documentReload ? undefined : mediaReadyMs,
          data: {
            ...data,
            documentReload,
            media,
            prefetchDuringIntent: run.network.slice(beforeIntent, beforeClick),
            network,
          },
        }
      }
    )
  } finally {
    await run.context.close()
  }
}

async function interactions(browser: Browser, profile: Profile, repetition: number) {
  const run = await contextFor(browser, profile)
  try {
    await run.page.goto(new URL('/introduction', base).href, { waitUntil: 'domcontentloaded' })
    await meaningful(run.page, new URL('/introduction', base).pathname)
    await measure(profile, '/introduction', repetition, 'search-open', async () => {
      const start = performance.now()
      await run.page.keyboard.press('ControlOrMeta+k')
      const input = run.page
        .getByRole('combobox')
        .or(run.page.getByRole('searchbox'))
        .or(run.page.getByPlaceholder(/Search/))
        .filter({ visible: true })
        .first()
      await input.waitFor()
      await painted(run.page)
      const feedbackMs = performance.now() - start
      return {
        status: 'completed',
        feedbackMs,
        data: { focused: await input.evaluate((element) => document.activeElement === element) },
      }
    })
    await measure(profile, '/introduction', repetition, 'search-result-navigation', async () => {
      const input = run.page
        .getByRole('combobox')
        .or(run.page.getByRole('searchbox'))
        .or(run.page.getByPlaceholder(/Search/))
        .filter({ visible: true })
        .first()
      const start = performance.now()
      await input.fill('Slack')
      const result = run.page.getByRole('option').filter({ hasText: /Slack/i }).first()
      await result.waitFor()
      await painted(run.page)
      const feedbackMs = performance.now() - start
      const navigationStart = performance.now()
      await result.click()
      await run.page.waitForURL((url) => url.pathname !== '/introduction')
      await run.page.locator('h1').first().waitFor()
      await painted(run.page)
      return {
        status: 'completed',
        feedbackMs,
        meaningfulPaintMs: performance.now() - navigationStart,
        data: {
          destination: run.page.url(),
          openDialogs: await run.page.getByRole('dialog').count(),
          ...(await snapshot(run.page)),
        },
      }
    })
    await measure(profile, '/introduction', repetition, 'media-dialog', async () => {
      await run.page.goto(new URL('/introduction', base).href, { waitUntil: 'domcontentloaded' })
      await meaningful(run.page, new URL('/introduction', base).pathname)
      const trigger = run.page.getByRole('button', { name: /Open .*in media viewer/i }).first()
      if (!(await trigger.count()))
        return { status: 'unavailable', error: 'No media viewer trigger on this baseline.' }
      const before = run.network.length
      const start = performance.now()
      await trigger.click()
      const dialog = run.page.getByRole('dialog').first()
      await dialog.waitFor()
      await painted(run.page)
      const feedbackMs = performance.now() - start
      const data = await snapshot(run.page)
      await run.page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      await run.page.waitForFunction(() =>
        document.activeElement?.getAttribute('aria-label')?.includes('media viewer')
      )
      await Promise.allSettled(run.pending)
      return {
        status: 'completed',
        feedbackMs,
        data: {
          ...data,
          focusRestored: await trigger.evaluate((element) => element === document.activeElement),
          viewerRequests: run.network.slice(before),
        },
      }
    })
    await measure(profile, '/introduction', repetition, 'history-and-footer', async () => {
      const link = await existingLink(run.page, '/getting-started')
      if (!link) return { status: 'unavailable', error: 'Getting-started link unavailable' }
      await run.page.evaluate(() => window.scrollTo(0, 500))
      const scrollBefore = await run.page.evaluate(() => window.scrollY)
      await link.click()
      await meaningful(run.page, new URL('/getting-started', base).pathname)
      await run.page.goBack({ waitUntil: 'commit' })
      await meaningful(run.page, new URL('/introduction', base).pathname)
      const scrollAfter = await run.page.evaluate(() => window.scrollY)
      await run.page.goForward({ waitUntil: 'commit' })
      await meaningful(run.page, new URL('/getting-started', base).pathname)
      const footer = run.page.locator('footer a[href="/introduction"]').first()
      const before = run.network.length
      if (await footer.count()) {
        await footer.click()
        await meaningful(run.page, new URL('/introduction', base).pathname)
      }
      return {
        status: 'completed',
        data: {
          scrollBefore,
          scrollAfter,
          footerPresent: (await footer.count()) > 0,
          footerDocumentReload: run.network
            .slice(before)
            .some((request) => request.type === 'document'),
          network: run.network.slice(before),
        },
      }
    })
  } finally {
    await run.context.close()
  }
}

async function lighthouse(profile: Profile, route: string, repetition: number) {
  await measure(profile, route, repetition, 'lighthouse', async () => {
    const stem = `${profile.name}-${route.replaceAll('/', '_')}-${repetition}`
    const output = join(directory, `${stem}.lighthouse`)
    const config = join(directory, `${profile.name}.lighthouse.cjs`)
    await writeFile(
      config,
      `module.exports = ${JSON.stringify({
        extends: 'lighthouse:default',
        settings: {
          formFactor: profile.mobile ? 'mobile' : 'desktop',
          throttlingMethod: profile.mobile ? 'simulate' : 'provided',
          screenEmulation: {
            mobile: profile.mobile,
            width: profile.width,
            height: profile.height,
            deviceScaleFactor: profile.dpr,
            disabled: false,
          },
          onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
          maxWaitForLoad: 60_000,
        },
      })}\n`
    )
    const { stdout, stderr } = await exec(
      'bunx',
      [
        `lighthouse@${LIGHTHOUSE_VERSION}`,
        new URL(route, base).href,
        `--config-path=${config}`,
        '--output=json',
        '--output=html',
        `--output-path=${output}`,
        '--chrome-flags=--headless --no-sandbox --disable-dev-shm-usage',
        '--quiet',
      ],
      {
        timeout: 180_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, CHROME_PATH: chromium.executablePath() },
      }
    )
    await writeFile(`${output}.log`, `${stdout}\n${stderr}`)
    const report: {
      categories?: Record<string, { score: number | null }>
      audits?: Record<
        string,
        { score: number | null; numericValue?: number; displayValue?: string }
      >
      configSettings?: unknown
      runtimeError?: unknown
      finalDisplayedUrl?: string
      fetchTime?: string
      environment?: unknown
    } = JSON.parse(await readFile(`${output}.report.json`, 'utf8'))
    const measuredUrl = report.finalDisplayedUrl && new URL(report.finalDisplayedUrl)
    if (!measuredUrl || measuredUrl.origin !== base.origin || measuredUrl.pathname !== route)
      throw new Error(`Lighthouse reached ${report.finalDisplayedUrl} instead of ${route}`)
    const scores = Object.fromEntries(
      Object.entries(report.categories ?? {}).map(([name, category]) => [name, category.score])
    )
    const targetGaps = Object.entries(scores)
      .filter(([name, score]) => score === null || score < (name === 'performance' ? 0.9 : 1))
      .map(([name]) => name)
    return {
      status: report.runtimeError ? 'failed' : 'completed',
      data: {
        scores,
        targetGaps,
        audits: Object.fromEntries(
          Object.entries(report.audits ?? {}).map(([id, audit]) => [
            id,
            {
              score: audit.score,
              numericValue: audit.numericValue,
              displayValue: audit.displayValue,
            },
          ])
        ),
        configSettings: report.configSettings,
        environment: report.environment,
        runtimeError: report.runtimeError,
        finalDisplayedUrl: report.finalDisplayedUrl,
        fetchTime: report.fetchTime,
        report: `${output}.report.json`,
      },
    }
  })
}

await save()
if (mode === 'lighthouse') {
  for (const profile of profiles)
    for (let repetition = 1; repetition <= repetitions; repetition++)
      for (const route of routes) await lighthouse(profile, route, repetition)
} else {
  const browser = await chromium.launch({ headless: true })
  try {
    for (const profile of profiles)
      for (let repetition = 1; repetition <= repetitions; repetition++) {
        for (const route of routes) {
          if (scenarios.has('cold') || scenarios.has('warm'))
            await directSamples(browser, profile, route, repetition)
          if (scenarios.has('navigation')) {
            await navigationSample(browser, profile, route, repetition, false)
            await navigationSample(browser, profile, route, repetition, true)
          }
        }
        if (scenarios.has('interactions')) await interactions(browser, profile, repetition)
      }
  } finally {
    await browser.close()
  }
}
await save()
logger.info('Benchmark complete', {
  reportPath,
  measurements: results.length,
  failures: results.filter((result) => result.status === 'failed').length,
})
if (results.some((result) => result.status === 'failed')) process.exitCode = 1
