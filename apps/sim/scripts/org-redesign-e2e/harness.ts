import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  type Browser,
  type BrowserContext,
  expect as browserExpect,
  chromium,
  type Page,
  type Request,
} from '@playwright/test'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { escapeRegExp, truncate } from '@sim/utils/string'
import { makeSignature } from 'better-auth/crypto'
import postgres from 'postgres'
import { organizationRoutes } from '@/lib/navigation/paths'
import { waitUntilHydrated } from '@/platform/checks/test'
import { ADMIN, type EVERYONE, ORGANIZATION_ID } from '@/scripts/org-redesign-e2e/fixture'

/**
 * Acceptance for the organization view against a hosted production build, real Postgres and Redis,
 * and a scripted model. Walks what each persona could see and do before the redesign, as behaviour:
 * every section's rows are present and work, in both themes at both widths, with no runtime error
 * and no failed same-origin request. One failed check never stops the walk, so a run reports them
 * all. Google answers only to real credentials, so the widget reads are replaced at the browser's
 * network boundary; `home-widgets.integration.ts` proves the reads behind them.
 *
 * Requires ORG_REDESIGN_E2E_ORIGIN, ORG_REDESIGN_E2E_DATABASE_URL, ORG_REDESIGN_E2E_AUTH_SECRET and
 * ORG_REDESIGN_E2E_REPORT_PATH. ORG_REDESIGN_E2E_PHASE picks `main`, or `people` for an app started
 * with the People flag on.
 */
const logger = createLogger('OrgRedesignE2E')
export const expect = browserExpect.configure({ timeout: 20_000 })

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

export const origin = new URL(requiredEnvironment('ORG_REDESIGN_E2E_ORIGIN')).origin
const databaseUrl = assertDisposableTestDatabaseUrl(
  requiredEnvironment('ORG_REDESIGN_E2E_DATABASE_URL')
)
const authSecret = requiredEnvironment('ORG_REDESIGN_E2E_AUTH_SECRET')
const reportPath = resolve(requiredEnvironment('ORG_REDESIGN_E2E_REPORT_PATH'))
export const phase = process.env.ORG_REDESIGN_E2E_PHASE ?? 'main'
export const artifactDirectory = `${reportPath}.artifacts`
export const sql = postgres(databaseUrl.toString(), { max: 2 })
/** Every route of the suite's organization, from the one builder the product's links use. */
export const org = organizationRoutes(ORGANIZATION_ID)
export const url = (path: string) => `${origin}${path}`

export type Persona = (typeof EVERYONE)[number]
type Status = 'passed' | 'failed' | 'skipped'
export type Theme = 'light' | 'dark'
export interface Viewport {
  name: string
  width: number
  height: number
}

export const DESKTOP: Viewport = { name: 'desktop', width: 1440, height: 900 }
export const PHONE: Viewport = { name: 'phone', width: 390, height: 844 }
const CHECK_TIMEOUT_MS = 180_000
/** A check whose sessions are closed fails its next step at once; this leaves its restores time. */
const CHECK_CANCEL_GRACE_MS = 30_000
export const WALK_CONCURRENCY = 4

interface Problem {
  check: string
  kind: 'runtime' | 'console' | 'http' | 'network'
  url: string
  detail: string
}

interface PageRead {
  path: string
  ms: number
}

interface FirstPaint {
  persona: string
  page: string
  firstPaintMs: number | null
  firstContentfulPaintMs: number | null
  primaryVisibleMs: number
  apiRequests: string[]
  totalRequestCount: number
  duplicates: string[]
  prefetchedAndRefetched: string[]
  perWorkspaceReads: string[]
}

const checks: {
  name: string
  section: string
  status: Status
  durationMs: number
  error?: string
}[] = []
export const routes: {
  persona: string
  route: string
  viewport: string
  theme: Theme
  status: number | null
  finalPath: string
  screenshot: string | null
  platformSurfaces: number
  /** From the document's load to no read or skeleton left, or null if it never got there. */
  contentReadyMs: number | null
  /** The document's own load, which `contentReadyMs` starts after. */
  documentMs: number
  /** Where the route's time went: its slowest reads, and how many it sent. */
  slowestReads: PageRead[]
  readCount: number
}[] = []
export const firstPaints: FirstPaint[] = []
const unexpected: Problem[] = []
let currentCheck = 'Setup'
let currentSection = 'Setup'
/** Set once every phase has run: until then a clean report only says nothing has failed yet. */
let finished = false
/** What the running check expects to fail; everything else is reported. */
let allowedFailures: RegExp[] = []

const HANDLED_RUNTIME = /NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK/
/** A Suspense boundary the server gave up on, which is only fine when it was a redirect or not-found. */
const STREAMED_FAILURE = /Minified React error #419/
/** The browser's own line for a failed load, which the response and requestfailed listeners judge. */
const BROWSER_LOAD_FAILURE = /^Failed to load resource/
/**
 * What this environment says, not the app: the suite runs over plain HTTP, where the browser ignores
 * COOP, and the Inth analytics host refuses this test origin's CORS request.
 */
const ENVIRONMENT_CONSOLE_NOISE = [
  /^The Cross-Origin-Opener-Policy header has been ignored, because the URL's origin was untrustworthy\./,
  /^Access to fetch at 'https:\/\/sim-sim\.inth\.app\/init' from origin /,
]
/** How long a route may keep showing a first read before the walk fails it as stuck. */
const CONTENT_DEADLINE_MS = 20_000
/** How soon a skeleton with no read behind it is looked at again. */
const SKELETON_RECHECK_MS = 100
const LOADING_STATUS = /^(Loading|Checking|Searching|Updating)\b/
const HIGH_VOLUME_REQUEST = /\/api\/mothership\/events|\/socket\.io\/|\/api\/auth\/socket-token/

const browser: Browser = await chromium.launch()

/** What a running check holds, so a timeout can stop it instead of leaving it running behind the next. */
interface CheckScope {
  cancelled: boolean
  sessions: Set<Session>
}
const checkScope = new AsyncLocalStorage<CheckScope>()

/**
 * The loading states on screen, named. Runs in the page. Skeletons announce themselves as a
 * `role=status` saying what they load or an `aria-busy` region, which is also what a screen reader
 * gets, so no check depends on a skeleton's class.
 */
function loadingStatesOnScreen(pattern: string) {
  const loading = new RegExp(pattern)
  const named = (element: Element) =>
    element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName
  const busy = Array.from(document.querySelectorAll('[aria-busy="true"]'))
  const statuses = Array.from(document.querySelectorAll('[role="status"]')).filter((element) =>
    loading.test(named(element))
  )
  return [...new Set([...busy, ...statuses])]
    .filter((element) => element.checkVisibility({ visibilityProperty: true }))
    .map(named)
}

function reportCounts() {
  const counts = { passed: 0, failed: 0, skipped: 0 }
  for (const entry of checks) counts[entry.status] += 1
  return counts
}

/** `running` is what a killed run leaves behind when nothing had failed, which is not a pass. */
function reportStatus() {
  if (process.exitCode || reportCounts().failed > 0 || unexpected.length > 0) return 'failed'
  return finished ? 'passed' : 'running'
}

/**
 * Written after every check and renamed into place, so a job that runs out of time still leaves
 * what it found, and a kill mid-write cannot leave half a report.
 */
function writeReport() {
  mkdirSync(dirname(reportPath), { recursive: true })
  const pending = `${reportPath}.partial`
  writeFileSync(
    pending,
    `${JSON.stringify(
      {
        status: reportStatus(),
        phase,
        counts: reportCounts(),
        checks,
        unexpected,
        firstPaints,
        routes,
        artifactDirectory,
      },
      null,
      2
    )}\n`
  )
  renameSync(pending, reportPath)
}

function isSameOrigin(address: string) {
  try {
    return new URL(address).origin === origin
  } catch {
    return false
  }
}

export function pathOf(address: string) {
  const parsed = new URL(address)
  return `${parsed.pathname}${parsed.search}`
}

function recordProblem(kind: Problem['kind'], address: string, detail: string) {
  const signature = `${kind} ${address} ${detail}`
  if (allowedFailures.some((pattern) => pattern.test(signature))) return
  if (
    unexpected.some(
      (entry) => entry.check === currentCheck && entry.kind === kind && entry.detail === detail
    )
  )
    return
  unexpected.push({ check: currentCheck, kind, url: address, detail: truncate(detail, 500) })
  writeReport()
}

/** One request a check provokes on purpose. A path with no query also covers the path with one. */
export function refused(status: number, method: string, path: string) {
  const query = path.includes('?') ? '' : '(\\?\\S*)?'
  return new RegExp(`^http \\S+ ${status} ${method} ${escapeRegExp(path)}${query}$`)
}

/** What a page paints with rather than reads. An SVG `<use href>` reports its type as `other`. */
const ASSET_RESOURCE = new Set(['image', 'font', 'media'])
const STATIC_ASSET_PATH = /^\/(?!api\/).*\.(?:svg|png|jpe?g|webp|avif|gif|ico|woff2?|ttf)$/

/**
 * A read this page is waiting on. Router prefetches, static assets and other hosts come and go on
 * their own schedule, and no check reasons about them.
 */
function isPageRead(request: Request) {
  if (request.resourceType() === 'eventsource' || !isSameOrigin(request.url())) return false
  if (ASSET_RESOURCE.has(request.resourceType())) return false
  const { pathname } = new URL(request.url())
  if (pathname.startsWith('/_next/static/') || STATIC_ASSET_PATH.test(pathname)) return false
  return request.headers()['next-router-prefetch'] === undefined
}

/** Resource types a lazily loaded section's code arrives as. */
const CODE_RESOURCE = new Set(['script', 'stylesheet'])

/**
 * Code the page is waiting on: a lazily loaded section mounts, and only then starts its reads, once
 * its chunk arrives. Not a read, so the slowest reads stay the page's own, but a page with a chunk
 * still out is not quiet, since a section that paints nothing while it loads looks finished.
 */
function isPageCode(request: Request) {
  return (
    CODE_RESOURCE.has(request.resourceType()) &&
    isSameOrigin(request.url()) &&
    new URL(request.url()).pathname.startsWith('/_next/static/')
  )
}

class Session {
  private readonly inflight = new Set<Request>()
  /** How many page reads have started, so a wait can tell whether a new one began meanwhile. */
  private readsStarted = 0
  /** Woken by every page read that starts or ends. */
  private readonly activityWaiters = new Set<() => void>()
  /** The document a navigation is loading, until it replaces the page. */
  private loadingDocument: Request | null = null
  readonly requests: { method: string; path: string; type: string }[] = []
  /** The page's own reads and how long each took, from the last navigation a walk started. */
  readonly reads: PageRead[] = []
  private readonly readStarted = new Map<Request, number>()

  constructor(
    readonly context: BrowserContext,
    readonly page: Page
  ) {
    page.on('pageerror', (error) => {
      if (!HANDLED_RUNTIME.test(error.message) && !STREAMED_FAILURE.test(error.message))
        recordProblem('runtime', page.url(), error.message)
    })
    page.on('console', (message) => {
      if (message.type() !== 'error') return
      const text = message.text()
      if (
        !BROWSER_LOAD_FAILURE.test(text) &&
        !ENVIRONMENT_CONSOLE_NOISE.some((noise) => noise.test(text)) &&
        !HANDLED_RUNTIME.test(text) &&
        !STREAMED_FAILURE.test(text)
      )
        recordProblem('console', page.url(), text)
    })
    page.on('request', (request) => {
      if (HIGH_VOLUME_REQUEST.test(request.url())) return
      if (request.isNavigationRequest() && request.frame() === page.mainFrame())
        this.loadingDocument = request
      if (isPageRead(request) || isPageCode(request)) {
        this.inflight.add(request)
        this.readsStarted += 1
        if (isPageRead(request)) this.readStarted.set(request, Date.now())
        this.wakeActivityWaiters()
      }
      if (isSameOrigin(request.url()))
        this.requests.push({
          method: request.method(),
          path: pathOf(request.url()),
          type: request.resourceType(),
        })
    })
    // The browser never reports the end of a read the old document was running or sent while this
    // one loaded, including after the request that started the navigation.
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame() || !this.loadingDocument) return
      for (const request of this.inflight)
        if (request !== this.loadingDocument) this.inflight.delete(request)
      this.loadingDocument = null
      this.wakeActivityWaiters()
    })
    const settled = (request: Request) => {
      if (this.inflight.delete(request)) this.wakeActivityWaiters()
      const started = this.readStarted.get(request)
      if (started === undefined) return
      this.readStarted.delete(request)
      this.reads.push({
        path: `${request.method()} ${pathOf(request.url())}`,
        ms: Date.now() - started,
      })
    }
    page.on('requestfinished', settled)
    page.on('requestfailed', (request) => {
      settled(request)
      if (request === this.loadingDocument) this.loadingDocument = null
      const reason = request.failure()?.errorText ?? 'failed'
      if (
        isSameOrigin(request.url()) &&
        reason !== 'net::ERR_ABORTED' &&
        !HIGH_VOLUME_REQUEST.test(request.url())
      )
        recordProblem(
          'network',
          request.url(),
          `${request.method()} ${pathOf(request.url())} ${reason}`
        )
    })
    page.on('response', (response) => {
      if (response.status() < 400 || !isSameOrigin(response.url())) return
      recordProblem(
        'http',
        response.url(),
        `${response.status()} ${response.request().method()} ${pathOf(response.url())}`
      )
    })
  }

  private wakeActivityWaiters() {
    for (const wake of this.activityWaiters) wake()
    this.activityWaiters.clear()
  }

  /** Resolves when a page read next starts or ends, or after `ms`. */
  private nextActivity(ms: number) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms)
      this.activityWaiters.add(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  /**
   * Resolves once the page's main thread has been idle (`requestIdleCallback`): the work a commit
   * scheduled, including the effects that start the next read, has run. A navigation that replaces
   * the document mid-wait counts as activity, so the caller looks again.
   */
  private async idle(ms: number) {
    try {
      await this.page.evaluate(
        (timeout) =>
          new Promise<void>((resolve) => requestIdleCallback(() => resolve(), { timeout })),
        ms
      )
      return true
    } catch (error) {
      if (/Execution context was destroyed|navigation/i.test(getErrorMessage(error))) return false
      throw error
    }
  }

  /**
   * Every page read (`isPageRead`) and code chunk (`isPageCode`) that started has finished, and the
   * page went idle without starting another; the SSE and socket connections that never finish are
   * not reads. Fails at its deadline naming what is still out, because every caller goes on to
   * reason about a quiet page.
   */
  async settle(maxMs = 8_000) {
    const deadline = Date.now() + maxMs
    while (Date.now() < deadline) {
      if (this.inflight.size > 0) {
        await this.nextActivity(deadline - Date.now())
        continue
      }
      const started = this.readsStarted
      const wentIdle = await this.idle(Math.max(1, deadline - Date.now()))
      if (wentIdle && this.inflight.size === 0 && this.readsStarted === started) return
    }
    throw new Error(
      `The page did not go quiet in ${maxMs}ms. Still out: ${this.readsOut() || 'none'}`
    )
  }

  /**
   * Quiet, and past every first read: a quiet network alone passes before a lazy section has loaded
   * enough to send its read, with its skeleton on screen. A state a check holds on purpose is that
   * check's to assert; this is for a page about to be read as finished. Returns how long it took.
   */
  async contentReady(maxMs = CONTENT_DEADLINE_MS) {
    const started = Date.now()
    const loading = () => this.page.evaluate(loadingStatesOnScreen, LOADING_STATUS.source)
    let showing: string[] = []
    // Server-rendered markup is quiet before the client has started the reads that fill it.
    await waitUntilHydrated(this.page, maxMs)
    while (Date.now() - started < maxMs) {
      await this.settle(maxMs - (Date.now() - started))
      showing = await loading()
      if (showing.length === 0) return Date.now() - started
      // A skeleton still on screen with nothing in flight is waiting on a chunk or a mount: look
      // again when its read starts, or shortly, for one that clears without a read.
      await this.nextActivity(SKELETON_RECHECK_MS)
    }
    throw new Error(
      `Still loading after ${maxMs}ms: ${showing.join(', ') || 'no skeleton'}. Reads still out: ${this.readsOut() || 'none'}`
    )
  }

  private readsOut() {
    return [...this.inflight].map((request) => `${request.method()} ${request.url()}`).join(', ')
  }
}

async function cookieFor(persona: Persona) {
  return encodeURIComponent(
    `${persona.sessionToken}.${await makeSignature(persona.sessionToken, authSecret)}`
  )
}

async function sessionCookie(persona: Persona) {
  return {
    name: 'better-auth.session_token',
    value: await cookieFor(persona),
    url: origin,
    httpOnly: true,
    sameSite: 'Lax' as const,
  }
}

interface OpenOptions {
  viewport?: Viewport
  theme?: Theme
  /**
   * Mints a real socket token. Off by default: every document load mints one against a 30-a-minute
   * budget per user, which a person reloading by hand never spends and this suite spends in seconds.
   * Nothing on the organization surface reads the socket, so its token stays unanswered, as on a
   * slow network, and `realtimeChecks` proves the real path.
   */
  realtime?: boolean
}

async function open(persona: Persona | null, options: OpenOptions = {}): Promise<Session> {
  const scope = checkScope.getStore()
  if (scope?.cancelled) throw new Error('The check timed out; it may not open another session')
  const viewport = options.viewport ?? DESKTOP
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: options.theme ?? 'light',
    hasTouch: viewport === PHONE,
    isMobile: viewport === PHONE,
  })
  await context.exposeBinding(
    'reportStreamedFailure',
    (_source, address: string, message: string, digests: string[]) => {
      const allHandled =
        digests.length > 0 && digests.every((digest) => HANDLED_RUNTIME.test(digest))
      if (!allHandled)
        recordProblem('runtime', address, `${message} digests: ${digests.join(', ')}`)
    }
  )
  await context.addInitScript((pattern) => {
    window.addEventListener('error', (event) => {
      if (!new RegExp(pattern).test(event.message)) return
      const digests = Array.from(document.querySelectorAll('template[data-dgst]')).map(
        (template) => template.getAttribute('data-dgst') ?? ''
      )
      if (typeof event.error?.digest === 'string') digests.push(event.error.digest)
      void (
        window as typeof window & {
          reportStreamedFailure: (...args: unknown[]) => Promise<void>
        }
      ).reportStreamedFailure(location.href, event.message, digests)
    })
  }, STREAMED_FAILURE.source)
  // Plain HTTP has no Clipboard API, which production's HTTPS has; this records what the app copies.
  await context.addInitScript(() => {
    if (navigator.clipboard) return
    let copied = ''
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          copied = text
        },
        write: async () => {},
        readText: async () => copied,
      },
    })
  })
  if (persona) await context.addCookies([await sessionCookie(persona)])
  if (!options.realtime) await context.route('**/api/auth/socket-token', () => {})
  const session = new Session(context, await context.newPage())
  scope?.sessions.add(session)
  return session
}

export async function withSession(
  persona: Persona | null,
  run: (session: Session) => Promise<void>,
  options: OpenOptions = {}
) {
  const session = await open(persona, options)
  try {
    await run(session)
  } catch (error) {
    await session.page
      .screenshot({
        path: resolve(artifactDirectory, `failure-${checks.length + 1}.png`),
        timeout: 5_000,
      })
      .catch(() => {})
    throw error
  } finally {
    checkScope.getStore()?.sessions.delete(session)
    await session.context.close().catch(() => {})
  }
}

/** A session that has already opened Home, where most of the suite starts. */
export async function onHome(
  persona: Persona | null,
  run: (session: Session) => Promise<void>,
  options: OpenOptions = {}
) {
  await withSession(
    persona,
    async (session) => {
      await session.page.goto(url(org.home))
      await run(session)
    },
    options
  )
}

/**
 * Records the requests a page sends that a check cares about, from now on. The array fills as they
 * arrive, so a check can assert it stayed empty or poll it.
 */
export function captureRequests(page: Page, matches: (request: Request) => boolean) {
  const captured: Request[] = []
  page.on('request', (request) => {
    if (matches(request)) captured.push(request)
  })
  return captured
}

/**
 * Runs a check that changes seeded data, and always puts it back, so a failure part-way cannot leave
 * the next check on a different fixture. A failed restore fails the check, beside its own failure.
 */
export async function withRestore<T>(
  restore: () => Promise<unknown>,
  run: () => Promise<T>
): Promise<T> {
  let outcome: { value: T } | { error: unknown }
  try {
    outcome = { value: await run() }
  } catch (error) {
    outcome = { error }
  }
  try {
    await restore()
  } catch (restoreError) {
    const failures = 'error' in outcome ? `${getErrorMessage(outcome.error)}; ` : ''
    throw new Error(`${failures}and the restore failed: ${getErrorMessage(restoreError)}`)
  }
  if ('error' in outcome) throw outcome.error
  return outcome.value
}

/** Admin and Mothership are for platform admins, which no persona is outside this scope. */
export async function asPlatformAdmin<T>(run: () => Promise<T>) {
  await sql`update "user" set role = 'admin' where email = ${ADMIN.email}`
  try {
    return await run()
  } finally {
    await sql`update "user" set role = 'user' where email = ${ADMIN.email}`
  }
}

export function section(name: string) {
  currentSection = name
  writeReport()
}

interface CheckOptions {
  /** Failures this check provokes on purpose. */
  allow?: RegExp[]
}

export function record(name: string, section: string, started: number, error?: string) {
  checks.push({
    name,
    section,
    status: error ? 'failed' : 'passed',
    durationMs: Math.round(performance.now() - started),
    ...(error ? { error } : {}),
  })
  if (error) logger.error(`FAIL ${section}: ${name}`, { error })
  else logger.info(`PASS ${section}: ${name}`)
  writeReport()
}

/**
 * Closes what a timed-out check has open, which fails its next browser step, then waits for it to
 * unwind so its restores finish before the next check starts. Reports whether it stopped in time.
 */
async function cancelCheck(scope: CheckScope, running: Promise<void>) {
  scope.cancelled = true
  await Promise.all([...scope.sessions].map(({ context }) => context.close().catch(() => {})))
  return Promise.race([
    running.then(
      () => true,
      () => true
    ),
    sleep(CHECK_CANCEL_GRACE_MS).then(() => false),
  ])
}

export async function check(name: string, run: () => Promise<void>, options: CheckOptions = {}) {
  currentCheck = `${currentSection}: ${name}`
  allowedFailures = options.allow ?? []
  const started = performance.now()
  const scope: CheckScope = { cancelled: false, sessions: new Set() }
  const running = checkScope.run(scope, run)
  const timeout = createDeferred<never>()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    timeout.reject(new Error(`Timed out after ${CHECK_TIMEOUT_MS}ms`))
  }, CHECK_TIMEOUT_MS)
  try {
    await Promise.race([running, timeout.promise])
    record(name, currentSection, started)
  } catch (error) {
    const stopped = !timedOut || (await cancelCheck(scope, running))
    const message = stopped
      ? getErrorMessage(error)
      : `${getErrorMessage(error)}, and it was still running ${CHECK_CANCEL_GRACE_MS}ms after its sessions closed`
    record(name, currentSection, started, truncate(message, 2000))
  } finally {
    clearTimeout(timer)
    allowedFailures = []
  }
}

/** A baseline row this environment cannot exercise, kept in the report with its reason. */
export function notProvable(name: string, reason: string) {
  checks.push({ name, section: currentSection, status: 'skipped', durationMs: 0, error: reason })
  writeReport()
}

/**
 * Fails a page's own read at its source, so its server seed stays out of hydration and the client
 * read fails too: the only way a seeded page reaches its error state. `restore` lets a check retry.
 */
export async function withTableHidden(
  table: string,
  run: (restore: () => Promise<void>) => Promise<void>
) {
  const hidden = `${table}_e2e_hidden`
  await sql.unsafe(`alter table "${table}" rename to "${hidden}"`)
  let restored = false
  const restore = async () => {
    if (restored) return
    restored = true
    await sql.unsafe(`alter table "${hidden}" rename to "${table}"`)
  }
  try {
    await run(restore)
  } finally {
    await restore()
  }
}

export async function startRun() {
  await mkdir(artifactDirectory, { recursive: true })
}

/** Walks that run several personas at once report under one name, outside `check`. */
export function beginWalk() {
  currentCheck = 'Route walk'
}

export async function healthCheck() {
  section('Health')
  await check('no unexpected browser runtime errors or failed same-origin requests', async () => {
    assert.deepEqual(unexpected, [])
  })
}

/** Closes what the run holds and writes its last report, whatever the phases did. */
export async function finishRun(aborted?: unknown) {
  if (aborted !== undefined) {
    logger.error('Org redesign E2E aborted', { error: getErrorMessage(aborted) })
    process.exitCode = 1
  }
  await browser.close().catch(() => {})
  await sql.end({ timeout: 5 }).catch(() => {})
  const { failed } = reportCounts()
  if (failed > 0 || checks.length === 0) process.exitCode = 1
  finished = true
  writeReport()
  logger.info(`Org redesign E2E: ${JSON.stringify(reportCounts())}`)
}
