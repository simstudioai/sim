import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import {
  type Browser,
  type BrowserContext,
  chromium,
  expect,
  type Locator,
  type Page,
  type Request,
} from '@playwright/test'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import { escapeRegExp } from '@sim/utils/string'

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
  status: 'completed' | 'failed' | 'unavailable' | 'unverified'
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
if (
  routes.length > 8 ||
  routes.some((route) => !route.startsWith('/') || new URL(route, base).origin !== base.origin)
)
  throw new Error('Provide at most eight same-origin route paths')
const profiles = PROFILES.filter((profile) =>
  (process.env.DOCS_BENCHMARK_PROFILES?.split(',') ?? ['desktop', 'mobile']).includes(profile.name)
)
if (!profiles.length) throw new Error('No valid benchmark profile selected')
const directory = dirname(reportPath)
const results: Measurement[] = []
const titles = new Map<string, string>()
const startedAt = new Date().toISOString()
let originBlocked: { url: string; status: 403; observedAt: string } | undefined
const scenarios = new Set(
  process.env.DOCS_BENCHMARK_SCENARIOS?.split(',') ?? ['cold', 'warm', 'navigation', 'interactions']
)
await mkdir(directory, { recursive: true })
const nodeRuntime = (await exec('node', ['--version'], { timeout: 5000 })).stdout.trim()

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
        originBlocked,
        runtime: {
          node: nodeRuntime,
          bunNodeCompatibilityVersion: process.version,
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
  if (originBlocked) {
    results.push({
      profile: profile.name,
      route,
      repetition,
      scenario,
      status: 'unverified',
      durationMs: 0,
      error: 'Origin returned HTTP 403; no further requests were attempted.',
      data: originBlocked,
    })
    await save()
    return
  }
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
    if (response.status() === 403 && new URL(response.url()).origin === base.origin) {
      originBlocked = { url: response.url(), status: 403, observedAt: new Date().toISOString() }
      void context.close().catch(() => {})
    }
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

async function meaningful(page: Page, path: string, title?: string, previousTitle?: string) {
  await page.waitForFunction(
    ({ expectedPath, expectedTitle, previous }) => {
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
        (!previous || Boolean(expectedTitle) || heading.textContent?.trim() !== previous) &&
        article instanceof HTMLElement &&
        article.getClientRects().length > 0 &&
        (article.textContent?.trim().length ?? 0) > 80
      )
    },
    { expectedPath: path, expectedTitle: title, previous: previousTitle }
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
  await page.waitForLoadState('load')
  const exact = page.locator(`a[href="${route}"]`)
  const visited = new Set<string>()
  const folders = route.split('/').filter(Boolean).slice(0, -1)
  for (let attempt = 0; attempt < 14; attempt++) {
    const visible = exact.filter({ visible: true }).first()
    if (await visible.count()) return visible
    const menu = page
      .getByRole('button', { name: /^(Menu|Open menu|Open navigation|Open sidebar)$/i })
      .filter({ visible: true })
      .first()
    if (!visited.has('menu') && (await menu.count())) {
      visited.add('menu')
      await menu.click()
      await painted(page)
      continue
    }
    if (await exact.count()) {
      const dialogTarget = page
        .getByRole('dialog')
        .filter({ visible: true })
        .locator(`a[href="${route}"]`)
        .first()
      const hiddenTarget = (await dialogTarget.count()) ? dialogTarget : exact.first()
      const controls = await hiddenTarget.evaluate((element) => {
        const labels: string[] = []
        let parent = element.parentElement
        while (parent) {
          if (parent.matches('aside, [role=dialog]')) break
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
            const label = candidate?.getAttribute('aria-label') ?? candidate?.textContent?.trim()
            if (label) labels.unshift(label)
          }
          parent = parent.parentElement
        }
        return labels
      })
      let opened = false
      for (const control of controls) {
        const button = page
          .getByRole('button', { name: control, exact: true })
          .filter({ visible: true })
          .first()
        if (await button.count()) {
          await button.click()
          await painted(page)
          opened = true
          break
        }
      }
      if (opened) continue
    }
    let opened = false
    for (const folder of folders) {
      const label =
        folder === 'api-reference' ? 'API(?: reference)?' : folder.replaceAll('-', '[ -]')
      const branch = page
        .getByRole('button', { name: new RegExp(`^(?:Expand )?${label}$`, 'i') })
        .filter({ visible: true })
        .first()
      if ((await branch.count()) && (await branch.getAttribute('aria-expanded')) === 'false') {
        await branch.click()
        await painted(page)
        opened = true
        break
      }
      const path = `/${folders.slice(0, folders.indexOf(folder) + 1).join('/')}`
      const ancestor = page.locator(`a[href="${path}"]`).filter({ visible: true }).first()
      if (!visited.has(path) && (await ancestor.count())) {
        visited.add(path)
        await ancestor.click()
        await meaningful(page, path)
        opened = true
        break
      }
    }
    if (opened) continue
    const section = route.startsWith('/api-reference/')
      ? /^API(?: reference)?$/i
      : route.startsWith('/mcp/')
        ? /^MCP$/i
        : route.startsWith('/cli')
          ? /^CLI$/i
          : /^Documentation$/i
    const sectionLink = page.getByRole('link', { name: section }).filter({ visible: true }).first()
    const closeNavigation = page
      .getByRole('button', { name: /^(Close navigation|Close sidebar)$/i })
      .filter({ visible: true })
      .first()
    if (!(await sectionLink.count()) && (await closeNavigation.count())) {
      await closeNavigation.click()
      await painted(page)
      continue
    }
    const sectionHref = (await sectionLink.count()) ? await sectionLink.getAttribute('href') : null
    if (sectionHref && !visited.has(`section:${sectionHref}`)) {
      visited.add(`section:${sectionHref}`)
      const previousTitle = (await page.locator('h1').first().textContent())?.trim()
      await sectionLink.click()
      await meaningful(page, new URL(sectionHref, base).pathname, undefined, previousTitle)
      visited.delete('menu')
      continue
    }
    return null
  }
  return null
}

function searchInput(page: Page) {
  return page
    .getByRole('combobox', { name: /Search/i })
    .or(page.getByRole('searchbox', { name: /Search/i }))
    .or(page.getByPlaceholder(/Search/))
    .filter({ visible: true })
    .first()
}

async function readyForControls(page: Page) {
  await page.waitForLoadState('load')
  const input = searchInput(page)
  if (!(await input.isVisible())) {
    await page
      .getByRole('button', {
        name: /^(Search docs|Search documentation|Open Search|Search(?:\.\.\.)?(?:.*))$/i,
      })
      .filter({ visible: true })
      .first()
      .click()
  }
  await input.waitFor()
  await expect(input).toBeFocused()
  await page.keyboard.press('Escape')
  await input.waitFor({ state: 'hidden' })
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
        const previousTitle = (await run.page.locator('h1').first().textContent())?.trim()
        const start = await run.page.evaluate(() => {
          const state = (window as BrowserWindow).docsBenchmark
          if (state) state.shell = document.querySelector('body header')
          return performance.now()
        })
        await link.click()
        await meaningful(run.page, new URL(route, base).pathname, titles.get(route), previousTitle)
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
  if (originBlocked) {
    await measure(profile, '/introduction', repetition, 'interactions-suite', async () => ({
      status: 'unverified',
    }))
    return
  }
  const run = await contextFor(browser, profile)
  try {
    await measure(profile, '/introduction', repetition, 'interaction-page', async () => {
      const response = await run.page.goto(new URL('/introduction', base).href, {
        waitUntil: 'domcontentloaded',
      })
      if (!response?.ok()) throw new Error(`Document returned ${response?.status()}`)
      await meaningful(run.page, new URL('/introduction', base).pathname)
      return { status: 'completed' }
    })
    await measure(profile, '/introduction', repetition, 'cold-shortcut-observation', async () => {
      const at = await run.page.evaluate(() => ({
        readyState: document.readyState,
        time: performance.now(),
      }))
      await run.page.keyboard.press('ControlOrMeta+k')
      await painted(run.page)
      return {
        status: 'completed',
        data: {
          ...at,
          openedAfterTwoFrames: await searchInput(run.page).isVisible(),
          interpretation:
            'Early input observation, before control readiness. Not included in warm search timing.',
        },
      }
    })
    await measure(profile, '/introduction', repetition, 'control-readiness', async () => {
      await readyForControls(run.page)
      return { status: 'completed', data: { searchOpenedFocusedAndClosed: true } }
    })
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
      const result = run.page
        .getByRole('dialog')
        .locator('[role=option], button[aria-selected]')
        .filter({ hasText: /Slack/i })
        .first()
      await result.waitFor()
      await painted(run.page)
      const feedbackMs = performance.now() - start
      const navigationStart = performance.now()
      await result.click()
      await run.page.waitForURL((url) => url.pathname !== '/introduction')
      await meaningful(run.page, new URL(run.page.url()).pathname, undefined, 'Introduction')
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
      await readyForControls(run.page)
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
    await measure(profile, '/introduction', repetition, 'theme-control', async () => {
      const control = run.page
        .getByRole('button', { name: 'Dark', exact: true })
        .or(run.page.getByRole('button', { name: /^Toggle theme$/i }))
        .filter({ visible: true })
        .first()
      if (!(await control.count()))
        return { status: 'unavailable', error: 'No named theme control found on this baseline.' }
      await control.scrollIntoViewIfNeeded()
      const before = await run.page.locator('html').getAttribute('class')
      const start = performance.now()
      await control.click()
      await run.page.waitForFunction(
        (previous) => document.documentElement.className !== previous,
        before
      )
      await painted(run.page)
      const feedbackMs = performance.now() - start
      const selectedTheme = await run.page.locator('html').getAttribute('class')
      await run.page.reload({ waitUntil: 'domcontentloaded' })
      await meaningful(run.page, new URL(run.page.url()).pathname)
      return {
        status: 'completed',
        feedbackMs,
        data: {
          selectedTheme,
          afterReload: await run.page.locator('html').getAttribute('class'),
          limitation:
            'Final theme persistence only; this does not establish flash-free first paint.',
        },
      }
    })
    await apiControls(run, profile, repetition)
    await measure(profile, '/workflows', repetition, 'workflow-inspector-control', async () => {
      await run.page.goto(new URL('/workflows', base).href, { waitUntil: 'domcontentloaded' })
      await meaningful(run.page, new URL('/workflows', base).pathname)
      const trigger = run.page
        .getByRole('button', { name: /^(Expand .*workflow preview|Inspect workflow: .*)$/i })
        .first()
      await trigger.waitFor({ state: 'visible', timeout: 15_000 })
      await trigger.click({ trial: true })
      const start = performance.now()
      await trigger.click()
      const dialog = run.page.getByRole('dialog').first()
      await dialog.waitFor()
      await painted(run.page)
      const feedbackMs = performance.now() - start
      const block = dialog
        .getByRole('group', { name: 'Inspect a block' })
        .getByRole('button')
        .first()
      if (await block.count()) {
        await block.click()
        await painted(run.page)
      }
      const data = {
        selectedBlock: (await block.count()) ? await block.textContent() : undefined,
        dialogTextLength: (await dialog.textContent())?.length,
      }
      await run.page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      return { status: 'completed', feedbackMs, data }
    })
    for (const route of [
      '/cli',
      '/mcp/overview',
      '/introduction',
      '/integrations/cloudflare',
      '/getting-started',
    ]) {
      await measure(profile, route, repetition, 'consecutive-navigation', async () => {
        const link = await existingLink(run.page, route)
        if (!link)
          return {
            status: 'unavailable',
            error: 'No reachable existing link for this consecutive hop.',
          }
        await link.scrollIntoViewIfNeeded()
        const previousTitle = (await run.page.locator('h1').first().textContent())?.trim()
        const before = run.network.length
        const start = performance.now()
        await link.click()
        await meaningful(run.page, new URL(route, base).pathname, titles.get(route), previousTitle)
        const meaningfulPaintMs = performance.now() - start
        return {
          status: 'completed',
          meaningfulPaintMs,
          data: {
            url: run.page.url(),
            network: run.network.slice(before),
            documentReload: run.network
              .slice(before)
              .some((request) => request.type === 'document'),
          },
        }
      })
    }
  } finally {
    await run.context.close()
  }
}

async function tabControl(
  run: Awaited<ReturnType<typeof contextFor>>,
  profile: Profile,
  repetition: number,
  route: string,
  control: { scenario: string; label: string; choice: RegExp }
) {
  await measure(profile, route, repetition, control.scenario, async () => {
    const list = run.page.getByRole('tablist', {
      name: control.label,
      exact: true,
      includeHidden: true,
    })
    const tab = list.getByRole('tab', { name: control.choice, includeHidden: true }).first()
    if (!(await tab.count()))
      return {
        status: 'unavailable',
        error: `No matching ${control.label} tab on this baseline.`,
      }
    const choices = await list.getByRole('tab', { includeHidden: true }).count()
    const presentation = (await tab.isVisible()) ? 'tabs' : 'menu'
    let trigger = tab
    if (presentation === 'menu') {
      const picker = run.page.getByRole('button', {
        name: new RegExp(`^${escapeRegExp(control.label)}:`),
      })
      if (!(await picker.isVisible()))
        return {
          status: 'unavailable',
          error: `No visible ${control.label} control on this baseline.`,
        }
      await picker.click()
      trigger = run.page.getByRole('menuitemradio', { name: control.choice }).first()
    }
    await trigger.scrollIntoViewIfNeeded()
    const start = performance.now()
    await trigger.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    const id = await tab.getAttribute('aria-controls')
    if (!id) throw new Error('Tab has no linked content')
    const panel = run.page.locator(`[id="${id}"]`)
    await panel.waitFor({ state: 'visible' })
    await painted(run.page)
    return {
      status: 'completed',
      feedbackMs: choices > 1 ? performance.now() - start : undefined,
      data: {
        choices,
        presentation,
        selected: await tab.textContent(),
        contentLength: (await panel.textContent())?.length,
        applicableTransition: choices > 1,
      },
    }
  })
}

async function apiControls(
  run: Awaited<ReturnType<typeof contextFor>>,
  profile: Profile,
  repetition: number
) {
  const route = '/api-reference/logs/getLog'
  if (originBlocked) {
    await measure(profile, route, repetition, 'api-controls-suite', async () => ({
      status: 'unverified',
    }))
    return
  }
  await measure(profile, route, repetition, 'api-control-readiness', async () => {
    const response = await run.page.goto(new URL(route, base).href, {
      waitUntil: 'domcontentloaded',
    })
    if (!response?.ok()) throw new Error(`Document returned ${response?.status()}`)
    await meaningful(run.page, new URL(route, base).pathname)
    await readyForControls(run.page)
    return { status: 'completed' }
  })
  for (const control of [
    {
      scenario: 'request-language-control',
      label: 'Request language',
      choice: /^(Python|JavaScript|TypeScript)$/,
    },
    { scenario: 'response-status-control', label: 'Response status', choice: /^400$/ },
    {
      scenario: 'response-media-control',
      label: '400 response content type',
      choice: /^application\/json$/,
    },
  ]) {
    await tabControl(run, profile, repetition, route, control)
  }
  await measure(profile, route, repetition, 'schema-disclosure-control', async () => {
    const details = run.page.locator('main details:not([open])').filter({ visible: true }).first()
    if (!(await details.count()))
      return {
        status: 'unavailable',
        error:
          'No native collapsed schema disclosure on this baseline; alternate implementation needs a separate adapter.',
      }
    const summary = details.locator('summary').first()
    await summary.scrollIntoViewIfNeeded()
    const element = await details.elementHandle()
    if (!element) throw new Error('Schema disclosure disappeared before activation')
    const start = performance.now()
    await summary.click()
    await run.page.waitForFunction(
      (node) => node instanceof HTMLDetailsElement && node.open,
      element
    )
    await painted(run.page)
    return {
      status: 'completed',
      feedbackMs: performance.now() - start,
      data: {
        open: await element.getAttribute('open'),
        contentLength: (await element.textContent())?.length,
      },
    }
  })
  await measure(profile, route, repetition, 'copy-request-control', async () => {
    await run.context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const button = run.page
      .getByRole('button', { name: 'Copy request', exact: true })
      .filter({ visible: true })
      .first()
    if (!(await button.count()))
      return { status: 'unavailable', error: 'No named request-copy button on this baseline.' }
    const selected = run.page
      .getByRole('tablist', { name: 'Request language', exact: true, includeHidden: true })
      .getByRole('tab', { selected: true, includeHidden: true })
    const id = await selected.getAttribute('aria-controls')
    if (!id) throw new Error('Selected request has no panel')
    const panel = run.page.locator(`[id="${id}"]`)
    await panel.waitFor({ state: 'visible' })
    const expected = await panel.locator('code').textContent()
    await button.scrollIntoViewIfNeeded()
    const start = performance.now()
    await button.click()
    await run.page.waitForFunction(
      (text) => navigator.clipboard.readText().then((value) => value.trim() === text?.trim()),
      expected
    )
    await painted(run.page)
    return {
      status: 'completed',
      feedbackMs: performance.now() - start,
      data: { exactSelectedSampleCopied: true, characters: expected?.length },
    }
  })
  const streamingRoute = '/api-reference/workflows/executeWorkflowV2'
  await measure(profile, streamingRoute, repetition, 'response-format-readiness', async () => {
    const response = await run.page.goto(new URL(streamingRoute, base).href, {
      waitUntil: 'domcontentloaded',
    })
    if (!response?.ok()) throw new Error(`Document returned ${response?.status()}`)
    await meaningful(run.page, streamingRoute)
    await readyForControls(run.page)
    return { status: 'completed' }
  })
  await tabControl(run, profile, repetition, streamingRoute, {
    scenario: 'response-format-control',
    label: '200 response content type',
    choice: /^text\/event-stream$/,
  })
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
    try {
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
          '--disable-full-page-screenshot',
          '--quiet',
        ],
        {
          timeout: 180_000,
          maxBuffer: 1024 * 1024,
          env: { ...process.env, CHROME_PATH: chromium.executablePath() },
        }
      )
      await writeFile(`${output}.log`, `${stdout}\n${stderr}`)
    } catch (error) {
      const stdout = isRecordLike(error) && typeof error.stdout === 'string' ? error.stdout : ''
      const stderr = isRecordLike(error) && typeof error.stderr === 'string' ? error.stderr : ''
      const message = getErrorMessage(error)
      await writeFile(`${output}.log`, `${stdout}\n${stderr}\n${message}`)
      const forbidden = /Status code: 403|HTTP 403/.test(`${stderr} ${message}`)
      if (forbidden)
        originBlocked = {
          url: new URL(route, base).href,
          status: 403,
          observedAt: new Date().toISOString(),
        }
      return {
        status: 'failed',
        error: message,
        data: {
          failureKind: forbidden ? 'origin-access-denied' : 'lighthouse-cli',
          log: `${output}.log`,
        },
      }
    }
    const report: {
      categories?: Record<string, { score: number | null }>
      audits?: Record<
        string,
        {
          score: number | null
          numericValue?: number
          displayValue?: string
          scoreDisplayMode?: string
          errorMessage?: string
        }
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
    const missingScores = ['performance', 'accessibility', 'best-practices', 'seo'].filter(
      (name) => typeof scores[name] !== 'number'
    )
    const auditErrors = Object.entries(report.audits ?? {})
      .filter(([, audit]) => audit.scoreDisplayMode === 'error' || audit.errorMessage)
      .map(([id, audit]) => ({ id, error: audit.errorMessage }))
    const targetGaps = Object.entries(scores)
      .filter(([name, score]) => score === null || score < (name === 'performance' ? 0.9 : 1))
      .map(([name]) => name)
    return {
      status:
        report.runtimeError || missingScores.length || auditErrors.length ? 'failed' : 'completed',
      error:
        report.runtimeError || missingScores.length || auditErrors.length
          ? 'Lighthouse report is partial; inspect runtimeError, missingScores and auditErrors.'
          : undefined,
      data: {
        scores,
        missingScores,
        auditErrors,
        targetGaps,
        audits: Object.fromEntries(
          Object.entries(report.audits ?? {}).map(([id, audit]) => [
            id,
            {
              score: audit.score,
              numericValue: audit.numericValue,
              displayValue: audit.displayValue,
              scoreDisplayMode: audit.scoreDisplayMode,
              errorMessage: audit.errorMessage,
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
        else if (scenarios.has('api-controls')) {
          const run = await contextFor(browser, profile)
          try {
            await apiControls(run, profile, repetition)
          } finally {
            await run.context.close()
          }
        }
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
