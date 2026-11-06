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
  type Locator,
  type Page,
  type Request,
} from '@playwright/test'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { toRecord } from '@sim/utils/object'
import { escapeRegExp, truncate } from '@sim/utils/string'
import { makeSignature } from 'better-auth/crypto'
import postgres from 'postgres'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import {
  ADMIN,
  ADMIN_CHATS,
  CONNECTED,
  type EVERYONE,
  GRANTS,
  LINK_COUNT,
  MEMBER,
  MEMBER_ADMIN_WORKSPACE,
  MEMBER_CHATS,
  MEMBER_WRITE_WORKSPACE,
  NAMED_LINKS,
  NARROW,
  ORGANIZATION_ID,
  ORGANIZATION_NAME,
  OUTSIDE_ORGANIZATION_ID,
  OUTSIDER,
  OWNER,
  PASSWORD,
  SEEDED_SOURCE,
  STANDARD_GROUP_ID,
  WORKSPACES,
} from '@/scripts/org-redesign-e2e/fixture'
import { SIDEBAR_WIDTH } from '@/stores/constants'

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
const expect = browserExpect.configure({ timeout: 20_000 })

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

const origin = new URL(requiredEnvironment('ORG_REDESIGN_E2E_ORIGIN')).origin
const databaseUrl = assertDisposableTestDatabaseUrl(
  requiredEnvironment('ORG_REDESIGN_E2E_DATABASE_URL')
)
const authSecret = requiredEnvironment('ORG_REDESIGN_E2E_AUTH_SECRET')
const reportPath = resolve(requiredEnvironment('ORG_REDESIGN_E2E_REPORT_PATH'))
const phase = process.env.ORG_REDESIGN_E2E_PHASE ?? 'main'
const artifactDirectory = `${reportPath}.artifacts`
const sql = postgres(databaseUrl.toString(), { max: 2 })
const root = `/o/${ORGANIZATION_ID}`
const url = (path: string) => `${origin}${path}`
const orgUrl = (path: string) => url(`${root}${path}`)

type Persona = (typeof EVERYONE)[number]
type Status = 'passed' | 'failed' | 'skipped'
type Theme = 'light' | 'dark'
interface Viewport {
  name: string
  width: number
  height: number
}

const DESKTOP: Viewport = { name: 'desktop', width: 1440, height: 900 }
const PHONE: Viewport = { name: 'phone', width: 390, height: 844 }
const CHECK_TIMEOUT_MS = 180_000
/** A check whose sessions are closed fails its next step at once; this leaves its restores time. */
const CHECK_CANCEL_GRACE_MS = 30_000
const WALK_CONCURRENCY = 4

interface Problem {
  check: string
  kind: 'runtime' | 'console' | 'http' | 'network'
  url: string
  detail: string
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
const routes: {
  persona: string
  route: string
  viewport: string
  theme: Theme
  status: number | null
  finalPath: string
  screenshot: string | null
  platformSurfaces: number
}[] = []
const firstPaints: FirstPaint[] = []
const unexpected: Problem[] = []
let clientAddress = 0
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
const HIGH_VOLUME_REQUEST = /\/api\/mothership\/events|\/socket\.io\//

const browser: Browser = await chromium.launch()

/** What a running check holds, so a timeout can stop it instead of leaving it running behind the next. */
interface CheckScope {
  cancelled: boolean
  sessions: Set<Session>
}
const checkScope = new AsyncLocalStorage<CheckScope>()

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

function pathOf(address: string) {
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
function refused(status: number, method: string, path: string) {
  const query = path.includes('?') ? '' : '(\\?\\S*)?'
  return new RegExp(`^http \\S+ ${status} ${method} ${escapeRegExp(path)}${query}$`)
}

class Session {
  private readonly inflight = new Set<Request>()
  private lastActivity = Date.now()
  readonly requests: { method: string; path: string; type: string }[] = []

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
        !HANDLED_RUNTIME.test(text) &&
        !STREAMED_FAILURE.test(text)
      )
        recordProblem('console', page.url(), text)
    })
    page.on('request', (request) => {
      if (HIGH_VOLUME_REQUEST.test(request.url())) return
      this.inflight.add(request)
      this.lastActivity = Date.now()
      if (isSameOrigin(request.url()))
        this.requests.push({
          method: request.method(),
          path: pathOf(request.url()),
          type: request.resourceType(),
        })
    })
    const settled = (request: Request) => {
      this.inflight.delete(request)
      this.lastActivity = Date.now()
    }
    page.on('requestfinished', settled)
    page.on('requestfailed', (request) => {
      settled(request)
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

  /** Quiet for 400ms, ignoring the SSE and socket connections that never finish. */
  async settle(maxMs = 8_000) {
    const deadline = Date.now() + maxMs
    while (Date.now() < deadline) {
      if (this.inflight.size === 0 && Date.now() - this.lastActivity > 400) return
      await sleep(100)
    }
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
}

async function open(persona: Persona | null, options: OpenOptions = {}): Promise<Session> {
  const scope = checkScope.getStore()
  if (scope?.cancelled) throw new Error('The check timed out; it may not open another session')
  const viewport = options.viewport ?? DESKTOP
  clientAddress += 1
  const context = await browser.newContext({
    // Better Auth limits by address, and hundreds of loads from one would be nobody's real traffic.
    extraHTTPHeaders: {
      'x-forwarded-for': `10.0.${Math.floor(clientAddress / 250)}.${clientAddress % 250}`,
    },
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
  const session = new Session(context, await context.newPage())
  scope?.sessions.add(session)
  return session
}

async function withSession(
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

/** Admin and Mothership are for platform admins, which no persona is outside this scope. */
async function asPlatformAdmin<T>(run: () => Promise<T>) {
  await sql`update "user" set role = 'admin' where email = ${ADMIN.email}`
  try {
    return await run()
  } finally {
    await sql`update "user" set role = 'user' where email = ${ADMIN.email}`
  }
}

function section(name: string) {
  currentSection = name
  writeReport()
}

interface CheckOptions {
  /** Failures this check provokes on purpose. */
  allow?: RegExp[]
}

function record(name: string, section: string, started: number, error?: string) {
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

async function check(name: string, run: () => Promise<void>, options: CheckOptions = {}) {
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
function notProvable(name: string, reason: string) {
  checks.push({ name, section: currentSection, status: 'skipped', durationMs: 0, error: reason })
  writeReport()
}

/**
 * Fails a page's own read at its source, so its server seed stays out of hydration and the client
 * read fails too: the only way a seeded page reaches its error state. `restore` lets a check retry.
 */
async function withTableHidden(
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

const menuEntry = (page: Page, name: string | RegExp) =>
  page.getByRole('menuitem', { name, exact: typeof name === 'string' })

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Organization sidebar' })
const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' })
const composer = (page: Page) => page.getByRole('textbox', { name: 'Ask Sim' })
const searchField = (page: Page) => page.getByRole('textbox', { name: 'Search your sources' })
const dialog = (page: Page, name: string | RegExp) => page.getByRole('dialog', { name })
const orgChip = (page: Page) => page.getByRole('button', { name: 'Organization menu' })
const orgCard = (page: Page) => dialog(page, 'Organization menu')
/** Outside the sidebar, which has a section with the same name as Home's Workspaces. */
const homeRegion = (page: Page, name: string) =>
  page.getByRole('region', { name, exact: true }).locator('xpath=self::*[not(ancestor::aside)]')

async function navLabels(page: Page) {
  const links = mainNav(page).getByRole('link')
  await expect(links.first()).toBeVisible()
  return links.allInnerTexts()
}

async function expectPageNotFound(page: Page) {
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
}

/** A rail row's link, named once: a workspace's avatar adds nothing to its name. */
const railLink = (page: Page, label: string) =>
  sidebar(page).getByRole('link', { name: label, exact: true })

const accountChip = (page: Page) => sidebar(page).getByRole('button', { name: /, account menu$/ })

/** The row around a rail link: its status glyph sits beside the link, not in it. */
const railRow = (page: Page, label: string) => railLink(page, label).locator('xpath=..')

const railSection = (page: Page, name: string) =>
  sidebar(page).locator('summary', { hasText: name })

/** Opens a section row's options menu: the button appears on hover. */
async function openRowMenu(page: Page, label: string) {
  const link = railLink(page, label)
  await link.hover()
  await sidebar(page)
    .getByRole('button', { name: `Actions for ${label}`, exact: true })
    .click()
  return page.getByRole('menu', { name: `Actions for ${label}` })
}

async function clipboard(page: Page) {
  return page.evaluate(() => navigator.clipboard.readText())
}

async function assertNoHorizontalOverflow(page: Page, label: string) {
  const { scrollWidth, width } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    width: innerWidth,
  }))
  assert(scrollWidth <= width + 1, `${label} overflows: ${scrollWidth}px in ${width}px`)
}

async function landingChecks() {
  section('1 Where they land')
  await check('a member signing in lands on Home, not Search', async () => {
    await withSession(null, async ({ page }) => {
      await page.goto(url('/login'))
      await page.locator('#email').fill(MEMBER.email)
      await page.locator('#password').fill(PASSWORD)
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()
      await expect(page).toHaveURL(orgUrl('/home'), { timeout: 45_000 })
      await expect(composer(page)).toBeVisible()
    })
  })
  for (const persona of [MEMBER, ADMIN, OWNER, NARROW]) {
    await check(
      `${persona.key}: /o and /o/[id] and /home reach Home with no Search redirect`,
      async () => {
        await withSession(persona, async ({ page }) => {
          for (const path of ['/o', root, '/home']) {
            await page.goto(url(path))
            await expect(page).toHaveURL(orgUrl('/home'))
          }
          await expect(composer(page)).toBeVisible()
        })
      }
    )
  }
  await check('member: Search first load pins the saved mode into the URL', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/search'))
      await expect(page).toHaveURL(orgUrl('/search?mode=search'))
      await expect(searchField(page)).toBeVisible()
    })
  })
  await check('assistant chats redirect into Search from /chat', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl(`/chat/${MEMBER_CHATS.assistant.id}`))
      await expect(page).toHaveURL(orgUrl(`/search/chat/${MEMBER_CHATS.assistant.id}`))
      await expect(
        page.getByText(`Here is what I found about ${MEMBER_CHATS.assistant.title}.`)
      ).toBeVisible()
    })
  })
  await check(
    'an agent chat is not found for a member and renders for an admin',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl(`/chat/${MEMBER_CHATS.agent.id}`))
        await expectPageNotFound(page)
        await page.goto(orgUrl(`/search/chat/${MEMBER_CHATS.agent.id}`))
        await expectPageNotFound(page)
        await sql`update copilot_chats set last_seen_at = null where id = ${MEMBER_CHATS.agent.id}`
        await page.goto(orgUrl('/home'))
        await expect(railLink(page, MEMBER_CHATS.assistant.title)).toBeVisible()
        await expect(railLink(page, MEMBER_CHATS.agent.title)).toHaveCount(0)
        await expect(
          homeRegion(page, 'Needs your attention').getByText(MEMBER_CHATS.agent.title)
        ).toHaveCount(0)
        await sql`update copilot_chats set last_seen_at = now() where id = ${MEMBER_CHATS.agent.id}`
      })
      await withSession(ADMIN, async ({ page }) => {
        await page.goto(orgUrl(`/search/chat/${ADMIN_CHATS.agent.id}`))
        await expect(page).toHaveURL(orgUrl(`/chat/${ADMIN_CHATS.agent.id}`))
        await expect(
          page.getByText(`Here is what I found about ${ADMIN_CHATS.agent.title}.`)
        ).toBeVisible()
      })
    },
    {
      // The member's own agent chat, on both of its routes.
      allow: [
        refused(404, 'GET', `${root}/chat/${MEMBER_CHATS.agent.id}`),
        refused(404, 'GET', `${root}/search/chat/${MEMBER_CHATS.agent.id}`),
      ],
    }
  )
  await check(
    'a chat that is not theirs, or in another organization, is not found',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl(`/chat/${ADMIN_CHATS.agent.id}`))
        await expectPageNotFound(page)
        await page.goto(orgUrl(`/search/chat/${ADMIN_CHATS.assistant.id}`))
        await expectPageNotFound(page)
        await page.getByRole('link', { name: 'Return home', exact: true }).click()
        await expect(page).toHaveURL(orgUrl('/home'))
        await expect(composer(page)).toBeVisible()
      })
    },
    {
      // Someone else's chats, which must read as absent.
      allow: [
        refused(404, 'GET', `${root}/chat/${ADMIN_CHATS.agent.id}`),
        refused(404, 'GET', `${root}/search/chat/${ADMIN_CHATS.assistant.id}`),
      ],
    }
  )
  await check('signed out, every organization route goes to login', async () => {
    await withSession(null, async ({ page }) => {
      for (const path of [
        '/home',
        '/links',
        '/integrations?connectorType=gmail&provider=gmail&connectionMode=live&optionId=gmail',
      ]) {
        await page.goto(orgUrl(`${path}`))
        await expect(page).toHaveURL((address) => address.pathname === '/login')
      }
    })
  })
  notProvable(
    'Signed out: callbackUrl keeps the org root or page',
    'proxy.ts answers a cookieless request with a bare /login first; unchanged from staging'
  )
  await check('a non-member sees the denial and a way to their workspaces', async () => {
    await withSession(OUTSIDER, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      await expect(page.getByRole('heading', { name: 'Organization access denied' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'View your workspaces' })).toBeVisible()
    })
  })
  await check(
    'settings redirects and aliases resolve, and unavailable sections are not found',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl('/settings'))
        await expect(page).toHaveURL(orgUrl('/settings/general'))
        await page.goto(orgUrl('/settings/authorized-apps'))
        await expect(page).toHaveURL(
          (address) =>
            address.pathname === `${root}/settings/general` &&
            address.searchParams.get('view') === 'authorized-apps'
        )
        await page.goto(orgUrl('/settings/team'))
        await expect(page.getByPlaceholder('Search members…')).toBeVisible()
        await page.goto(orgUrl('/access-requests'))
        await expect(page).toHaveURL((address) => address.pathname === `${root}/settings/requests`)
        await page.goto(orgUrl('/settings/audit-logs'))
        await expectPageNotFound(page)
      })
    },
    // Audit logs is the one section a member may not open here.
    { allow: [refused(404, 'GET', `${root}/settings/audit-logs`)] }
  )
  await check(
    'People is not found with its flag off, and bad Integrations params are not found',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl('/people'))
        await expectPageNotFound(page)
        await page.goto(orgUrl('/integrations?connectorType=not-a-connector'))
        await expectPageNotFound(page)
        await page.goto(orgUrl('/integrations?slack=!!'))
        await expectPageNotFound(page)
      })
    },
    {
      // The flag-off page and the two malformed queries this check opens.
      allow: [
        refused(404, 'GET', `${root}/people`),
        refused(404, 'GET', `${root}/integrations?connectorType=not-a-connector`),
        refused(404, 'GET', `${root}/integrations?slack=!!`),
      ],
    }
  )
}

async function sidebarChecks() {
  section('2 Sidebar: nav')
  for (const persona of [MEMBER, ADMIN, OWNER, NARROW]) {
    await check(`${persona.key}: nav rows in today's order, plus Home for members`, async () => {
      await withSession(persona, async ({ page }) => {
        await page.goto(orgUrl('/home'))
        assert.deepEqual(await navLabels(page), ['Home', 'Search', 'Integrations', 'Links'])
      })
    })
  }
  await check('the current row is lit on descendants, and none on an agent chat', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl(`/search/chat/${ADMIN_CHATS.assistant.id}`))
      await expect(mainNav(page).getByRole('link', { name: 'Search' })).toHaveAttribute(
        'aria-current',
        'page'
      )
      await page.goto(orgUrl(`/chat/${ADMIN_CHATS.agent.id}`))
      await expect(mainNav(page).locator('[aria-current="page"]')).toHaveCount(0)
    })
  })
  await check(
    'right click on a nav row: Open in new tab and Copy link with the full URL',
    async () => {
      await withSession(MEMBER, async ({ page, context }) => {
        await page.goto(orgUrl('/home'))
        const row = mainNav(page).getByRole('link', { name: 'Links', exact: true })
        await row.click({ button: 'right' })
        await menuEntry(page, 'Copy link').click()
        await expect.poll(() => clipboard(page)).toBe(orgUrl('/links'))
        await row.click({ button: 'right' })
        const popup = context.waitForEvent('page')
        await menuEntry(page, 'Open in new tab').click()
        await expect(await popup).toHaveURL(orgUrl('/links'))
      })
    }
  )
  await check('hover warms Links and Integrations through their own reads', async () => {
    await withSession(MEMBER, async (session) => {
      const { page } = session
      await page.goto(orgUrl('/home'))
      await session.settle()
      session.requests.length = 0
      await mainNav(page).getByRole('link', { name: 'Links', exact: true }).hover()
      await expect
        .poll(() => session.requests.some(({ path }) => path.includes('/sim-links')))
        .toBe(true)
    })
  })

  section('2 Sidebar: rail chrome')
  await check(
    'collapse button and Mod+B toggle the icon rail, kept by cookie with no flash',
    async () => {
      await withSession(MEMBER, async ({ page, context }) => {
        await page.goto(orgUrl('/home'))
        const rail = sidebar(page)
        await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
        await expect(rail).toHaveAttribute('data-collapsed', 'true')
        await expect
          .poll(async () => Math.round((await rail.boundingBox())?.width ?? 0))
          .toBe(SIDEBAR_WIDTH.COLLAPSED)
        await expect
          .poll(
            async () => (await context.cookies()).find((c) => c.name === 'sidebar_collapsed')?.value
          )
          .toBe('1')
        const html = await (await context.request.get(orgUrl('/home'))).text()
        assert(/aria-label="Organization sidebar"/.test(html), 'The rail is in the document')
        assert(
          /data-collapsed="true"[^>]*aria-label="Organization sidebar"|aria-label="Organization sidebar"[^>]*data-collapsed="true"/.test(
            html
          ),
          'The server rendered it collapsed'
        )
        await page.reload()
        await expect(rail).toHaveAttribute('data-collapsed', 'true')
        await page.locator('body').click({ position: { x: 700, y: 20 } })
        await page.keyboard.press('Control+b')
        await expect(rail).not.toHaveAttribute('data-collapsed', 'true')
        await composer(page).click()
        await page.keyboard.press('Control+b')
        await expect(rail).not.toHaveAttribute('data-collapsed', 'true')
      })
    }
  )
  await check(
    'collapsed: tooltips name the rows, flyouts show every row, keyboard expands',
    async () => {
      await withSession(ADMIN, async ({ page }) => {
        await page.goto(orgUrl('/home'))
        await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
        await mainNav(page).getByRole('link', { name: 'Search', exact: true }).hover()
        await expect(page.getByRole('tooltip').filter({ hasText: 'Search' })).toBeVisible()
        await sidebar(page).getByRole('button', { name: 'Workspaces', exact: true }).hover()
        const flyout = dialog(page, 'Workspaces')
        await expect(flyout).toBeVisible()
        for (const { name } of WORKSPACES)
          await expect(flyout.getByText(name, { exact: true })).toBeVisible()
        await expect(flyout.getByText('New workspace')).toBeVisible()
        await page.mouse.move(800, 500)
        await sidebar(page).getByRole('button', { name: 'Chats', exact: true }).hover()
        const chats = dialog(page, 'Chats')
        await expect(chats.getByText(ADMIN_CHATS.agent.title)).toBeVisible()
        await page.mouse.move(800, 500)
        const edge = sidebar(page).getByRole('button', { name: 'Expand sidebar' }).last()
        await edge.focus()
        await page.keyboard.press('Enter')
        await expect(sidebar(page)).not.toHaveAttribute('data-collapsed', 'true')
      })
    }
  )
  await check('a collapsed member flyout omits New workspace', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
      await sidebar(page).getByRole('button', { name: 'Workspaces', exact: true }).hover()
      const flyout = dialog(page, 'Workspaces')
      await expect(flyout.getByText(MEMBER_ADMIN_WORKSPACE.name)).toBeVisible()
      await expect(flyout.getByText('New workspace')).toHaveCount(0)
    })
  })
  for (const theme of ['light', 'dark'] as const) {
    await check(`Home and Links paint one canvas (${theme})`, async () => {
      await withSession(
        MEMBER,
        async ({ page }) => {
          const canvasBehind = (target: Locator) =>
            target.evaluate((node) => {
              for (let at: Element | null = node; at; at = at.parentElement) {
                const color = getComputedStyle(at).backgroundColor
                if (color !== 'rgba(0, 0, 0, 0)') return color
              }
              return null
            })
          await page.goto(orgUrl('/home'))
          const home = await canvasBehind(page.getByRole('heading', { name: /^Good / }))
          await page.goto(orgUrl('/links'))
          const links = await canvasBehind(page.getByRole('heading', { level: 1, name: 'Links' }))
          assert.equal(home, links)
        },
        { theme }
      )
    })
  }
  await check('dragging the edge resizes the rail', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      const edge = sidebar(page).getByRole('separator', { name: 'Resize sidebar' })
      const before = (await sidebar(page).boundingBox())?.width ?? 0
      const box = await edge.boundingBox()
      assert(box, 'The edge is on screen')
      await page.mouse.move(box.x + box.width / 2, box.y + 200)
      await page.mouse.down()
      await page.mouse.move(box.x + 80, box.y + 200, { steps: 8 })
      await page.mouse.up()
      await expect
        .poll(async () => (await sidebar(page).boundingBox())?.width ?? 0)
        .toBeGreaterThan(before + 30)
    })
  })
  await check('arrow keys on the edge resize the rail, within its bounds', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      const edge = sidebar(page).getByRole('separator', { name: 'Resize sidebar' })
      const width = async () => Math.round((await sidebar(page).boundingBox())?.width ?? 0)
      const before = await width()
      await expect(edge).toHaveAttribute('aria-valuenow', String(before))
      await edge.focus()
      await page.keyboard.press('ArrowRight')
      await expect.poll(width).toBe(before + 16)
      await expect(edge).toHaveAttribute('aria-valuenow', String(before + 16))
      await page.keyboard.press('ArrowLeft')
      await expect.poll(width).toBe(before)
      for (let press = 0; press < 20; press++) await page.keyboard.press('ArrowLeft')
      await expect.poll(width).toBe(SIDEBAR_WIDTH.MIN)
      await page.keyboard.press('Enter')
      await expect.poll(width).toBe(SIDEBAR_WIDTH.MIN)
    })
  })
  await check(
    'the rail opens at its design width and moves to and from /workspace with no frame between',
    async () => {
      const workspaceHome = `/workspace/${MEMBER_ADMIN_WORKSPACE.id}/home`
      const railWidths = (page: Page) =>
        page.evaluate(() => (window as unknown as { railWidths: string[] }).railWidths)
      const pushRoute = (page: Page, href: string) =>
        page.evaluate((target) => {
          ;(
            window as unknown as { next: { router: { push: (href: string) => void } } }
          ).next.router.push(target)
        }, href)
      await withSession(ADMIN, async ({ page }) => {
        await page.addInitScript(() => {
          const seen = new Set<string>()
          const record = () => {
            for (const rail of document.querySelectorAll('aside[aria-label$=" sidebar"]')) {
              const width = Math.round(rail.getBoundingClientRect().width)
              if (width > 0) seen.add(`${rail.getAttribute('aria-label')}:${width}`)
            }
            ;(window as unknown as { railWidths: string[] }).railWidths = [...seen]
            requestAnimationFrame(record)
          }
          requestAnimationFrame(record)
        })
        await page.goto(orgUrl('/home'))
        await expect(sidebar(page)).toBeVisible()
        await pushRoute(page, workspaceHome)
        await expect(page.getByRole('complementary', { name: 'Workspace sidebar' })).toBeVisible({
          timeout: 45_000,
        })
        await pushRoute(page, `${root}/home`)
        await expect(sidebar(page)).toBeVisible({ timeout: 45_000 })
        await sleep(250)
        assert.deepEqual((await railWidths(page)).sort(), [
          `Organization sidebar:${SIDEBAR_WIDTH.ORGANIZATION_DEFAULT}`,
          `Workspace sidebar:${SIDEBAR_WIDTH.DEFAULT}`,
        ])
      })
    }
  )
  await check(
    'a dragged organization width is kept and leaves the workspace rail alone',
    async () => {
      await withSession(ADMIN, async ({ page }) => {
        await page.goto(orgUrl('/home'))
        const edge = sidebar(page).getByRole('separator', { name: 'Resize sidebar' })
        const box = await edge.boundingBox()
        assert(box, 'The edge is on screen')
        await page.mouse.move(box.x + box.width / 2, box.y + 200)
        await page.mouse.down()
        await page.mouse.move(340, box.y + 200, { steps: 8 })
        await page.mouse.up()
        const railWidth = async (rail: Locator) =>
          Math.round((await rail.boundingBox())?.width ?? 0)
        await expect.poll(() => railWidth(sidebar(page))).toBe(340)
        await page.reload()
        await expect.poll(() => railWidth(sidebar(page))).toBe(340)
        await page.goto(url(`/workspace/${MEMBER_ADMIN_WORKSPACE.id}/home`))
        const workspaceRail = page.getByRole('complementary', { name: 'Workspace sidebar' })
        await expect.poll(() => railWidth(workspaceRail)).toBe(SIDEBAR_WIDTH.DEFAULT)
      })
    }
  )
  await check('a width saved before the organization default still applies', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      await page.evaluate(() =>
        localStorage.setItem('sidebar-state', JSON.stringify({ state: { sidebarWidth: 310 } }))
      )
      await page.reload()
      await expect
        .poll(async () => Math.round((await sidebar(page).boundingBox())?.width ?? 0))
        .toBe(310)
    })
  })
  await check('on a phone the rail is a drawer that opens and closes', async () => {
    await withSession(
      MEMBER,
      async ({ page }) => {
        await page.goto(orgUrl('/home'))
        await expect(composer(page)).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Collapse sidebar', exact: true })
        ).toBeHidden()
        const toggle = page.getByRole('button', { name: /open (sidebar|menu|navigation)/i }).first()
        await toggle.tap()
        await expect(mainNav(page).getByRole('link', { name: 'Links', exact: true })).toBeVisible()
        await mainNav(page).getByRole('link', { name: 'Links', exact: true }).tap()
        await expect(page).toHaveURL(orgUrl('/links'))
        await expect(page.getByRole('heading', { name: 'Links' })).toBeVisible()
      },
      { viewport: PHONE }
    )
  })
  await check('the rail swaps to Settings navigation and back', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/settings/general'))
      await expect(mainNav(page)).toHaveCount(0)
      await expect(sidebar(page).getByRole('link', { name: 'Members', exact: true })).toBeVisible()
      await sidebar(page).getByRole('button', { name: 'Back to app', exact: true }).click()
      await expect(page).toHaveURL(orgUrl('/home'))
      await expect(composer(page)).toBeVisible()
    })
  })
  notProvable('Hover peek on the macOS desktop app', 'Needs the packaged desktop app on macOS')
  notProvable('Impersonation banner', 'Needs an admin impersonation session')

  section('2 Sidebar: org card')
  await check(
    'chip names the organization; a member gets a read-only card with Settings',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl('/home'))
        const chip = orgChip(page)
        await expect(chip).toContainText(ORGANIZATION_NAME)
        await chip.click()
        const card = orgCard(page)
        await expect(card.getByText(/\d+ members?/)).toBeVisible()
        await expect(card.getByRole('button', { name: 'Rename organization' })).toHaveCount(0)
        await expect(card.getByRole('button', { name: 'Change organization logo' })).toHaveCount(0)
        await expect(card.getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0)
        await card.getByRole('button', { name: 'Settings', exact: true }).click()
        await expect(page).toHaveURL(orgUrl('/settings/members'))
      })
    }
  )
  await check(
    'an admin renames inline: Enter saves, Escape cancels, and it survives reload',
    async () => {
      await withSession(ADMIN, async ({ page }) => {
        await page.goto(orgUrl('/home'))
        const chip = orgChip(page)
        const card = orgCard(page)
        async function startRename() {
          await card.getByRole('button', { name: 'Rename organization' }).click()
          return card.getByRole('textbox', { name: 'Organization name' })
        }
        const renamed = `${ORGANIZATION_NAME} Group`
        await chip.click()
        const field = await startRename()
        await field.fill('Discarded name')
        await field.press('Escape')
        await expect(card.getByText(ORGANIZATION_NAME, { exact: true })).toBeVisible()
        const again = await startRename()
        await again.fill(renamed)
        await again.press('Enter')
        await expect(chip).toContainText(renamed)
        await page.reload()
        await expect(chip).toContainText(renamed)
        await chip.click()
        const restore = await startRename()
        await restore.fill(ORGANIZATION_NAME)
        await restore.press('Enter')
        await expect
          .poll(
            async () =>
              (await sql`select name from organization where id = ${ORGANIZATION_ID}`)[0]?.name
          )
          .toBe(ORGANIZATION_NAME)
        await expect(chip).toContainText(ORGANIZATION_NAME)
      })
    }
  )
  await check(
    'a failed rename shows inline and holds the menu open',
    async () => {
      await withSession(ADMIN, async ({ page }) => {
        await page.route(`**/api/organizations/${ORGANIZATION_ID}`, (route) =>
          route.request().method() === 'PATCH' || route.request().method() === 'PUT'
            ? route.fulfill({ status: 400, json: { error: 'That name is taken' } })
            : route.continue()
        )
        await page.goto(orgUrl('/home'))
        await orgChip(page).click()
        const card = orgCard(page)
        await card.getByRole('button', { name: 'Rename organization' }).click()
        const field = card.getByRole('textbox', { name: 'Organization name' })
        await field.fill('Taken name')
        await field.press('Enter')
        await expect(card.getByRole('alert')).toBeVisible()
        await expect(card).toBeVisible()
      })
    },
    { allow: [/400 (PATCH|PUT) \/api\/organizations\//] }
  )
  await check('an admin can change the logo from the card', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      await orgChip(page).click()
      const card = orgCard(page)
      await expect(card.getByRole('button', { name: 'Change organization logo' })).toBeEnabled()
      const started = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && pathOf(response.url()) === '/api/files/uploads'
      )
      await page.getByLabel('Organization logo').setInputFiles({
        name: 'logo.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64'
        ),
      })
      const response = await started
      assert(
        response.ok(),
        `Starting the upload answered ${response.status()}: ${await response.text()}`
      )
      await expect
        .poll(
          async () =>
            (await sql`select logo from organization where id = ${ORGANIZATION_ID}`)[0]?.logo
        )
        .toBeTruthy()
    })
  })
  await check('Invite follows the default group, and an admin invites when it allows', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      await orgChip(page).click()
      await expect(orgCard(page).getByRole('button', { name: 'Invite', exact: true })).toHaveCount(
        0
      )
      await sql`update permission_group set config = config - 'disableInvitations' where id = ${STANDARD_GROUP_ID}`
      await page.reload()
      await orgChip(page).click()
      await orgCard(page).getByRole('button', { name: 'Invite', exact: true }).click()
      const modal = dialog(page, 'Invite people')
      await expect(modal).toBeVisible()
      const field = modal.getByRole('textbox', { name: 'Email addresses' })
      await field.fill(`invitee@org-redesign.test`)
      await field.press('Enter')
      await expect(
        modal.getByRole('combobox', { name: 'Role' }).or(modal.getByLabel('Role'))
      ).toBeVisible()
      await field.fill('refused@org-redesign.test')
      await field.press('Enter')
      await expect(modal.getByRole('button', { name: 'Send invites' })).toBeEnabled()
      await page.route('**/api/workspaces/invitations/batch', (route) =>
        route.fulfill({
          json: {
            success: false,
            successful: ['invitee@org-redesign.test'],
            added: [],
            failed: [{ email: 'refused@org-redesign.test', error: 'Seat limit reached' }],
            invitations: [],
          },
        })
      )
      await modal.getByRole('button', { name: 'Send invites' }).click()
      await expect(modal.getByRole('alert')).toBeVisible()
      await expect(modal.getByText('refused@org-redesign.test')).toBeVisible()
      await expect(modal.getByText('invitee@org-redesign.test')).toHaveCount(0)
      await modal.getByRole('button', { name: 'Cancel' }).click()
      await expect(modal).toHaveCount(0)
    }).finally(
      () =>
        sql`update permission_group set config = config || '{"disableInvitations":true}'::jsonb where id = ${STANDARD_GROUP_ID}`
    )
  })

  section('2 Sidebar: workspaces')
  await check('a member sees only their workspaces; + is disabled and says why', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      await expect(
        sidebar(page).getByRole('link', { name: MEMBER_ADMIN_WORKSPACE.name })
      ).toBeVisible()
      await expect(
        sidebar(page).getByRole('link', { name: MEMBER_WRITE_WORKSPACE.name })
      ).toBeVisible()
      await expect(railLink(page, 'Finance')).toHaveCount(0)
      await expect(
        sidebar(page).getByRole('button', {
          name: /Only organization owners and admins can create organization workspaces/,
        })
      ).toBeDisabled()
    })
  })
  await check('no workspaces says so', async () => {
    await withSession(NARROW, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      await expect(sidebar(page).getByText('No workspaces yet')).toBeVisible()
    })
  })
  await check('an admin pages through workspaces and the section collapses', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      const rail = sidebar(page)
      await expect(rail.getByRole('link', { name: WORKSPACES[4].name })).toBeVisible()
      await expect(rail.getByRole('link', { name: WORKSPACES[6].name })).toHaveCount(0)
      await rail.getByRole('button', { name: 'See more' }).click()
      await expect(rail.getByRole('link', { name: WORKSPACES[6].name })).toBeVisible()
      await rail.getByRole('button', { name: 'See less' }).click()
      await expect(rail.getByRole('link', { name: WORKSPACES[6].name })).toHaveCount(0)
      await railSection(page, 'Workspaces').click()
      await expect(railLink(page, WORKSPACES[0].name)).toBeHidden()
    })
  })
  await check(
    'workspace menu: Open in new tab, Pin, Rename gated, nothing destructive',
    async () => {
      await withSession(MEMBER, async ({ page, context }) => {
        await page.goto(orgUrl('/home'))
        const writeMenu = await openRowMenu(page, MEMBER_WRITE_WORKSPACE.name)
        await expect(menuEntry(page, 'Rename')).toBeDisabled()
        await expect(writeMenu.getByRole('menuitem')).toHaveText([
          'Open in new tab',
          'Pin',
          'Rename',
        ])
        await page.keyboard.press('Escape')
        await openRowMenu(page, MEMBER_ADMIN_WORKSPACE.name)
        await expect(menuEntry(page, 'Rename')).toBeEnabled()
        await menuEntry(page, 'Pin').click()
        await expect(
          railRow(page, MEMBER_ADMIN_WORKSPACE.name).getByRole('img', { name: 'Pinned' })
        ).toBeVisible()
        await openRowMenu(page, MEMBER_ADMIN_WORKSPACE.name)
        await menuEntry(page, 'Unpin').click()
        await openRowMenu(page, MEMBER_ADMIN_WORKSPACE.name)
        const popup = context.waitForEvent('page')
        await menuEntry(page, 'Open in new tab').click()
        await expect(await popup).toHaveURL((address) =>
          address.pathname.startsWith(`/workspace/${MEMBER_ADMIN_WORKSPACE.id}`)
        )
      })
    }
  )
  await check('an admin creates a workspace and enters it', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      await sidebar(page).getByRole('button', { name: 'New workspace', exact: true }).click()
      const modal = dialog(page, 'Create workspace')
      await modal.getByRole('textbox', { name: 'Name' }).fill('Created in acceptance')
      await modal.getByRole('button', { name: 'Create', exact: true }).click()
      await expect(page).toHaveURL((address) => address.pathname.startsWith('/workspace/'), {
        timeout: 45_000,
      })
    })
  })
  await check('rename a workspace from its menu', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      await openRowMenu(page, MEMBER_ADMIN_WORKSPACE.name)
      await menuEntry(page, 'Rename').click()
      const modal = dialog(page, 'Rename workspace')
      const field = modal.getByRole('textbox', { name: 'Name' })
      await field.fill('Operations East')
      await modal.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(sidebar(page).getByRole('link', { name: 'Operations East' })).toBeVisible()
      await openRowMenu(page, 'Operations East')
      await menuEntry(page, 'Rename').click()
      await dialog(page, 'Rename workspace')
        .getByRole('textbox', { name: 'Name' })
        .fill(MEMBER_ADMIN_WORKSPACE.name)
      await dialog(page, 'Rename workspace')
        .getByRole('button', { name: 'Save', exact: true })
        .click()
      await expect(
        sidebar(page).getByRole('link', { name: MEMBER_ADMIN_WORKSPACE.name })
      ).toBeVisible()
    })
  })

  section('2 Sidebar: chats')
  await check('rows link by mode, and an empty list says so', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      await expect(
        sidebar(page).getByRole('link', { name: MEMBER_CHATS.assistant.title })
      ).toHaveAttribute('href', `${root}/search/chat/${MEMBER_CHATS.assistant.id}`)
    })
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      await expect(
        sidebar(page).getByRole('link', { name: ADMIN_CHATS.agent.title })
      ).toHaveAttribute('href', `${root}/chat/${ADMIN_CHATS.agent.id}`)
    })
    await withSession(NARROW, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      await expect(sidebar(page).getByText('No chats yet')).toBeVisible()
    })
  })
  await check('unread dot, hidden on the chat itself; Mark as read and unread work', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      const row = railRow(page, MEMBER_CHATS.unread.title)
      await expect(row.getByRole('img', { name: 'Unread' })).toBeVisible()
      await openRowMenu(page, MEMBER_CHATS.unread.title)
      await menuEntry(page, 'Mark as read').click()
      await expect(row.getByRole('img', { name: 'Unread' })).toHaveCount(0)
      await openRowMenu(page, MEMBER_CHATS.unread.title)
      await menuEntry(page, 'Mark as unread').click()
      await expect(row.getByRole('img', { name: 'Unread' })).toBeVisible()
      await railLink(page, MEMBER_CHATS.unread.title).click()
      await expect(page).toHaveURL(
        (address) => address.pathname === `${root}/search/chat/${MEMBER_CHATS.unread.id}`
      )
      await expect(row.getByRole('img', { name: 'Unread' })).toHaveCount(0)
    })
  })
  await check('menu: Copy link, Pin, Rename inline, right click opens the same menu', async () => {
    await withSession(MEMBER, async ({ page, context }) => {
      await page.goto(orgUrl('/home'))
      const title = MEMBER_CHATS.assistant.title
      const row = railLink(page, title)
      await row.click({ button: 'right' })
      await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText([
        'Open in new tab',
        'Copy link',
        'Mark as unread',
        'Pin',
        'Rename',
        'Delete',
      ])
      await menuEntry(page, 'Copy link').click()
      await expect
        .poll(() => clipboard(page))
        .toBe(orgUrl(`/search/chat/${MEMBER_CHATS.assistant.id}`))
      await openRowMenu(page, title)
      await menuEntry(page, 'Pin').click()
      await expect(railRow(page, title).getByRole('img', { name: 'Pinned' })).toBeVisible()
      await openRowMenu(page, title)
      await menuEntry(page, 'Unpin').click()
      await openRowMenu(page, title)
      await menuEntry(page, 'Rename').click()
      const modal = dialog(page, 'Rename chat')
      await modal.getByRole('textbox', { name: 'Chat name' }).fill(`${title} renamed`)
      await modal.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(sidebar(page).getByRole('link', { name: `${title} renamed` })).toBeVisible()
      await openRowMenu(page, `${title} renamed`)
      const popup = context.waitForEvent('page')
      await menuEntry(page, 'Open in new tab').click()
      await expect(await popup).toHaveURL(orgUrl(`/search/chat/${MEMBER_CHATS.assistant.id}`))
      await openRowMenu(page, `${title} renamed`)
      await menuEntry(page, 'Rename').click()
      await modal.getByRole('textbox', { name: 'Chat name' }).fill(title)
      await modal.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(sidebar(page).getByRole('link', { name: title, exact: true })).toBeVisible()
    })
  })
  await check('deleting the open chat returns to where its mode lives', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl(`/search/chat/${MEMBER_CHATS.removable.id}`))
      await openRowMenu(page, MEMBER_CHATS.removable.title)
      await menuEntry(page, 'Delete').click()
      const modal = dialog(page, 'Delete chat')
      await expect(modal.getByText(MEMBER_CHATS.removable.title)).toBeVisible()
      await modal.getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page).toHaveURL((address) => address.pathname === `${root}/search`)
      await expect(
        sidebar(page).getByRole('link', { name: MEMBER_CHATS.removable.title })
      ).toHaveCount(0)
    })
  })
  await check(
    'shift click selects a range, background click clears, bulk delete keeps failed rows',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl('/home'))
        const first = sidebar(page).getByRole('link', { name: MEMBER_CHATS.bulkOne.title })
        const second = sidebar(page).getByRole('link', { name: MEMBER_CHATS.bulkTwo.title })
        await first.click({ modifiers: ['Shift'] })
        await second.click({ modifiers: ['Shift'] })
        await second.click({ button: 'right' })
        await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['Delete 2 chats'])
        await page.keyboard.press('Escape')
        await sidebar(page)
          .locator('nav')
          .first()
          .evaluate((node) => node.parentElement?.click())
        await second.click({ button: 'right' })
        await expect(page.getByRole('menu').getByRole('menuitem').last()).toHaveText('Delete')
        await page.keyboard.press('Escape')
        await first.click({ modifiers: ['Shift'] })
        await page.route(`**/api/mothership/chats/${MEMBER_CHATS.bulkTwo.id}`, (route) =>
          route.request().method() === 'DELETE'
            ? route.fulfill({ status: 500, json: { error: 'No' } })
            : route.continue()
        )
        await second.click({ button: 'right' })
        await menuEntry(page, 'Delete 2 chats').click()
        const modal = dialog(page, 'Delete 2 chats')
        await modal.getByRole('button', { name: 'Delete', exact: true }).click()
        await expect(first).toHaveCount(0)
        await expect(second).toBeVisible()
        await expect(dialog(page, 'Delete chat')).toBeVisible()
        await page.unrouteAll()
        await dialog(page, 'Delete chat')
          .getByRole('button', { name: 'Delete', exact: true })
          .click()
        await expect(second).toHaveCount(0)
      })
    },
    { allow: [/500 DELETE \/api\/mothership\/chats\//] }
  )

  section('2 Sidebar: footer')
  await check('account chip and menu: Settings and Sign out', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      const chip = accountChip(page)
      await expect(chip).toContainText(MEMBER.name)
      await expect(chip).toHaveAccessibleName(`${MEMBER.name}, account menu`)
      await chip.click()
      const menu = dialog(page, 'Account menu')
      await expect(menu.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
      await menu.getByRole('button', { name: 'Settings', exact: true }).click()
      await expect(page).toHaveURL(orgUrl('/settings/general'))
    })
  })
  await check('sign out ends the session', async () => {
    await withSession(CONNECTED, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      await accountChip(page).click()
      await dialog(page, 'Account menu')
        .getByRole('button', { name: 'Sign out', exact: true })
        .click()
      await expect(page).toHaveURL(
        (address) => address.pathname === '/login' || address.pathname === '/',
        { timeout: 30_000 }
      )
    })
    await sql`insert into session (id, token, user_id, active_organization_id, expires_at, created_at, updated_at)
      values (${`org-redesign-session-row-${CONNECTED.key}`}, ${CONNECTED.sessionToken}, ${CONNECTED.userId}, ${ORGANIZATION_ID}, now() + interval '1 day', now(), now())
      on conflict (id) do nothing`
  })
  await check(
    'Help menu: Documentation, Join Slack, and a support request posted with its fields',
    async () => {
      await withSession(MEMBER, async ({ page, context }) => {
        await context.route(/docs\.sim\.ai|sim\.ai\/slack|slack\.com/, (route) =>
          route.fulfill({ status: 200, contentType: 'text/html', body: 'stand-in' })
        )
        await page.goto(orgUrl('/home'))
        const help = sidebar(page).getByRole('button', { name: 'Help', exact: true })
        await help.click()
        await expect(menuEntry(page, 'Join Slack')).toBeVisible()
        const docs = context.waitForEvent('page')
        await menuEntry(page, 'Documentation').click()
        await (await docs).close()
        await help.click()
        await menuEntry(page, 'Contact support').click()
        const modal = dialog(page, 'Contact support')
        await page.route('**/api/help', (route) =>
          route.fulfill({ status: 200, json: { success: true } })
        )
        await modal.getByRole('textbox', { name: 'Subject' }).fill('A question')
        await modal.getByRole('textbox', { name: 'Message' }).fill('The details')
        const sent = page.waitForRequest((request) => request.url().endsWith('/api/help'))
        await modal.getByRole('button', { name: 'Send', exact: true }).click()
        const request = await sent
        assert.match(request.headers()['content-type'] ?? '', /multipart\/form-data/)
        const posted = request.postData() ?? ''
        assert.match(posted, /A question/, 'The request carries its subject')
        assert.match(posted, /The details/, 'The request carries its message')
        await expect(modal).toHaveCount(0)
      })
    }
  )
  await check('Help menu: the macOS app is offered on a Mac browser only', async () => {
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
    const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    for (const [userAgent, offered] of [
      [mac, 1],
      [windows, 0],
    ] as const) {
      await withSession(MEMBER, async ({ page }) => {
        await page.addInitScript((agent) => {
          Object.defineProperty(navigator, 'userAgent', { get: () => agent })
        }, userAgent)
        await page.goto(orgUrl('/home'))
        await sidebar(page).getByRole('button', { name: 'Help', exact: true }).click()
        await expect(menuEntry(page, 'Contact support')).toBeVisible()
        await expect(menuEntry(page, 'Download apps')).toHaveCount(offered)
      })
    }
  })
  notProvable(
    'Help menu: desktop update row',
    'Needs the packaged desktop app with an update pending'
  )
}

const FOUR_WAY_MEETINGS = ['Board prep', 'Budget review', 'Hiring loop', 'Vendor call']
/** Adjacent meetings, a pair side by side with one shorter than its slot, then a four-way overlap. */
const BUSY_DAY_EVENTS = [
  { title: 'Morning planning', start: '09:30', end: '10:00', people: [{ name: 'Ada Lovelace' }] },
  {
    title: 'Sim search feedback review',
    start: '10:00',
    end: '10:30',
    people: [{ name: 'Ada Lovelace' }, { name: 'Alan Turing' }, { name: 'Edith Clarke' }],
  },
  { title: 'Design check-in', start: '10:00', end: '10:20', people: [{ name: 'Alan Turing' }] },
  { title: 'Roadmap session', start: '11:00', end: '12:00', people: [{ name: 'Edith Clarke' }] },
  ...FOUR_WAY_MEETINGS.map((title) => ({ title, start: '13:00', end: '14:00', people: [] })),
]

/** Replies the same Google stand-in every test sees for a viewer's connected accounts. */
async function stubConnectedHome(page: Page) {
  const today = new Date().toISOString().slice(0, 10)
  const account = (credentialId: string) => ({
    credentialId,
    displayName: CONNECTED.email,
    state: 'ready',
  })
  await page.route(`**/api/organizations/${ORGANIZATION_ID}/home/email**`, (route) =>
    route.fulfill({
      json: {
        accounts: [account(GRANTS.gmail.credentialId)],
        threads: [
          {
            id: 'thread-1',
            credentialId: GRANTS.gmail.credentialId,
            sender: 'Grace Hopper',
            subject: 'Parts recall notice',
            excerpt: 'The draft is ready for review',
            receivedAt: new Date(Date.now() - 3_600_000).toISOString(),
            messageCount: 3,
            url: 'https://mail.google.com/mail/u/0/#inbox/thread-1',
          },
        ],
      },
    })
  )
  await page.route(`**/api/organizations/${ORGANIZATION_ID}/home/calendar**`, (route) => {
    const date = new URL(route.request().url()).searchParams.get('date') ?? today
    return route.fulfill({
      json: {
        accounts: [account(GRANTS['google-calendar'].credentialId)],
        window: { startAt: `${date}T00:00:00.000Z`, endAt: `${date}T23:59:59.000Z` },
        events: [
          {
            id: `event-${date}`,
            credentialId: GRANTS['google-calendar'].credentialId,
            title: `Standup ${date}`,
            allDay: false,
            startAt: `${date}T15:00:00.000Z`,
            endAt: `${date}T15:30:00.000Z`,
            people: [{ name: 'Grace Hopper' }],
          },
          ...BUSY_DAY_EVENTS.map(({ title, start, end, people }) => ({
            id: `${title}-${date}`,
            credentialId: GRANTS['google-calendar'].credentialId,
            title,
            allDay: false,
            startAt: `${date}T${start}:00.000Z`,
            endAt: `${date}T${end}:00.000Z`,
            url: `https://calendar.google.com/event/${encodeURIComponent(title)}`,
            people,
          })),
        ],
      },
    })
  })
}

/**
 * Real signals for the Home Workspaces rows: a person-paused run in the member's write workspace, a
 * live run in their admin workspace, and a paused run in one they cannot open, which must not reach them.
 */
async function withWorkspaceActivity(run: () => Promise<void>) {
  const prefix = 'org-redesign-activity'
  const seeded = [
    { key: 'review', workspaceId: MEMBER_WRITE_WORKSPACE.id, name: 'Renewal approval' },
    { key: 'running', workspaceId: MEMBER_ADMIN_WORKSPACE.id, name: 'Invoice sync' },
    { key: 'hidden', workspaceId: WORKSPACES[4].id, name: 'Not for this member' },
  ]
  const cleanup = async () => {
    await sql`delete from workflow_execution_logs where id like ${`${prefix}-%`}`
    await sql`delete from workflow_execution_snapshots where id like ${`${prefix}-%`}`
    await sql`delete from workflow where id like ${`${prefix}-%`}`
  }
  try {
    for (const { key, workspaceId: scope, name } of seeded) {
      const workflowId = `${prefix}-${key}`
      await sql`insert into workflow (id, user_id, workspace_id, name, last_synced, created_at, updated_at)
        values (${workflowId}, ${OWNER.userId}, ${scope}, ${name}, now(), now(), now())`
      if (key === 'running') {
        await sql`insert into workflow_execution_snapshots (id, workflow_id, state_hash, state_data)
          values (${workflowId}, ${workflowId}, ${workflowId}, ${sql.json({})})`
        await sql`insert into workflow_execution_logs (id, workflow_id, workspace_id, execution_id, state_snapshot_id, level, status, trigger, started_at, execution_deadline_at)
          values (${workflowId}, ${workflowId}, ${scope}, ${workflowId}, ${workflowId}, 'info', 'running', 'api', now(), now() + interval '30 minutes')`
      } else {
        await sql`insert into paused_executions (id, workflow_id, execution_id, execution_snapshot, pause_points, total_pause_count)
          values (${workflowId}, ${workflowId}, ${workflowId}, ${sql.json({})}, ${sql.json({ approval: { resumeStatus: 'paused', pauseKind: 'human' } })}, 1)`
      }
    }
    await run()
  } finally {
    await cleanup()
  }
}

async function homeChecks() {
  section('3 Home: member')
  await check(
    'Home renders the greeting, the Assistant composer, and no Build/Search picker',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl('/home'))
        await expect(page).toHaveURL(orgUrl('/home'))
        await expect(page.getByRole('heading', { level: 1 })).toContainText(', Mia')
        await expect(page.getByText('Ask about your company’s knowledge.')).toBeVisible()
        await expect(composer(page)).toHaveAttribute('placeholder', 'Ask about your sources')
        await expect(composer(page).locator('xpath=ancestor::*[@data-platform-ui]')).toHaveCount(0)
        await expect(page.getByRole('radio', { name: 'Search' })).toHaveCount(0)
        await expect(page.getByRole('combobox', { name: 'Conversation mode' })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Add resources' })).toHaveCount(0)
      })
    }
  )
  await check(
    'the Assistant composer sends to the assistant route and lands under Search',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl('/home'))
        await composer(page).fill('Say hello from Home')
        const posted = page.waitForRequest(
          (request) => request.method() === 'POST' && request.url().endsWith('/api/mothership/chat')
        )
        await composer(page).press('Enter')
        const body = (await posted).postDataJSON()
        assert.equal(body.mode, 'assistant')
        assert.equal(body.organizationId, ORGANIZATION_ID)
        assert.equal(body.createNewChat, true)
        assert.equal(body.message, 'Say hello from Home')
        await expect(page).toHaveURL(/\/search\/chat\/[^/?]+/, { timeout: 30_000 })
        await expect(page.getByText('Hello from the scripted agent.')).toBeVisible({
          timeout: 30_000,
        })
        const chatId = new URL(page.url()).pathname.split('/').at(-1)
        await expect(page.getByRole('navigation', { name: 'Search views' })).toBeVisible()
        await composer(page).fill('An unsent follow-up')
        await page
          .getByRole('navigation', { name: 'Search views' })
          .getByRole('button', { name: 'Search' })
          .click()
        await expect(page).toHaveURL(new RegExp(`/search/chat/${chatId}\\?mode=search`))
        await expect(searchField(page)).toBeVisible()
        await page
          .getByRole('navigation', { name: 'Search views' })
          .getByRole('button', { name: 'Assistant' })
          .click()
        await expect(page.getByText('Hello from the scripted agent.')).toBeVisible()
        await expect(
          sidebar(page)
            .getByRole('link', { name: /Scripted chat|Say hello/ })
            .first()
        ).toHaveAttribute('href', `${root}/search/chat/${chatId}`)
      })
    }
  )
  await check('New chat on a chat started from Home returns to an empty Home', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      await composer(page).fill('Say hello again from Home')
      await composer(page).press('Enter')
      await expect(page).toHaveURL(/\/search\/chat\/[^/?]+/, { timeout: 30_000 })
      await page.getByRole('button', { name: 'New chat', exact: true }).click()
      await expect(page).toHaveURL(/\/home$/)
      await expect(composer(page)).toHaveValue('')
    })
  })
  await check('Home, Search and the agent keep separate drafts', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      await composer(page).fill('A draft on Home')
      await page.goto(orgUrl('/search?mode=assistant'))
      await expect(composer(page)).toHaveValue('')
      await composer(page).fill('A draft in Search')
      await page.goto(orgUrl('/home'))
      await expect(composer(page)).toHaveValue('A draft on Home')
      await page.goto(orgUrl('/search?mode=assistant'))
      await expect(composer(page)).toHaveValue('A draft in Search')
      await page.goto(orgUrl('/home'))
      await composer(page).fill('')
    })
  })
  await check(
    'Email and Calendar prompt to connect, with only the providers on offer',
    async () => {
      await withSession(MEMBER, async ({ page, context }) => {
        await context.route('https://accounts.google.com/**', (route) =>
          route.fulfill({ status: 200, contentType: 'text/html', body: 'Google stand-in' })
        )
        await page.goto(orgUrl('/home'))
        const email = homeRegion(page, 'Email')
        await expect(email.getByText('Connect your email', { exact: true })).toBeVisible()
        await expect(email.getByRole('button', { name: 'Gmail', exact: true })).toBeEnabled()
        await expect(email.getByRole('button', { name: 'Outlook', exact: true })).toHaveCount(0)
        const calendar = homeRegion(page, 'Calendar')
        await expect(calendar.getByText('Connect your calendar', { exact: true })).toBeVisible()
        await expect(
          calendar.getByRole('button', { name: 'Google Calendar', exact: true })
        ).toBeEnabled()
        const cardHeight = async (region: Locator, title: string) =>
          Math.round(
            (await region.getByText(title, { exact: true }).locator('xpath=..').boundingBox())
              ?.height ?? 0
          )
        assert.equal(await cardHeight(email, 'Connect your email'), 176)
        assert.equal(await cardHeight(calendar, 'Connect your calendar'), 156)
        await expect(calendar.getByRole('button', { name: 'Outlook', exact: true })).toHaveCount(0)
        const authorization = context.waitForEvent('request', (request) =>
          request.url().startsWith('https://accounts.google.com/')
        )
        await email.getByRole('button', { name: 'Gmail', exact: true }).click()
        const target = new URL((await authorization).url())
        assert.equal(target.searchParams.get('client_id'), process.env.GOOGLE_CLIENT_ID)
      })
    }
  )
  await check('Connected members see their mail and schedule, and can change the day', async () => {
    await withSession(CONNECTED, async ({ page }) => {
      await stubConnectedHome(page)
      await page.goto(orgUrl('/home'))
      const email = homeRegion(page, 'Email')
      await expect(email.getByText('Parts recall notice')).toBeVisible()
      await expect(email.getByText('Connect your email')).toHaveCount(0)
      await expect(page.getByRole('region', { name: 'Calendar schedule' })).toBeVisible()
      const calendar = homeRegion(page, 'Calendar')
      const standup = calendar.getByText(/^Standup /)
      await expect(standup).toBeVisible()
      const today = await standup.innerText()
      await calendar.getByRole('button', { name: 'Next day', exact: true }).click()
      await expect(page).toHaveURL((address) => address.searchParams.has('day'))
      await expect(standup).not.toHaveText(today)
      await expect(standup).toBeVisible()
    })
  })
  for (const viewport of [DESKTOP, PHONE]) {
    for (const theme of ['light', 'dark'] as const) {
      await check(`Calendar cards never touch (${viewport.name} ${theme})`, async () => {
        await withSession(
          CONNECTED,
          async ({ page }) => {
            await stubConnectedHome(page)
            await page.goto(orgUrl('/home'))
            const schedule = page.getByRole('region', { name: 'Calendar schedule' })
            const cards = schedule.locator('article')
            await expect(cards.first()).toBeVisible()
            const overflow = schedule.getByRole('button', { name: /^\d+ more meetings$/ })
            await expect(overflow).toHaveCount(1)

            const drawn = await schedule
              .locator('article, button[aria-label$="more meetings"]')
              .evaluateAll((elements) =>
                elements.map((element) => {
                  const { left, right, top, bottom } = element.getBoundingClientRect()
                  return {
                    name: element.textContent ?? '',
                    left,
                    right,
                    top,
                    bottom,
                    clippedBy: element.scrollHeight - element.clientHeight,
                  }
                })
              )
            const touching = drawn.flatMap((first, index) =>
              drawn
                .slice(index + 1)
                .filter(
                  (second) =>
                    first.left < second.right + 2 &&
                    second.left < first.right + 2 &&
                    first.top < second.bottom + 2 &&
                    second.top < first.bottom + 2
                )
                .map((second) => `${first.name} / ${second.name}`)
            )
            assert.deepEqual(touching, [])
            assert.deepEqual(
              drawn.filter((card) => card.clippedBy > 1).map((card) => card.name),
              []
            )

            const shown = await cards.allInnerTexts()
            await overflow.focus()
            await page.keyboard.press('Enter')
            const offered = await page.getByRole('menuitem').allInnerTexts()
            assert.ok(offered.length > 0, 'the overflow opens from the keyboard')
            for (const title of FOUR_WAY_MEETINGS) {
              const reached = [...shown, ...offered].filter((text) => text.includes(title))
              assert.equal(reached.length, 1, `${title} is reachable exactly once`)
            }
            await page.keyboard.press('Escape')

            await schedule.evaluate((element) => {
              const first = element.querySelector('article')
              if (first instanceof HTMLElement) element.scrollTop = first.offsetTop
            })
            await homeRegion(page, 'Calendar').screenshot({
              path: resolve(artifactDirectory, `calendar__${viewport.name}__${theme}.png`),
              animations: 'disabled',
            })
          },
          { viewport, theme }
        )
      })
    }
  }
  await check('a run of day clicks reads the provider once, for the day it stops on', async () => {
    await withSession(CONNECTED, async (session) => {
      const { page } = session
      await stubConnectedHome(page)
      await page.goto(orgUrl('/home'))
      const calendar = homeRegion(page, 'Calendar')
      const standup = calendar.getByText(/^Standup /)
      await expect(standup).toBeVisible()
      await session.settle()
      session.requests.length = 0
      const next = calendar.getByRole('button', { name: 'Next day', exact: true })
      for (let click = 0; click < 4; click++)
        await next.evaluate((button: HTMLElement) => button.click())
      await expect(page).toHaveURL((address) => address.searchParams.has('day'))
      await expect(standup).toBeVisible()
      await session.settle()
      const day = new URL(page.url()).searchParams.get('day')
      await expect(standup).toHaveText(`Standup ${day}`)
      const reads = session.requests.filter(({ path }) =>
        path.includes(`/organizations/${ORGANIZATION_ID}/home/calendar`)
      )
      assert.equal(reads.length, 1, `A burst of days read ${reads.length} times`)
      assert(reads[0].path.includes(`date=${day}`), 'The read was not for the day shown')
    })
  })
  await check('a member gets no Tasks run chart rather than a broken one', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      await expect(homeRegion(page, 'Email')).toBeVisible()
      await expect(homeRegion(page, 'Tasks run')).toHaveCount(0)
    })
  })
  await check('Recents list real history and × removes it for good', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      const recents = homeRegion(page, 'Recents')
      const row = recents.getByRole('link', { name: SEEDED_SOURCE.title })
      await expect(row).toBeVisible()
      await row.hover()
      await recents
        .getByRole('button', { name: `Remove ${SEEDED_SOURCE.title} from recents` })
        .click()
      await expect(row).toHaveCount(0)
      await page.reload()
      await expect(homeRegion(page, 'Email')).toBeVisible()
      await expect(recents.getByRole('link', { name: SEEDED_SOURCE.title })).toHaveCount(0)
    })
  })
  await check('Unread chats need attention and open under Search', async () => {
    const { id, title } = MEMBER_CHATS.unread
    await withSession(MEMBER, async ({ page }) => {
      await sql`update copilot_chats set last_seen_at = null where id = ${id}`
      await page.goto(orgUrl('/home'))
      const row = homeRegion(page, 'Needs your attention').getByRole('link', { name: title })
      await expect(row).toHaveAttribute('href', `${root}/search/chat/${id}`)
      await row.click()
      await expect(page).toHaveURL((address) => address.pathname === `${root}/search/chat/${id}`)
    })
  })
  await check('Get started keeps its steps, with Integrations for a member', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      const started = homeRegion(page, 'Get started')
      await expect(started.getByRole('link', { name: /Connect an integration/ })).toHaveAttribute(
        'href',
        `${root}/integrations`
      )
      await expect(started.getByRole('link', { name: /Sim Search MCP/ })).toBeVisible()
    })
  })
  await check('Customize Home hides a widget, and Undo brings it back', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      await page.getByRole('button', { name: 'Customize Home' }).click()
      await page.getByRole('menuitemcheckbox', { name: 'Email' }).click()
      await page.keyboard.press('Escape')
      await expect(homeRegion(page, 'Email')).toHaveCount(0)
      await page.getByRole('button', { name: 'Undo' }).click()
      await expect(homeRegion(page, 'Email')).toBeVisible()
    })
  })
  await check(
    "Workspaces lists only the member's workspaces, Review then Running, and opens like the rail",
    async () => {
      await withWorkspaceActivity(async () => {
        await withSession(MEMBER, async ({ page }) => {
          const reads: string[] = []
          page.on('request', (request) => {
            const { pathname } = new URL(request.url())
            if (pathname.includes('workspace-activity')) reads.push(pathname)
          })
          const answered = page.waitForResponse(/\/home\/workspace-activity$/)
          await page.goto(orgUrl('/home'))
          const body = await (await answered).text()
          assert(!body.includes(WORKSPACES[4].id), 'Another workspace reached the member')
          const rows = homeRegion(page, 'Workspaces').getByRole('link')
          await expect(rows).toHaveText([
            new RegExp(`${MEMBER_WRITE_WORKSPACE.name}.*Renewal approval.*Review`),
            new RegExp(`${MEMBER_ADMIN_WORKSPACE.name}.*Invoice sync.*Running`),
          ])
          await expect(homeRegion(page, 'Workspaces').getByText('Up to date')).toHaveCount(0)
          assert.deepEqual(
            reads,
            [`/api/organizations/${ORGANIZATION_ID}/home/workspace-activity`],
            'Home read workspace activity more than once'
          )
          await rows.nth(1).click()
          await expect(page).toHaveURL(
            (address) => address.pathname.startsWith(`/workspace/${MEMBER_ADMIN_WORKSPACE.id}`),
            { timeout: 45_000 }
          )
        })
      })
    }
  )
  await check('a workspace with an old run says when, and claims no status', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.route(/\/home\/workspace-activity$/, (route) =>
        route.fulfill({
          json: {
            workspaces: [
              {
                workspaceId: MEMBER_ADMIN_WORKSPACE.id,
                status: null,
                statusWorkflowName: null,
                lastRun: {
                  workflowName: 'Invoice sync',
                  startedAt: new Date(Date.now() - 2.5 * 60 * 60_000).toISOString(),
                  failed: true,
                },
              },
              {
                workspaceId: MEMBER_WRITE_WORKSPACE.id,
                status: null,
                statusWorkflowName: null,
                lastRun: null,
              },
            ],
          },
        })
      )
      await page.goto(orgUrl('/home'))
      const region = homeRegion(page, 'Workspaces')
      await expect(region.getByText('Last run failed: Invoice sync')).toBeVisible()
      await expect(region.getByText('2hrs ago')).toBeVisible()
      await expect(region.getByText('No recent workflow runs')).toBeVisible()
    })
  })
  await check(
    'Workspaces holds its rows while its read is out, and keeps them if it fails',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        const release = createDeferred<void>()
        let fail = true
        await page.route(/\/home\/workspace-activity$/, async (route) => {
          await release.promise
          if (fail) await route.fulfill({ status: 500, json: { error: 'stand-in' } })
          else await route.fallback()
        })
        await page.goto(orgUrl('/home'))
        const region = homeRegion(page, 'Workspaces')
        await expect(region.getByRole('status', { name: 'Loading workspaces' })).toBeVisible()
        await expect(
          region.getByRole('status', { name: 'Loading workspaces' }).locator('> span')
        ).toHaveCount(2)
        release.resolve()
        await expect(
          region.getByText('What these workspaces are doing could not load.')
        ).toBeVisible({ timeout: 30_000 })
        await expect(region.getByRole('link', { name: MEMBER_ADMIN_WORKSPACE.name })).toBeVisible()
        fail = false
        await region.getByRole('button', { name: 'Try again' }).click()
        await expect(
          region.getByText('What these workspaces are doing could not load.')
        ).toHaveCount(0, { timeout: 30_000 })
      })
    },
    { allow: [/500 GET .*workspace-activity/] }
  )
  await check('Customize Home hides Workspaces across a reload, and stops its read', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      await expect(homeRegion(page, 'Workspaces')).toBeVisible()
      await page.getByRole('button', { name: 'Customize Home' }).click()
      await page.getByRole('menuitemcheckbox', { name: 'Workspaces' }).click()
      await page.keyboard.press('Escape')
      await expect(homeRegion(page, 'Workspaces')).toHaveCount(0)
      const reads: string[] = []
      page.on('request', (request) => {
        if (request.url().includes('/home/workspace-activity')) reads.push(request.url())
      })
      await page.reload()
      await expect(composer(page)).toBeVisible()
      await expect(homeRegion(page, 'Workspaces')).toHaveCount(0)
      assert.deepEqual(reads, [], 'A hidden widget still read its activity')
      await page.getByRole('button', { name: 'Customize Home' }).click()
      await page.getByRole('menuitemcheckbox', { name: 'Workspaces' }).click()
      await page.keyboard.press('Escape')
      await expect(homeRegion(page, 'Workspaces')).toBeVisible()
    })
  })
  await check('widget reads refuse another organization', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      const response = await page.request.get(
        url(`/api/organizations/${OUTSIDE_ORGANIZATION_ID}/home/email`)
      )
      assert.equal(response.status(), 404)
    })
  })

  section('3 Home: narrow group')
  await check('A narrow group has Home with no dead Connect button', async () => {
    await withSession(NARROW, async ({ page, context }) => {
      await context.route('https://accounts.google.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: 'Google stand-in' })
      )
      for (const [title, provider] of [
        ['Email', 'Gmail'],
        ['Calendar', 'Google Calendar'],
      ]) {
        await page.goto(orgUrl('/home'))
        const connect = homeRegion(page, title).getByRole('button', {
          name: provider,
          exact: true,
        })
        await expect(connect).toBeEnabled()
        const authorization = context.waitForEvent('request', (request) =>
          request.url().startsWith('https://accounts.google.com/')
        )
        await connect.click()
        await authorization
      }
    })
  })

  await check(
    'A member with no workspaces sees no Workspaces section and reads nothing',
    async () => {
      await withSession(NARROW, async ({ page }) => {
        const reads: string[] = []
        page.on('request', (request) => {
          if (request.url().includes('/home/workspace-activity')) reads.push(request.url())
        })
        await page.goto(orgUrl('/home'))
        await expect(sidebar(page).getByText('No workspaces yet')).toBeVisible()
        await expect(homeRegion(page, 'Workspaces')).toHaveCount(0)
        await page.getByRole('button', { name: 'Customize Home' }).click()
        await expect(page.getByRole('menuitemcheckbox', { name: 'Email' })).toBeVisible()
        await expect(page.getByRole('menuitemcheckbox', { name: 'Workspaces' })).toHaveCount(0)
        assert.deepEqual(reads, [], 'A member with no workspaces read workspace activity')
      })
    }
  )
  section('3 Home: admin')
  await check('the chart reads the window it shows, and going back reads nothing', async () => {
    await withSession(ADMIN, async (session) => {
      const { page } = session
      await page.goto(orgUrl('/home'))
      const chart = homeRegion(page, 'Tasks run')
      await expect(chart.locator('[data-plot="home-activity"]')).toBeVisible()
      await session.settle()
      const reads = () =>
        session.requests
          .map(({ path }) => path)
          .filter((path) => path.includes('/usage/activity/summary'))
      const days = (path: string) => {
        const query = new URL(path, origin).searchParams
        return (
          (Date.parse(String(query.get('endDate'))) - Date.parse(String(query.get('startDate')))) /
            86_400_000 +
          1
        )
      }
      assert.deepEqual(reads().map(days), [7], 'Home did not read the default window alone')
      const choose = async (from: string, to: string) => {
        await chart.getByRole('button', { name: `Range: ${from}` }).click()
        await page.getByRole('menuitemradio', { name: to }).click()
        await expect(chart.getByRole('button', { name: `Range: ${to}` })).toBeVisible()
        await expect(chart.locator('[data-plot="home-activity"]')).toBeVisible()
        await session.settle()
      }
      await choose('Last 7 days', 'Last 30 days')
      assert.deepEqual(reads().map(days), [7, 30], 'A wider range was not read once')
      await choose('Last 30 days', 'Last 7 days')
      assert.deepEqual(reads().map(days), [7, 30], 'A narrower range read again')
    })
  })
  await check('an admin pages through Workspaces the way the rail does', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      const region = homeRegion(page, 'Workspaces')
      await expect(region.getByRole('link')).toHaveCount(5)
      await region.getByRole('button', { name: 'See more' }).click()
      await expect.poll(() => region.getByRole('link').count()).toBeGreaterThan(5)
      await region.getByRole('button', { name: 'See less' }).click()
      await expect(region.getByRole('link')).toHaveCount(5)
    })
  })
  await check('the workspace activity read refuses another organization', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      const response = await page.request.get(
        url(`/api/organizations/${OUTSIDE_ORGANIZATION_ID}/home/workspace-activity`)
      )
      assert.equal(response.status(), 404)
    })
  })
  await check(
    'the agent composer with its tools and the Tasks run chart, without Suggested actions',
    async () => {
      await withSession(ADMIN, async ({ page }) => {
        await page.goto(orgUrl('/home'))
        await expect(page).toHaveURL(orgUrl('/home'))
        await expect(page.getByRole('heading', { level: 1 })).toContainText(', Ada')
        await expect(composer(page)).toBeVisible()
        await expect(composer(page).locator('xpath=ancestor::*[@data-platform-ui]')).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Add resources' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Attach file' })).toBeVisible()
        await expect(page.getByRole('button', { name: /Skills/ }).first()).toBeVisible()
        await expect(page.getByText('Suggested actions', { exact: true })).toHaveCount(0)
        await expect(homeRegion(page, 'Tasks run')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
      })
    }
  )
  await check('an agent turn streams, keeps its route, and Stop ends it', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      await composer(page).fill('Count slowly from 1 to 50, one number per line.')
      const posted = page.waitForRequest(
        (request) => request.method() === 'POST' && request.url().endsWith('/api/mothership/chat')
      )
      await composer(page).press('Enter')
      const body = (await posted).postDataJSON()
      assert.equal(body.mode ?? 'agent', 'agent')
      await expect(page).toHaveURL(/\/chat\/[^/?]+/, { timeout: 30_000 })
      const stop = page.getByRole('button', { name: 'Stop generation' })
      await expect(stop).toBeVisible()
      await stop.click()
      await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({
        timeout: 30_000,
      })
    })
  })
  await check(
    'Assistant hides the resource toggle until a resource; a builder always has it',
    async () => {
      const toggle = (page: Page, action: 'Expand' | 'Collapse') =>
        page.getByRole('button', { name: `${action} resource view`, exact: true })
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl('/home'))
        await expect(composer(page)).toBeVisible()
        await expect(page.getByRole('button', { name: /resource view/ })).toHaveCount(0)
      })
      await withSession(ADMIN, async ({ page }) => {
        await stubSearch(page)
        await page.goto(orgUrl(`/chat/${ADMIN_CHATS.agent.id}`))
        await expect(composer(page)).toBeVisible()
        await page.goto(orgUrl('/home'))
        await expect(composer(page)).toBeVisible()
        await expect(toggle(page, 'Expand')).toHaveCount(0)
        await page.goBack()
        await toggle(page, 'Expand').click()
        await expect(
          page.getByRole('button', { name: 'Add resource tab', exact: true })
        ).toBeVisible()
        await toggle(page, 'Collapse').click()
        const resource = encodeURIComponent(`search:organization:${ORGANIZATION_ID}`)
        await page.goto(orgUrl(`/home?q=parts&resource=${resource}`))
        await toggle(page, 'Collapse').click()
        await toggle(page, 'Expand').click()
        await expect(toggle(page, 'Collapse')).toBeVisible()
      })
    }
  )
  await check("on a phone a builder's empty chat keeps the toggle in its own row", async () => {
    await withSession(
      ADMIN,
      async ({ page }) => {
        const anyToggle = page.getByRole('button', { name: /resource view/ })
        await page.goto(orgUrl(`/chat/${ADMIN_CHATS.agent.id}`))
        await expect(composer(page)).toBeVisible()
        await expect(anyToggle).toBeVisible()
        const firstMessage = page.getByText(/^About /).first()
        await expect(firstMessage).toBeVisible()
        const toggleBox = await anyToggle.boundingBox()
        const messageBox = await firstMessage.boundingBox()
        assert(toggleBox && messageBox, 'The toggle and the first message are both laid out')
        assert(
          messageBox.y >= toggleBox.y + toggleBox.height,
          "The transcript starts below the toggle's row"
        )
      },
      { viewport: PHONE }
    )
    await withSession(
      MEMBER,
      async ({ page }) => {
        await page.goto(orgUrl('/home'))
        await expect(composer(page)).toBeVisible()
        await expect(page.getByRole('button', { name: /resource view/ })).toHaveCount(0)
      },
      { viewport: PHONE }
    )
  })
  await check('a /skill or @mention sent before its list lands waits for the list', async () => {
    await withSession(ADMIN, async ({ page }) => {
      let releaseSkills = () => {}
      const skillsHeld = new Promise<void>((resolve) => {
        releaseSkills = resolve
      })
      await page.route(/\/api\/skills/, async (route) => {
        await skillsHeld
        await route.continue()
      })
      const sends: string[] = []
      page.on('request', (request) => {
        if (request.method() === 'POST' && request.url().endsWith('/api/mothership/chat')) {
          sends.push(request.url())
        }
      })
      await page.goto(orgUrl('/home'))
      await composer(page).fill('/review this')
      await composer(page).press('Enter')
      await expect(composer(page).locator('xpath=ancestor::*[@aria-busy="true"]')).toHaveCount(1)
      await expect(composer(page)).toBeEditable()
      await expect(composer(page).locator('xpath=ancestor::*[@inert]')).toHaveCount(0)
      await page.waitForTimeout(500)
      assert.deepEqual(sends, [], 'The message waits for the skill lists')
      releaseSkills()
      await expect.poll(() => sends.length, { timeout: 30_000 }).toBeGreaterThan(0)
    })
    await withSession(ADMIN, async ({ page }) => {
      let releaseLists = () => {}
      const listsHeld = new Promise<void>((resolve) => {
        releaseLists = resolve
      })
      await page.route(/\/api\/(workflows|table|knowledge)/, async (route) => {
        await listsHeld
        await route.continue()
      })
      await page.goto(orgUrl('/home'))
      await composer(page).click()
      await composer(page).pressSequentially('@op')
      const loading = page.getByText('Loading resources', { exact: true })
      await expect(loading).toBeVisible()
      // The open `@` menu is modal, which hides the field from role queries while it keeps focus.
      const field = page.locator('textarea[aria-label="Ask Sim"]')
      await expect(field).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(field).toHaveValue('@op')
      await expect(loading).toBeVisible()
      await page.keyboard.type('e')
      await expect(field).toHaveValue('@ope')
      releaseLists()
      await expect(loading).toHaveCount(0)
      await page.keyboard.press('Enter')
      await expect(field).toHaveValue(/Operations/)
    })
  })
  await check('the handoff search params restore a results tab on Home', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await stubSearch(page)
      await page.goto(orgUrl('/home?q=parts'))
      await expect(composer(page)).toBeVisible()
      await expect(page.getByText('Service bulletin', { exact: true }).first()).toBeVisible()
    })
  })
  notProvable('Plan chip', 'Only for platform superusers, which needs a platform admin fixture')
  notProvable('Mic with permission help', 'Headless Chromium exposes no speech recognition to test')
}

async function chatChecks() {
  section('3 Chat')
  await check("Share and the feedback form on a chat are the design system's dialogs", async () => {
    const inSurface = (dialogLocator: ReturnType<typeof dialog>) =>
      expect(dialogLocator.locator('xpath=ancestor::*[@data-platform-ui]')).not.toHaveCount(0)
    const fileId = '6f1f4a52-8e0b-4d7a-9a13-0d5d3c1b7e21'
    await sql`insert into workspace_files (id, key, user_id, workspace_id, context, original_name, content_type, size_bytes)
      values (${fileId}, ${`workspace/${fileId}.md`}, ${ADMIN.userId}, ${MEMBER_ADMIN_WORKSPACE.id}, 'workspace', 'share-check.md', 'text/markdown', 1)`
    await sql`update copilot_chats
      set resources = ${sql.json([
        {
          type: 'file',
          id: fileId,
          title: 'share-check.md',
          workspaceId: MEMBER_ADMIN_WORKSPACE.id,
        },
      ])}
      where id = ${ADMIN_CHATS.agent.id}`
    try {
      await withSession(ADMIN, async ({ page }) => {
        await page.route('**/api/files/serve/**', (route) =>
          route.fulfill({ body: '# Share check' })
        )
        await page.goto(orgUrl(`/chat/${ADMIN_CHATS.agent.id}?resource=${fileId}`))
        await page.getByRole('button', { name: 'Share file', exact: true }).click()
        const share = dialog(page, 'Share share-check.md')
        await inSurface(share)
        await expect(share.getByRole('group', { name: 'File access' })).toBeVisible()
        await share.getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(share).toHaveCount(0)
        await page.getByRole('button', { name: 'Rate response', exact: true }).click()
        await menuEntry(page, 'Bad response').click()
        const feedback = dialog(page, 'Share feedback')
        await inSurface(feedback)
        await expect(feedback.getByRole('textbox', { name: 'Details' })).toHaveValue('')
        await feedback.getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(feedback).toHaveCount(0)
      })
    } finally {
      await sql`update copilot_chats set resources = '[]'::jsonb where id = ${ADMIN_CHATS.agent.id}`
      await sql`delete from workspace_files where id = ${fileId}`
    }
  })
  await check(
    'assistant conversation under Search: switch, New chat, follow-up composer',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl(`/search/chat/${MEMBER_CHATS.assistant.id}`))
        const views = page.getByRole('navigation', { name: 'Search views' })
        await expect(views.getByRole('button', { name: 'Assistant', exact: true })).toHaveAttribute(
          'aria-current',
          'page'
        )
        await expect(page.getByRole('button', { name: 'New chat', exact: true })).toBeVisible()
        await expect(composer(page)).toHaveAttribute('placeholder', 'Ask a follow-up')
        await expect(
          page
            .getByRole('button', { name: 'Attach image' })
            .or(page.getByRole('button', { name: 'Add resources' }))
        ).toBeHidden()
        await page.getByRole('button', { name: 'New chat', exact: true }).click()
        await expect(page).toHaveURL(orgUrl('/search?mode=assistant'))
      })
    }
  )
  await check(
    'a stream survives switching to the Search view: Assistant stays mounted, inert',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl('/search?mode=assistant'))
        await composer(page).fill('Count slowly from 1 to 50, one number per line.')
        await composer(page).press('Enter')
        await expect(page).toHaveURL(/\/search\/chat\/[^/?]+/, { timeout: 30_000 })
        const stop = page.getByRole('button', { name: 'Stop generation' })
        await expect(stop).toBeVisible()
        const views = page.getByRole('navigation', { name: 'Search views' })
        await views.getByRole('button', { name: 'Search', exact: true }).click()
        await expect(page).toHaveURL((address) => address.searchParams.get('mode') === 'search')
        await expect(searchField(page)).toBeVisible()
        await expect(
          page.locator('[inert]').getByRole('textbox', { name: 'Ask Sim', includeHidden: true })
        ).toHaveCount(1)
        await sleep(2_500)
        await views.getByRole('button', { name: 'Assistant', exact: true }).click()
        await expect(stop).toBeVisible()
        await expect(page.getByText(/(^|\s)4(\s|$)/).first()).toBeVisible()
        await stop.click()
        await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({
          timeout: 30_000,
        })
      })
    }
  )
  await check('a message during a turn queues; up arrow recalls the tail', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/search?mode=assistant'))
      await composer(page).fill('Count slowly from 1 to 50, one number per line.')
      await composer(page).press('Enter')
      await expect(page.getByRole('button', { name: 'Stop generation' })).toBeVisible({
        timeout: 30_000,
      })
      await composer(page).fill('And then say done.')
      await composer(page).press('Enter')
      await expect(page.getByText('And then say done.')).toBeVisible()
      await expect(composer(page)).toHaveValue('')
      await composer(page).press('ArrowUp')
      await expect(composer(page)).toHaveValue('And then say done.')
      await page.getByRole('button', { name: 'Stop generation' }).click()
    })
  })
  notProvable('Assistant action approval review cards', 'Covered by the assistant-actions suite')
  notProvable(
    'Citations, Sources panel, feedback',
    'Covered by organization-search, unchanged code'
  )
}

const searchResult = (query: string) => ({
  success: true,
  data: {
    query,
    retrieval: { status: 'complete', timedOutLegs: [] },
    results: [
      {
        documentId: 'bulletin-1',
        knowledgeBaseId: 'kb-1',
        knowledgeBaseName: 'Google Drive',
        documentName: 'Service bulletin',
        sourceUrl: NAMED_LINKS.handbook.url,
        connectorType: 'google_drive',
        sourceModifiedAt: new Date().toISOString(),
        author: 'Grace Hopper',
        content: `The bulletin about ${query} is ready.`,
        chunkIndex: 0,
        similarity: 1,
      },
      {
        documentId: 'bulletin-2',
        knowledgeBaseId: 'kb-1',
        knowledgeBaseName: 'Confluence',
        documentName: 'Recall playbook',
        sourceUrl: 'https://wiki.example.com/recall',
        connectorType: 'confluence',
        sourceModifiedAt: new Date().toISOString(),
        author: 'Grace Hopper',
        content: `The playbook about ${query}.`,
        chunkIndex: 0,
        similarity: 0.9,
      },
    ],
  },
})

async function stubSearch(page: Page) {
  await page.route('**/api/knowledge/search', async (route) => {
    const body = route.request().postDataJSON()
    await route.fulfill({ json: searchResult(body.query) })
  })
}

async function searchChecks() {
  section('3 Search: Search view')
  await check('switch, landing heading, focused field, and history', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/search'))
      const views = page.getByRole('navigation', { name: 'Search views' })
      await expect(views.getByRole('button', { name: 'Search', exact: true })).toHaveAttribute(
        'aria-current',
        'page'
      )
      await expect(views.getByRole('button', { name: 'Assistant', exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: `Search ${ORGANIZATION_NAME}` })).toBeVisible()
      await expect(searchField(page)).toBeFocused()
      const recent = page.getByRole('region', { name: 'Recent activity' })
      await expect(
        recent.getByRole('group', { name: 'History type' }).getByText('Recently viewed')
      ).toBeVisible()
      await expect(
        recent.getByRole('group', { name: 'History type' }).getByText('Recent searches')
      ).toBeVisible()
      await expect(recent.getByText(SEEDED_SOURCE.title, { exact: true })).toBeVisible()
      await recent.getByText('Recent searches').click()
      await stubSearch(page)
      await recent.getByRole('button', { name: SEEDED_SOURCE.query }).click()
      await expect(page).toHaveURL(
        (address) => address.searchParams.get('q') === SEEDED_SOURCE.query
      )
    })
  })
  await check('Back returns across a mode switch, and the mode survives a reload', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/search'))
      await expect(page).toHaveURL(orgUrl('/search?mode=search'))
      const views = page.getByRole('navigation', { name: 'Search views' })
      await views.getByRole('button', { name: 'Assistant', exact: true }).click()
      await expect(page).toHaveURL(orgUrl('/search?mode=assistant'))
      await page.goBack()
      await expect(page).toHaveURL(orgUrl('/search?mode=search'))
      await expect(searchField(page)).toBeVisible()
      await views.getByRole('button', { name: 'Assistant', exact: true }).click()
      await page.goto(orgUrl('/search'))
      await expect(page).toHaveURL(orgUrl('/search?mode=assistant'))
      await views.getByRole('button', { name: 'Search', exact: true }).click()
    })
  })
  await check('field grows on Shift+Enter, Enter submits, a query docks the field', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await stubSearch(page)
      await page.goto(orgUrl('/search?mode=search'))
      const field = searchField(page)
      await field.fill('Parts')
      const before = (await field.boundingBox())?.height ?? 0
      await field.press('Shift+Enter')
      await field.pressSequentially('recall')
      await expect
        .poll(async () => (await field.boundingBox())?.height ?? 0)
        .toBeGreaterThan(before)
      await field.press('Enter')
      await expect(page).toHaveURL(
        (address) => address.searchParams.get('q')?.includes('Parts') ?? false
      )
      await expect(page.getByRole('heading', { name: `Search ${ORGANIZATION_NAME}` })).toHaveCount(
        0
      )
      await expect(page.getByRole('button', { name: 'New search', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'New search', exact: true }).click()
      await expect(page).toHaveURL(orgUrl('/search?mode=search'))
      await expect(searchField(page)).toHaveValue('')
    })
  })
  await check('an unconnected member gets the connect prompt, not an empty result', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/search?mode=search&q=warranty'))
      await expect(
        page.getByText('No connected integrations are available for this search.')
      ).toBeVisible()
      await expect(page.getByRole('link', { name: 'Connect integrations' })).toHaveAttribute(
        'href',
        `${root}/integrations`
      )
    })
  })
  await check('results: filters, row menu, new tab link, keyboard movement', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await stubSearch(page)
      await page.goto(orgUrl('/search?mode=search&q=recall'))
      const results = page.getByRole('region', { name: 'Search results' })
      await expect(results.getByText('Service bulletin', { exact: true }).first()).toBeVisible()
      const links = page.locator('a[data-source-link]')
      await expect(links.first()).toHaveAttribute('target', '_blank')
      const filters = page.getByRole('group', { name: 'Search filters' })
      await filters.getByRole('combobox', { name: /Filter by date/ }).click()
      await page.getByRole('option', { name: 'Past week' }).click()
      await expect(page).toHaveURL((address) => address.searchParams.get('updated') === '7d')
      await filters.getByRole('combobox', { name: /Filter by source/ }).click()
      await page.keyboard.press('Escape')
      await links.first().focus()
      await page.keyboard.press('ArrowDown')
      await expect(links.nth(1)).toBeFocused()
    })
  })
  await check('Summarize moves to Assistant and sends a turn scoped to that document', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await stubSearch(page)
      await page.goto(orgUrl('/search?mode=search&q=recall'))
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
          await page.goto(orgUrl('/search?mode=search&q=recall'))
          const frame = searchField(page).locator('xpath=..')
          const row = page.getByRole('link', { name: 'Recall playbook' }).locator('xpath=../..')
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
    await withSession(
      MEMBER,
      async ({ page }) => {
        await page.goto(orgUrl('/search?mode=search'))
        await searchField(page).fill('recall')
        const button = page.getByRole('button', { name: 'Search', exact: true }).last()
        const box = await button.boundingBox()
        assert(box, 'The button is on screen')
        assert.equal(Math.round(box.height), 28)
        const hit = await button.evaluate(
          (node, { x, y }) => node === document.elementFromPoint(x, y),
          { x: box.x + box.width / 2, y: box.y - 6 }
        )
        assert(hit, 'A touch above the drawn button still lands on it')
      },
      { viewport: PHONE }
    )
  })
  await check(
    'row menu: Copy link, Copy sim/name when a link exists, Create link when not, none on failure',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await stubSearch(page)
        await page.goto(orgUrl('/search?mode=search&q=recall'))
        await page
          .getByRole('button', { name: 'Actions for Service bulletin', exact: true })
          .click()
        await expect(menuEntry(page, `Copy sim/${NAMED_LINKS.handbook.name}`)).toBeVisible()
        await menuEntry(page, 'Copy link').click()
        await expect.poll(() => clipboard(page)).toBe(NAMED_LINKS.handbook.url)
        await page
          .getByRole('button', { name: /Link copied|Actions for Service bulletin/ })
          .first()
          .click()
        await menuEntry(page, `Copy sim/${NAMED_LINKS.handbook.name}`).click()
        await expect.poll(() => clipboard(page)).toContain(`sim/${NAMED_LINKS.handbook.name}`)
        await page.getByRole('button', { name: 'Actions for Recall playbook', exact: true }).click()
        const create = menuEntry(page, 'Create link')
        await expect(create).toBeEnabled()
        await create.click()
        const form = page.getByRole('dialog').filter({ hasText: 'Destination URL' })
        await expect(form).toBeVisible()
        await expect(form.locator('xpath=ancestor::*[@data-platform-ui]')).not.toHaveCount(0)
        await expect(form.getByRole('checkbox', { name: 'Hide from the Links page' })).toBeVisible()
        await expect(form.getByRole('textbox', { name: 'Destination URL' })).toHaveValue(
          'https://wiki.example.com/recall'
        )
        await page.keyboard.press('Escape')
        await page.route(`**/api/organizations/${ORGANIZATION_ID}/sim-links?**`, (route) =>
          route.fulfill({ status: 500, json: { error: 'No' } })
        )
        await page.goto(orgUrl('/search?mode=search&q=other'))
        await page.getByRole('button', { name: 'Actions for Recall playbook', exact: true }).click()
        await expect(menuEntry(page, 'Copy link')).toBeVisible()
        await expect(menuEntry(page, 'Create link')).toHaveCount(0, { timeout: 15_000 })
      })
    },
    { allow: [/500 GET .*\/sim-links\?/] }
  )
  await check(
    'states: failure with Try again, partial coverage, no results, custom range',
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
        await page.goto(orgUrl('/search?mode=search&q=recall'))
        await expect(page.getByText('Search couldn’t run.')).toBeVisible()
        failing = false
        await page.getByRole('button', { name: 'Try again', exact: true }).click()
        await expect(page.getByText('Service bulletin', { exact: true }).first()).toBeVisible()
        partial = true
        await page.goto(orgUrl('/search?mode=search&q=partial'))
        await expect(
          page.getByText('Some integrations couldn’t be searched. Showing available results.')
        ).toBeVisible()
        partial = false
        await page.goto(orgUrl('/search?mode=search&q=nothing'))
        await expect(
          page.getByText(/Search found no results|No connected integrations/)
        ).toBeVisible()
        await page.goto(orgUrl('/search?mode=search&q=recall&updated=custom'))
        await expect(page.getByText('Choose the days to search.')).toBeVisible()
      })
    },
    { allow: [/503 POST \/api\/knowledge\/search/] }
  )
  await check(
    'history states: failure retries, Clear history empties',
    async () => {
      await withSession(ADMIN, async ({ page }) => {
        await withTableHidden('organization_search_history', async (restore) => {
          await page.goto(orgUrl('/search?mode=search'))
          await expect(page.getByText('Recent activity couldn’t load.')).toBeVisible({
            timeout: 40_000,
          })
          await restore()
          await page.getByRole('button', { name: 'Try again', exact: true }).click()
        })
        const clear = page.getByRole('button', { name: 'Clear history', exact: true })
        await expect(clear).toBeVisible()
        await clear.click()
        await expect(page.getByRole('region', { name: 'Recent activity' })).toHaveCount(0)
      })
    },
    // The read whose table the check hides.
    { allow: [refused(500, 'GET', `/api/organizations/${ORGANIZATION_ID}/search/history`)] }
  )
  await check('a query keeps its edited draft on return', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await stubSearch(page)
      await page.goto(orgUrl('/search?mode=search&q=recall'))
      await searchField(page).fill('recall edits')
      await page.goto(orgUrl('/search?mode=search&q=recall'))
      await expect(searchField(page)).toHaveValue('recall edits')
    })
  })

  section('3 Search: Assistant view')
  await check('landing heading, composer, and Get started, not in the Search view', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/search?mode=assistant'))
      await expect(page.getByRole('heading', { name: `Ask ${ORGANIZATION_NAME}` })).toBeVisible()
      await expect(composer(page)).toHaveAttribute('placeholder', 'Ask about your sources')
      await expect(page.getByText('Get started', { exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: /Connect an integration/ })).toHaveAttribute(
        'href',
        `${root}/integrations`
      )
      await page.goto(orgUrl('/search?mode=search'))
      await expect(searchField(page)).toBeVisible()
      await expect(page.getByText('Get started', { exact: true })).toHaveCount(0)
    })
  })
  await check('chat URL keeps filters and mode', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/search?mode=assistant&q=recall&source=slack&updated=7d'))
      await composer(page).fill('Filtered question')
      await composer(page).press('Enter')
      await expect(page).toHaveURL(/\/search\/chat\/[^/?]+/, { timeout: 30_000 })
      const parsed = new URL(page.url())
      assert.equal(parsed.searchParams.get('source'), 'slack')
      assert.equal(parsed.searchParams.get('updated'), '7d')
      assert.equal(parsed.searchParams.get('q'), 'recall')
    })
  })
}

async function integrationChecks() {
  section('3 Integrations')
  await check('title, search, and every approved provider, with no Microsoft row', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/integrations'))
      await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toBeVisible()
      for (const name of [
        'Gmail',
        'Google Calendar',
        'Google Drive',
        'Jira',
        'Confluence',
        'GitLab',
        'Slack',
        'Coda',
        'Lucid',
      ])
        await expect(page.getByRole('link', { name: new RegExp(`^${name}`) }).first()).toBeVisible()
      await expect(page.getByRole('link', { name: /^Outlook/ })).toHaveCount(0)
      await expect(page.getByRole('region', { name: 'Your accounts' })).toHaveCount(0)
      await expect(
        page
          .getByRole('region', { name: 'Available to connect' })
          .getByRole('link', { name: /^Gmail/ })
      ).toContainText('Not connected')
      await expect(
        page
          .getByRole('region', { name: 'Managed by your organization' })
          .getByRole('link', { name: /^GitLab/ })
      ).toContainText('Organization managed')
    })
  })
  await check(
    'search filters by name and is kept in the URL through a detail and back',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl('/integrations'))
        const field = page.getByRole('searchbox', { name: 'Search integrations' })
        await field.fill('jira')
        await expect(page).toHaveURL((address) => address.searchParams.get('q') === 'jira')
        await expect(page.getByRole('link', { name: /^Gmail/ })).toHaveCount(0)
        await page.getByRole('link', { name: /^Jira/ }).click()
        await expect(page).toHaveURL((address) => address.pathname === `${root}/integrations/jira`)
        await page
          .getByRole('navigation', { name: 'Integration navigation' })
          .getByRole('link')
          .click()
        await expect(page).toHaveURL(
          (address) =>
            address.pathname === `${root}/integrations` && address.searchParams.get('q') === 'jira'
        )
        await field.fill('zzzz-nothing')
        await expect(page.getByText('No matching integrations')).toBeVisible()
      })
    }
  )
  await check(
    'the document carries referrer no-referrer, which protects the Slack token',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        for (const path of ['/integrations', '/integrations/gmail']) {
          await page.goto(orgUrl(`${path}`))
          await expect(page.locator('meta[name="referrer"]')).toHaveAttribute(
            'content',
            'no-referrer'
          )
        }
      })
    }
  )
  await check('legacy ?integration= links reach the detail with their account', async () => {
    await withSession(CONNECTED, async ({ page }) => {
      await page.goto(orgUrl('/integrations?integration=source:gmail&q=g'))
      await expect(page).toHaveURL(
        (address) =>
          address.pathname === `${root}/integrations/gmail` && address.searchParams.get('q') === 'g'
      )
      await expect(page.getByRole('heading', { level: 1, name: 'Gmail' })).toBeVisible()
    })
  })
  await check(
    'detail: Connect starts managed authorization; a managed provider has no button',
    async () => {
      await withSession(MEMBER, async ({ page, context }) => {
        await context.route('https://accounts.google.com/**', (route) =>
          route.fulfill({ status: 200, contentType: 'text/html', body: 'Google stand-in' })
        )
        await page.goto(orgUrl('/integrations/gitlab'))
        await expect(page.getByRole('heading', { level: 1, name: 'GitLab' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'GitLab', exact: true })).toHaveCount(0)
        await page.goto(orgUrl('/integrations/gmail'))
        await expect(page.getByText('Connect your Gmail account')).toBeVisible()
        const authorization = context.waitForEvent('request', (request) =>
          request.url().startsWith('https://accounts.google.com/')
        )
        await page.getByRole('button', { name: 'Gmail', exact: true }).click()
        assert((await authorization).url().includes('client_id='))
      })
    }
  )
  await check(
    'a connected account: listed first, auto-selected, Manage has Reconnect and Disconnect',
    async () => {
      await withSession(CONNECTED, async ({ page }) => {
        await page.goto(orgUrl('/integrations'))
        await expect(
          page.getByRole('region', { name: 'Your accounts' }).getByRole('link', { name: /^Gmail/ })
        ).toContainText('1 account')
        await page
          .getByRole('region', { name: 'Your accounts' })
          .getByRole('link', { name: /^Gmail/ })
          .click()
        await expect(page.getByRole('heading', { level: 1, name: 'Gmail' })).toBeVisible()
        await expect(page.getByText(CONNECTED.email).first()).toBeVisible()
        await page.getByRole('button', { name: `Manage ${CONNECTED.email}` }).click()
        await expect(menuEntry(page, 'Reconnect account')).toBeVisible()
        await menuEntry(page, 'Disconnect account').click()
        const modal = dialog(page, 'Disconnect Gmail')
        await expect(
          modal.getByText(/Workflows using this account will also lose access/)
        ).toBeVisible()
        await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
      })
    }
  )
  await check('a stale ?account= says so', async () => {
    await withSession(CONNECTED, async ({ page }) => {
      await page.goto(orgUrl('/integrations/gmail?account=gone'))
      await expect(page.getByText('This account is no longer connected.')).toBeVisible()
    })
  })
  await check('an unknown provider says it is no longer available', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/integrations/not-a-provider'))
      await expect(page.getByText('This integration is no longer available.')).toBeVisible()
    })
  })
  await check('a connection deep link shows its request', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(
        url(
          `${root}/integrations?connectorType=gmail&provider=gmail&connectionMode=live&optionId=gmail`
        )
      )
      await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toBeVisible()
      await expect(page.getByText('Connect Gmail', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeEnabled()
    })
  })
  await check(
    'the inventory and Search reads fail separately, each with its retry',
    async () => {
      const retry = (page: Page) => page.getByRole('button', { name: /Retry|Try again/ }).first()
      await withSession(MEMBER, async ({ page }) => {
        await withTableHidden('credential_group', async (restore) => {
          await page.goto(orgUrl('/integrations'))
          await expect(page.getByText('Could not load your connections')).toBeVisible({
            timeout: 40_000,
          })
          await restore()
          await retry(page).click()
          await expect(page.getByRole('link', { name: /^Gmail/ })).toBeVisible()
        })
      })
      await withSession(MEMBER, async ({ page }) => {
        await withTableHidden('organization_search_integration', async (restore) => {
          await page.goto(orgUrl('/integrations'))
          await expect(page.getByText('Could not load Search connections')).toBeVisible({
            timeout: 40_000,
          })
          await restore()
          await retry(page).click()
          await expect(page.getByText('Could not load Search connections')).toHaveCount(0)
        })
      })
    },
    {
      // The two reads whose tables the check hides, one at a time.
      allow: [
        refused(500, 'GET', `/api/organizations/${ORGANIZATION_ID}/connected-accounts`),
        refused(500, 'GET', '/api/knowledge/sim-search/integrations'),
      ],
    }
  )

  section('3 Tool permissions')
  await check('a leftover tools filter on an account with no tools does not dead-end', async () => {
    await withSession(CONNECTED, async ({ page }) => {
      await page.route('**/connected-accounts/personal/*/tool-permissions', async (route) => {
        const response = await route.fetch()
        await route.fulfill({ response, json: { ...(await response.json()), tools: [] } })
      })
      await page.goto(orgUrl(`/integrations/accounts/${GRANTS.gmail.credentialId}?tools=x`))
      const panel = page.getByRole('region', { name: 'Tool permissions' })
      await expect(panel.getByText('No Assistant tools are available')).toBeVisible()
      await expect(panel.getByText('No matching tools')).toHaveCount(0)
    })
  })
  await check(
    'member: approval notice, Allow disabled, Ask and Block selectable, saves with revision',
    async () => {
      await withSession(CONNECTED, async ({ page }) => {
        await page.goto(orgUrl('/integrations/gmail'))
        const panel = page.getByRole('region', { name: 'Tool permissions' })
        await expect(
          panel.getByText('Your organization requires approval before tools run.')
        ).toBeVisible()
        await expect(panel.getByRole('searchbox', { name: 'Search tools' })).toBeVisible()
        await expect(panel.getByRole('heading', { name: /Read-only tools/ })).toBeVisible()
        await expect(panel.getByRole('heading', { name: /Write tools/ })).toBeVisible()
        const group = panel.getByRole('group', { name: 'Write tools permission' })
        await expect(group.getByRole('radio', { name: 'Allow', exact: true })).toBeDisabled()
        await expect(group.getByRole('radio', { name: 'Block', exact: true })).toBeEnabled()
        const saved = page.waitForRequest(
          (request) => request.method() !== 'GET' && request.url().includes('permissions')
        )
        await group.getByRole('radio', { name: 'Block', exact: true }).click({ force: true })
        const body = (await saved).postDataJSON()
        assert(
          JSON.stringify(body).includes('revision') || body.expectedRevision !== undefined,
          'The save carries a revision'
        )
        await expect(group.getByRole('radio', { name: 'Block', exact: true })).toBeChecked()
        await group.getByRole('radio', { name: 'Ask', exact: true }).click({ force: true })
      })
    }
  )
  await check('the account route still opens its permissions', async () => {
    await withSession(CONNECTED, async ({ page }) => {
      await page.goto(orgUrl(`/integrations/accounts/${GRANTS.gmail.credentialId}`))
      await expect(page.getByRole('region', { name: 'Tool permissions' })).toBeVisible()
    })
  })

  section('3 Generic Secrets')
  await check('member mode opens the personal editor and keeps q on the way back', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/integrations?q=secret'))
      const row = page
        .getByRole('main')
        .getByRole('link')
        .filter({ hasText: /Secrets/ })
      await expect(row).toContainText('Personal secrets')
      await row.click()
      await expect(page).toHaveURL(
        (address) =>
          address.pathname === `${root}/integrations/secrets` &&
          address.searchParams.get('q') === 'secret'
      )
      await page.getByRole('button', { name: 'Integrations', exact: true }).click()
      await expect(page).toHaveURL(
        (address) =>
          address.pathname === `${root}/integrations` && address.searchParams.get('q') === 'secret'
      )
    })
  })
  await check('organization mode lists a read-only view under the organization', async () => {
    await sql`update organization_secret_source set mode = 'organization' where organization_id = ${ORGANIZATION_ID}`
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/integrations?q=secret'))
      const row = page
        .getByRole('region', { name: 'Managed by your organization' })
        .getByRole('link')
        .filter({ hasText: /Secrets/ })
      await expect(row).toContainText('Organization managed')
      await row.click()
      await expect(page).toHaveURL(
        (address) => address.pathname === `${root}/integrations/generic-secrets`
      )
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Secrets')
    }).finally(
      () =>
        sql`update organization_secret_source set mode = 'member' where organization_id = ${ORGANIZATION_ID}`
    )
  })
  notProvable(
    'Slack onboarding ?slack= actions',
    'A valid token needs a Slack workspace install; invalid tokens are asserted as not found'
  )
  notProvable('Desktop OAuth listener', 'Needs the packaged desktop app')
}

async function linksChecks() {
  const linksUrl = orgUrl('/links')
  const rowFor = (page: Page, name: string) =>
    page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) })
  const search = (page: Page) => page.getByRole('searchbox', { name: 'Search links' })

  section('3 Links')
  await check('header, Chrome install, columns, and the list copes with 183 links', async () => {
    await withSession(MEMBER, async ({ page, context }) => {
      await context.route('https://chromewebstore.google.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: 'store stand-in' })
      )
      await page.goto(linksUrl)
      await expect(page.getByRole('heading', { level: 1, name: 'Links' })).toBeVisible()
      const headers = await page.getByRole('columnheader').allInnerTexts()
      for (const label of ['Name', 'Destination', 'Description', 'Created by', 'Access', 'Updated'])
        assert(
          headers.some((text) => text.includes(label)),
          `Missing column ${label}: ${headers}`
        )
      const columnWidth = async (name: string) =>
        (await page.getByRole('columnheader', { name, exact: true }).boundingBox())?.width ?? 0
      assert(
        (await columnWidth('Destination')) > 1.5 * (await columnWidth('Name')),
        'Destination takes the most room'
      )
      const store = context.waitForEvent('page')
      await page.getByRole('button', { name: 'Install Sim for Chrome' }).click()
      await expect(await store).toHaveURL(/chromewebstore\.google\.com/)
      await expect(rowFor(page, NAMED_LINKS.handbook.name)).toBeVisible()
      const pages: string[] = []
      page.on('request', (request) => {
        if (request.url().includes('/sim-links') && request.url().includes('cursor='))
          pages.push(request.url())
      })
      const scroller = page.getByRole('region', { name: 'Links' })
      for (let index = 0; index < 40 && (await rowFor(page, 'timesheet').count()) === 0; index++) {
        await scroller.evaluate((node) => {
          const target =
            [node, ...node.querySelectorAll('*')].find(
              (element) => element.scrollHeight > element.clientHeight + 20
            ) ?? node
          target.scrollTop = target.scrollHeight
        })
        await sleep(200)
      }
      await expect(rowFor(page, 'timesheet')).toBeVisible()
      assert(pages.length > 0, 'Rows past the first page load as the list scrolls')
    })
  })
  await check('a phone keeps every fact of a link, with Restricted in view', async () => {
    await withSession(
      MEMBER,
      async ({ page }) => {
        await page.goto(linksUrl)
        const row = rowFor(page, NAMED_LINKS.restricted.name)
        await expect(
          row.getByText(NAMED_LINKS.restricted.url, { exact: true }).first()
        ).toBeVisible()
        await expect(
          row.getByText(NAMED_LINKS.restricted.description, { exact: true }).first()
        ).toBeVisible()
        await expect(row.getByText(/^Restricted · /)).toBeVisible()
        const columns = await page.getByRole('columnheader').allInnerTexts()
        assert(!columns.join().includes('Created by'), `Columns ${columns}`)
        const [nameCell, list] = [
          await row.getByRole('cell').first().boundingBox(),
          await page.getByRole('region', { name: 'Links' }).boundingBox(),
        ]
        assert(nameCell && list, 'The row and the list are on screen')
        assert(
          nameCell.width > list.width / 2,
          `With 183 links windowed, Name is ${nameCell.width} of ${list.width}`
        )
      },
      { viewport: PHONE }
    )
  })
  await check('the API serves every link the member can see', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(linksUrl)
      let names: string[] = []
      let cursor: string | undefined
      do {
        const response = await page.request.get(
          url(
            `/api/organizations/${ORGANIZATION_ID}/sim-links${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`
          )
        )
        const body = await response.json()
        names = [...names, ...body.links.map((link: { name: string }) => link.name)]
        cursor = body.nextCursor ?? undefined
      } while (cursor)
      assert.equal(names.length, LINK_COUNT - 1, 'Everything but another person’s unlisted link')
      assert(!names.includes(NAMED_LINKS.unlisted.name))
    })
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(linksUrl)
      await search(page).fill(NAMED_LINKS.unlisted.name)
      await expect(rowFor(page, NAMED_LINKS.unlisted.name)).toContainText('Unlisted')
      await search(page).fill(NAMED_LINKS.restricted.name)
      await expect(rowFor(page, NAMED_LINKS.restricted.name)).toContainText('Restricted')
    })
  })
  await check(
    'search over name and description, sim/ prefix, debounce, URL, and Clear',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(linksUrl)
        await search(page).fill('sim/handbook')
        await expect(page).toHaveURL(
          (address) => address.searchParams.get('search') === 'sim/handbook'
        )
        await expect(rowFor(page, NAMED_LINKS.handbook.name)).toBeVisible()
        await expect(rowFor(page, 'resource-001')).toHaveCount(0)
        await search(page).fill('Weekly hours')
        await expect(rowFor(page, NAMED_LINKS.mostUsed.name)).toBeVisible()
        await search(page).fill('zzzz-nothing')
        await expect(page.getByText('Searched every link you can see.')).toBeVisible()
        await page.getByRole('button', { name: 'Clear search', exact: true }).last().click()
        await expect(search(page)).toHaveValue('')
        await expect(rowFor(page, NAMED_LINKS.handbook.name)).toBeVisible()
        await page.goto(`${linksUrl}?search=timesheet`)
        await expect(search(page)).toHaveValue('timesheet')
        await expect(rowFor(page, NAMED_LINKS.mostUsed.name)).toBeVisible()
      })
    }
  )
  await check(
    'sort by Opens, with direction in the URL, and clearing returns to name',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(linksUrl)
        await page.getByRole('button', { name: 'Sort', exact: true }).click()
        await expect(menuEntry(page, 'Name')).toBeVisible()
        await menuEntry(page, 'Opens').click()
        await expect(page).toHaveURL((address) => address.searchParams.get('sort') === 'popular')
        await expect(page.getByRole('button', { name: 'Sort: Opens' })).toBeVisible()
        await expect(page.getByRole('row').nth(1)).toContainText(NAMED_LINKS.mostUsed.name)
        await page.getByRole('button', { name: 'Sort: Opens' }).click()
        await menuEntry(page, 'Clear sort').click()
        await expect(page).toHaveURL((address) => address.searchParams.get('sort') === null)
      })
    }
  )
  await check(
    'row click opens sim/name in a new tab, not an editor; right click and kebab menus',
    async () => {
      await withSession(MEMBER, async ({ page, context }) => {
        await context.route(/^https:\/\/(example\.com|payroll\.example\.com)\//, (route) =>
          route.fulfill({ status: 200, contentType: 'text/html', body: 'destination stand-in' })
        )
        await page.goto(`${linksUrl}?search=handbook`)
        const row = rowFor(page, NAMED_LINKS.handbook.name)
        const popup = context.waitForEvent('page')
        await row.getByText(NAMED_LINKS.handbook.name, { exact: true }).click()
        const opened = await popup
        await opened.waitForLoadState('domcontentloaded')
        assert(/handbook/.test(opened.url()), `Opened ${opened.url()}`)
        await opened.close()
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await row.click({ button: 'right' })
        await expect(
          page.getByRole('menu', { name: 'Link actions' }).getByRole('menuitem')
        ).toHaveText(['Open', 'Copy link', 'Edit', 'Delete'])
        await menuEntry(page, 'Copy link').click()
        await expect.poll(() => clipboard(page)).toBe(url(`/sim/${NAMED_LINKS.handbook.name}`))
        await expect(page.getByText('Link copied')).toBeVisible()
        await row.getByRole('button', { name: `${NAMED_LINKS.handbook.name} actions` }).click()
        await expect(menuEntry(page, 'Edit')).toBeVisible()
      })
    }
  )
  await check('a restricted link gives a member only Open and Copy link', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(`${linksUrl}?search=${NAMED_LINKS.restricted.name}`)
      await rowFor(page, NAMED_LINKS.restricted.name).click({ button: 'right' })
      await expect(
        page.getByRole('menu', { name: 'Link actions' }).getByRole('menuitem')
      ).toHaveText(['Open', 'Copy link'])
    })
  })
  await check(
    'canEdit without canManage: edits save while Access stays disabled, with why',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(`${linksUrl}?search=${NAMED_LINKS.handbook.name}`)
        await rowFor(page, NAMED_LINKS.handbook.name).click({ button: 'right' })
        await menuEntry(page, 'Edit').click()
        const modal = dialog(page, `Edit ${NAMED_LINKS.handbook.name}`)
        await expect(
          modal.getByText('Only the creator or an organization admin can change access.')
        ).toBeVisible()
        await expect(
          modal.getByRole('checkbox', { name: 'Hide from the Links page' })
        ).toBeDisabled()
        await expect(
          modal.getByRole('checkbox', { name: 'Only the creator and admins can edit' })
        ).toBeDisabled()
        await modal.getByRole('textbox', { name: 'Description' }).fill('The company handbook')
        await modal.getByRole('button', { name: 'Save', exact: true }).click()
        await expect(modal).toHaveCount(0)
        await expect(rowFor(page, NAMED_LINKS.handbook.name)).toContainText('The company handbook')
      })
    }
  )
  await check(
    'create: field order, normalized name, variable destination, conflict on Name',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(linksUrl)
        await page.getByRole('button', { name: 'New link', exact: true }).first().click()
        await expect(page).toHaveURL((address) => address.searchParams.has('create'))
        const modal = dialog(page, 'New link')
        const fields = await modal
          .getByRole('textbox')
          .evaluateAll((nodes) =>
            nodes.map(
              (node) =>
                node.getAttribute('aria-label') ??
                node.closest('label')?.textContent ??
                (node as HTMLInputElement).labels?.[0]?.textContent ??
                ''
            )
          )
        assert(fields[0]?.startsWith('Destination URL'), `Fields ${fields}`)
        assert(fields[1]?.startsWith('Name'), `Fields ${fields}`)
        assert(fields[2]?.startsWith('Description'), `Fields ${fields}`)
        await expect(modal.getByRole('textbox', { name: 'Default destination' })).toHaveCount(0)
        await modal
          .getByRole('textbox', { name: 'Destination URL' })
          .fill('https://parts.example.com/{*}')
        await expect(modal.getByRole('textbox', { name: 'Default destination' })).toBeVisible()
        await expect(modal.getByText(/Opens when no value fills/)).toBeVisible()
        await modal
          .getByRole('textbox', { name: 'Default destination' })
          .fill('https://parts.example.com')
        await modal.getByRole('textbox', { name: 'Name' }).fill('Hand Book')
        await expect(modal.getByRole('textbox', { name: 'Name' })).not.toHaveValue('Hand Book')
        await modal.getByRole('textbox', { name: 'Name' }).fill(NAMED_LINKS.handbook.name)
        await modal.getByRole('button', { name: 'Create', exact: true }).click()
        await expect(modal.getByText(/already exists/)).toBeVisible()
        await modal.getByRole('textbox', { name: 'Name' }).fill('parts-lookup')
        await expect(
          modal.getByRole('checkbox', { name: 'Hide from the Links page' })
        ).toBeEnabled()
        await modal.getByRole('button', { name: 'Create', exact: true }).click()
        await expect(modal).toHaveCount(0)
        await expect(page).toHaveURL((address) => !address.searchParams.has('create'))
        await search(page).fill('parts-lookup')
        await expect(rowFor(page, 'parts-lookup')).toBeVisible()
        const opened = await page.request.get(url('/sim/parts-lookup/123'), { maxRedirects: 0 })
        assert.equal(opened.headers().location, 'https://parts.example.com/123')
      })
    },
    { allow: [/409 POST .*\/sim-links/] }
  )
  await check('?create= prefills the name, and an unknown sim/ link offers it', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(`${linksUrl}?create=brand-new`)
      const modal = dialog(page, 'New link')
      await expect(modal.getByRole('textbox', { name: 'Name' })).toHaveValue('brand-new')
      await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(page).toHaveURL((address) => !address.searchParams.has('create'))
      await page.goto(url('/sim/brand-new'))
      await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
      await expect(page.locator(`a[href*="links?create=brand-new"]`).first()).toBeVisible()
    })
  })
  await check(
    'a validation problem shows on its field, and the modal holds while saving',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(`${linksUrl}?create=held-link`)
        const modal = dialog(page, 'New link')
        await modal.getByRole('button', { name: 'Create', exact: true }).click()
        await expect(modal.getByRole('textbox', { name: 'Destination URL' })).toHaveAttribute(
          'aria-invalid',
          'true'
        )
        await modal
          .getByRole('textbox', { name: 'Destination URL' })
          .fill('https://held.example.com')
        const release = createDeferred<void>()
        await page.route(`**/api/organizations/${ORGANIZATION_ID}/sim-links`, async (route) => {
          await release.promise
          await route.continue()
        })
        await modal.getByRole('button', { name: 'Create', exact: true }).click()
        await page.keyboard.press('Escape')
        await sleep(300)
        await expect(modal).toBeVisible()
        release.resolve()
        await expect(modal).toHaveCount(0)
      })
    }
  )
  await check(
    'the creator manages Access; delete warns everyone and stops the link working',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(`${linksUrl}?search=${NAMED_LINKS.mostUsed.name}`)
        await rowFor(page, NAMED_LINKS.mostUsed.name).click({ button: 'right' })
        await menuEntry(page, 'Edit').click()
        const editor = dialog(page, `Edit ${NAMED_LINKS.mostUsed.name}`)
        await expect(
          editor.getByRole('checkbox', { name: 'Hide from the Links page' })
        ).toBeEnabled()
        await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
        await page.goto(`${linksUrl}?search=parts-lookup`)
        await rowFor(page, 'parts-lookup').click({ button: 'right' })
        await menuEntry(page, 'Delete').click()
        const modal = dialog(page, 'Delete link')
        await expect(
          modal.getByText('parts-lookup will stop working for everyone in your organization.')
        ).toBeVisible()
        await modal.getByRole('button', { name: 'Delete', exact: true }).click()
        await expect(modal).toHaveCount(0)
        await expect(rowFor(page, 'parts-lookup')).toHaveCount(0)
      })
    }
  )
  await check(
    'loading, failure with Retry, and the empty state',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl('/home'))
        const hold = createDeferred<void>()
        await page.route(
          (address) => address.pathname === `${root}/links` && address.searchParams.has('_rsc'),
          async (route) => {
            await hold.promise
            await route.continue()
          }
        )
        await mainNav(page).getByRole('link', { name: 'Links', exact: true }).click()
        await expect(page.getByRole('status', { name: 'Loading links' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'New link', exact: true })).toBeVisible()
        hold.resolve()
        await expect(rowFor(page, NAMED_LINKS.handbook.name)).toBeVisible()
      })
      await withSession(MEMBER, async ({ page }) => {
        await withTableHidden('sim_link', async (restore) => {
          await page.goto(linksUrl)
          const retry = page.getByRole('button', { name: /Retry/ })
          await expect(retry).toBeVisible({ timeout: 40_000 })
          await restore()
          await retry.click()
          await expect(rowFor(page, NAMED_LINKS.handbook.name)).toBeVisible()
        })
      })
      await withSession(OUTSIDER, async ({ page }) => {
        await page.goto(url(`/o/${OUTSIDE_ORGANIZATION_ID}/links`))
        await expect(page.getByText('Create short links like handbook')).toBeVisible()
        await page.getByRole('button', { name: 'New link', exact: true }).last().click()
        await expect(dialog(page, 'New link')).toBeVisible()
      })
    },
    // The read whose table the check hides.
    { allow: [refused(500, 'GET', `/api/organizations/${ORGANIZATION_ID}/sim-links`)] }
  )
  await check('the phone keeps Links usable', async () => {
    await withSession(
      MEMBER,
      async ({ page }) => {
        await page.goto(linksUrl)
        await expect(rowFor(page, NAMED_LINKS.handbook.name)).toBeVisible()
        await assertNoHorizontalOverflow(page, 'Links at 390px')
        await page.getByRole('button', { name: 'New link', exact: true }).first().tap()
        await expect(dialog(page, 'New link')).toBeVisible()
      },
      { viewport: PHONE }
    )
  })
}

const MEMBER_SETTINGS = ['General', 'Members', 'Recently deleted', 'Requests', 'Search MCP']
const ADMIN_SETTINGS = [
  'General',
  'Subscription',
  'Members',
  'Credential groups',
  'Insights',
  'White-labeling',
  'Recently deleted',
  'Requests',
  'Audit logs',
  'Permission groups',
  'Single sign-on',
  'Security',
  'Data retention',
  'Data drains',
  'Sources',
  'Search MCP',
  'Sim Search in Slack',
]

async function settingsChecks() {
  section('3 Settings')
  for (const [persona, expected] of [
    [MEMBER, MEMBER_SETTINGS],
    [ADMIN, ADMIN_SETTINGS],
  ] as const) {
    await check(`${persona.key}: the same sections, in order`, async () => {
      await withSession(persona, async ({ page }) => {
        await page.goto(orgUrl('/settings/general'))
        await expect(
          sidebar(page).getByRole('navigation', { name: 'Settings' }).getByRole('link')
        ).toHaveText([...expected])
      })
    })
  }
  await check('the settings frame: breadcrumb and a section on the design', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/settings/general'))
      await expect(page.getByRole('banner', { name: 'Settings location' })).toContainText('General')
      await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Reset password', exact: true })).toBeVisible()
      await expect(sidebar(page).locator('[data-platform-ui]').first()).toBeVisible()
      await expect(
        page.locator('[data-platform-ui]').getByRole('heading', { name: 'General', exact: true })
      ).toBeVisible()
    })
  })
  await check('Sources, Credential groups and Slack render inside the surface', async () => {
    await withSession(ADMIN, async ({ page }) => {
      for (const [path, title] of [
        ['/settings/integrations', 'Sources'],
        ['/settings/connected-accounts', 'Credential groups'],
        ['/settings/search-slack', 'Sim Search in Slack'],
      ] as const) {
        await page.goto(orgUrl(path))
        await expect(page.getByRole('banner', { name: 'Settings location' })).toContainText(title)
        await expect(
          page
            .locator('[data-platform-ui]')
            .getByRole('heading', { level: 1, name: title, exact: true })
        ).toBeVisible()
        // A second copy may exist for a moment while the document streams; one must not stay.
        await expect(page.getByLabel('Settings location')).toHaveCount(1)
      }
    })
  })
  await check('Add source opens on the surface', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/settings/integrations'))
      await page.getByRole('button', { name: 'Add source', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Add source' })).toBeVisible()
    })
  })
  await check('a legacy alias opens its section under the same URL', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/settings/team'))
      await expect(page.getByRole('banner', { name: 'Settings location' })).toContainText('Members')
      await expect(page.getByPlaceholder('Search members…')).toBeVisible()
    })
  })
  await check(
    "Settings search finds sections and settings, within the viewer's gates",
    async () => {
      await withSession(ADMIN, async ({ page }) => {
        await page.goto(orgUrl('/settings/members'))
        const rail = sidebar(page)
        const field = rail.getByRole('searchbox', { name: 'Search settings' })
        await page.keyboard.press('/')
        await expect(field).toBeFocused()
        await field.fill('password')
        await rail.getByRole('link', { name: 'Reset password', exact: true }).click()
        await expect(page).toHaveURL(orgUrl('/settings/general'))
        await expect(
          page.getByRole('button', { name: 'Reset password', exact: true })
        ).toBeInViewport()
        await field.fill('scim')
        await rail.getByRole('link', { name: 'Directory provisioning', exact: true }).click()
        await expect(page).toHaveURL(orgUrl('/settings/sso?tab=provisioning'))
        await field.fill('audit')
        await expect(rail.getByRole('link', { name: 'Audit logs', exact: true })).toBeVisible()
        await field.fill('no setting is called this')
        await expect(rail.getByText('No matching settings')).toBeVisible()
      })
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl('/settings/general'))
        const rail = sidebar(page)
        await rail.getByRole('searchbox', { name: 'Search settings' }).fill('audit')
        await expect(rail.getByText('No matching settings')).toBeVisible()
      })
    }
  )
  await check(
    'Members: roster and search for a member; Leave present, Invite and seats hidden',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl('/settings/members'))
        await expect(page.getByPlaceholder('Search members…')).toBeVisible()
        await expect(page.getByText(ADMIN.email).first()).toBeVisible()
        await expect(page.getByRole('button', { name: 'Leave organization' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0)
      })
      await withSession(OWNER, async ({ page }) => {
        await page.goto(orgUrl('/settings/members'))
        await expect(page.getByRole('button', { name: 'Invite', exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Leave organization' })).toHaveCount(0)
      })
    }
  )
  await check('Recently deleted restores an owned chat', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/settings/recently-deleted'))
      await expect(page.getByPlaceholder('Search deleted chats')).toBeVisible()
      await expect(page.getByText(ADMIN_CHATS.deleted.title)).toBeVisible()
      await page
        .getByRole('button', { name: /Restore/ })
        .first()
        .click()
      await expect(page.getByText(ADMIN_CHATS.deleted.title)).toHaveCount(0)
    })
  })
  await check('Requests and Search MCP render for a member', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/settings/requests'))
      await expect(page.getByText('No requests yet')).toBeVisible()
      await page.goto(orgUrl('/settings/search-mcp'))
      await expect(
        page
          .getByRole('button', { name: /Copy configuration/ })
          .or(page.getByLabel(/Server URL|Terminal command/).first())
      ).toBeVisible()
    })
  })
  await check('Back from Settings returns to the remembered page', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/links'))
      await accountChip(page).click()
      await dialog(page, 'Account menu')
        .getByRole('button', { name: 'Settings', exact: true })
        .click()
      await expect(page).toHaveURL(orgUrl('/settings/general'))
      await sidebar(page).getByRole('button', { name: 'Back to app', exact: true }).click()
      await expect(page).toHaveURL(orgUrl('/links'))
    })
  })
  await check(
    'Settings leave guard: a dirty form asks, and its own rail row does nothing',
    async () => {
      await withSession(ADMIN, async ({ page }) => {
        await page.goto(orgUrl('/settings/whitelabeling'))
        await page.getByRole('textbox', { name: 'Brand name' }).fill('Unsaved brand')
        const rail = sidebar(page)
        await rail.getByRole('link', { name: 'White-labeling', exact: true }).click()
        await expect(page.getByRole('dialog', { name: 'Unsaved changes' })).toHaveCount(0)
        await rail.getByRole('link', { name: 'Security', exact: true }).click()
        const guard = page.getByRole('dialog', { name: 'Unsaved changes' })
        await expect(guard).toBeVisible()
        await guard.getByRole('button', { name: 'Keep editing' }).click()
        await expect(page).toHaveURL((address) => address.pathname.endsWith('/whitelabeling'))
        await expect(page.getByRole('textbox', { name: 'Brand name' })).toHaveValue('Unsaved brand')
        await rail.getByRole('link', { name: 'Security', exact: true }).click()
        await page
          .getByRole('dialog', { name: 'Unsaved changes' })
          .getByRole('button', { name: 'Discard changes' })
          .click()
        await expect(page).toHaveURL((address) => address.pathname.endsWith('/security'))
      })
    }
  )
  await asPlatformAdmin(() =>
    check(
      'Admin: Enter in a ban reason does not ban, and a running ban cannot be dismissed',
      async () => {
        await withSession(ADMIN, async ({ page }) => {
          let banRequests = 0
          const held = createDeferred<void>()
          await page.route('**/api/auth/admin/ban-user', async (route) => {
            banRequests += 1
            await held.promise
            await route.fulfill({ status: 500, json: { message: 'Ban refused' } })
          })
          await page.goto(orgUrl(`/settings/admin?q=${encodeURIComponent(MEMBER.email)}`))
          await page.getByRole('button', { name: `${MEMBER.email} actions` }).click()
          await page.getByRole('menuitem', { name: 'Ban', exact: true }).click()
          const modal = dialog(page, 'Ban user')
          const reason = modal.getByRole('textbox', { name: 'Reason' })
          await reason.fill('Spam')
          await reason.press('Enter')
          await sleep(300)
          assert.equal(banRequests, 0, 'Enter in the reason submitted the ban')
          await expect(modal, 'Enter in the reason closed the dialog').toBeVisible()
          await modal.getByRole('button', { name: 'Ban', exact: true }).click()
          await expect.poll(() => banRequests).toBe(1)
          await expect(modal, 'Starting the ban closed the dialog').toBeVisible()
          await page.keyboard.press('Escape')
          await sleep(300)
          await expect(modal, 'Escape dismissed a running ban').toBeVisible()
          await expect(modal.getByRole('button', { name: 'Cancel' })).toBeDisabled()
          held.resolve()
          await expect(modal.getByText('Ban refused')).toBeVisible()
        })
      },
      { allow: [/500 POST .*ban-user/] }
    )
  )
  await check('Permission groups: Enter in Add members search adds nobody', async () => {
    // A default group governs everyone, so it has no members to add until it is not the default.
    await sql`update permission_group set is_default = false where id = ${STANDARD_GROUP_ID}`
    try {
      await withSession(ADMIN, async ({ page }) => {
        let writes = 0
        await page.route('**/permission-groups/*/members', async (route) => {
          if (route.request().method() !== 'GET') writes += 1
          await route.continue()
        })
        await page.goto(orgUrl(`/settings/access-control?group-id=${STANDARD_GROUP_ID}`))
        await page.getByRole('button', { name: 'Add', exact: true }).click()
        const modal = dialog(page, 'Add members')
        const search = modal.getByRole('searchbox')
        await search.fill('member')
        await search.press('Enter')
        await sleep(300)
        assert.equal(writes, 0, 'Enter in the search changed the group')
        await expect(modal).toBeVisible()
      })
    } finally {
      await sql`update permission_group set is_default = true where id = ${STANDARD_GROUP_ID}`
    }
  })
  await check('Usage events: Description shows at the Settings column width', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.route('**/api/organizations/*/usage/events**', (route) =>
        route.fulfill({
          json: {
            events: [
              {
                id: 'usage-event-1',
                createdAt: '2026-11-05T10:00:00.000Z',
                source: 'workflow',
                description: 'A described charge',
                workflowName: null,
                credits: 1,
                hasCost: true,
              },
            ],
            hasMore: false,
          },
        })
      )
      await page.goto(orgUrl('/settings/usage/events'))
      await expect(page.getByRole('columnheader', { name: 'Description' })).toBeVisible()
      await expect(page.getByText('A described charge')).toBeVisible()
    })
  })
  await check('Credential groups: a bad address leaves the valid one sent', async () => {
    await withSession(ADMIN, async ({ page }) => {
      const sent: string[][] = []
      await page.route('**/connected-accounts/people', async (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        const emails = toRecord(route.request().postDataJSON()).emails as string[]
        sent.push(emails)
        await route.fulfill({
          json: {
            success: true,
            sentCount: emails.length,
            results: emails.map((email) => ({ email, success: true })),
          },
        })
      })
      await page.goto(orgUrl('/settings/connected-accounts?tab=people'))
      await page.getByRole('button', { name: 'Request connections', exact: true }).click()
      const modal = dialog(page, 'Request account connections')
      const field = modal.getByRole('textbox', { name: 'Emails' })
      await field.fill('good@org-redesign.test not-an-address ')
      await modal.getByRole('button', { name: 'Send requests', exact: true }).click()
      await expect.poll(() => sent).toEqual([['good@org-redesign.test']])
      await expect(modal.getByText('not-an-address')).toBeVisible()
    })
  })
  await check(
    'Single sign-on: inline errors stop a bad Save, and a good one posts',
    async () => {
      await withSession(ADMIN, async ({ page }) => {
        const bodies: unknown[] = []
        await page.route('**/api/auth/sso/register', async (route) => {
          bodies.push(route.request().postDataJSON())
          await route.fulfill({ status: 500, json: { error: 'Stubbed: no identity provider' } })
        })
        await page.goto(orgUrl('/settings/sso'))
        const issuer = page.getByRole('textbox', { name: 'Issuer URL' })
        await issuer.fill('not a url')
        await page.getByRole('button', { name: 'Save', exact: true }).click()
        await expect(
          page.getByText(/Enter a valid issuer URL|Issuer URL must/).first()
        ).toBeVisible()
        assert.equal(bodies.length, 0, 'An invalid form reached the server')
        await page.getByRole('combobox', { name: 'Provider ID' }).click()
        await page.getByRole('combobox', { name: 'Select or enter a provider ID' }).fill('e2e-oidc')
        await page.keyboard.press('Escape')
        await issuer.fill('https://idp.org-redesign.test')
        await page.getByRole('textbox', { name: 'Domain', exact: true }).fill('org-redesign.test')
        await page.getByRole('textbox', { name: 'Client ID', exact: true }).fill('e2e-client')
        const secret = page.getByRole('textbox', { name: 'Client secret' })
        await secret.focus()
        await secret.fill('e2e-secret')
        await page.getByRole('button', { name: 'Save', exact: true }).click()
        await expect.poll(() => bodies.length).toBe(1)
        assert.equal(toRecord(bodies[0]).providerId, 'e2e-oidc')
        assert.match(JSON.stringify(bodies[0]), /e2e-secret/)
      })
    },
    { allow: [/500 POST .*sso\/register/] }
  )
  await check('Members: a role change writes, and writes back', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/settings/members'))
      const role = page.getByRole('combobox', { name: 'Role for Mia Member', exact: true })
      const set = async (name: string) => {
        const write = page.waitForResponse(
          (response) =>
            /\/api\/organizations\/[^/]+\/members\/[^/]+$/.test(pathOf(response.url())) &&
            response.request().method() !== 'GET'
        )
        await role.click()
        await page.getByRole('option', { name, exact: true }).click()
        assert.ok((await write).ok(), `Setting ${name} failed`)
        await expect(role).toContainText(name)
      }
      await set('Admin')
      await set('Member')
    })
  })
  await check('Permission groups: editing the name saves, and saves back', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl(`/settings/access-control?group-id=${STANDARD_GROUP_ID}`))
      const name = page.getByRole('textbox', { name: 'Name', exact: true })
      await expect(name).toBeVisible()
      const original = await name.inputValue()
      const save = page.getByRole('button', { name: 'Save', exact: true })
      for (const value of [`${original} edited`, original]) {
        await name.fill(value)
        const write = page.waitForResponse(
          (response) =>
            /permission-groups\/[^/]+$/.test(pathOf(response.url())) &&
            response.request().method() !== 'GET'
        )
        await save.click()
        assert.ok((await write).ok(), 'The group did not save')
      }
    })
  })
  await check(
    'Data drains: Create posts the drain',
    async () => {
      await withSession(ADMIN, async ({ page }) => {
        await page.route('**/data-drains', async (route) => {
          if (route.request().method() !== 'POST') return route.continue()
          const body = toRecord(route.request().postDataJSON())
          assert.equal(body.name, 'E2E drain')
          await route.fulfill({ status: 500, json: { error: 'Stubbed: no bucket to verify' } })
        })
        await page.goto(orgUrl('/settings/data-drains'))
        await page.getByRole('button', { name: 'Create drain', exact: true }).click()
        await page.getByRole('textbox', { name: 'Name', exact: true }).fill('E2E drain')
        await page.getByRole('textbox', { name: 'Bucket', exact: true }).fill('e2e-bucket')
        await page.getByRole('textbox', { name: 'Region', exact: true }).fill('us-east-1')
        await page.getByRole('textbox', { name: 'Access key ID', exact: true }).fill('AKIAEXAMPLE')
        await page.getByRole('textbox', { name: 'Secret access key', exact: true }).fill('example')
        const create = page.waitForRequest(
          (request) => request.method() === 'POST' && pathOf(request.url()).endsWith('/data-drains')
        )
        await page.getByRole('button', { name: 'Create', exact: true }).click()
        await create
      }).catch((error) => {
        throw error
      })
    },
    { allow: [/500 POST .*data-drains/] }
  )
  await check('Data retention: a policy edit saves, and saves back', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/settings/data-retention'))
      await page
        .getByRole('button', { name: /Organization/ })
        .first()
        .click()
      const picker = page.getByRole('combobox', { name: 'Log retention' })
      const original = (await picker.textContent())?.trim() ?? ''
      for (const name of ['5 years', original]) {
        await picker.click()
        await page.getByRole('option', { name, exact: true }).click()
        const write = page.waitForResponse(
          (response) =>
            pathOf(response.url()).endsWith('/data-retention') &&
            response.request().method() !== 'GET'
        )
        const save = page.getByRole('button', { name: 'Save', exact: true })
        await save.click()
        assert.ok((await write).ok(), 'The policy did not save')
        await expect(save).toBeDisabled()
      }
    })
  })
  await check('Insights: heatmap pinning, metric explanations, and View all', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/settings/usage'))
      await expect(page.getByText('Less', { exact: true })).toBeVisible()
      await expect(page.getByText('More', { exact: true })).toBeVisible()
      const day = page
        .getByRole('group', { name: /^Daily credit usage/ })
        .getByRole('button')
        .last()
      await day.hover()
      await expect(page.getByRole('tooltip').first()).toBeVisible()
      await expect(day).toHaveAttribute('aria-pressed', 'false')
      await day.click()
      await expect(day).toHaveAttribute('aria-pressed', 'true')
      await day.press('Escape')
      await expect(day).toHaveAttribute('aria-pressed', 'false')
      await page.getByRole('button', { name: 'About workflow runs' }).hover()
      await expect(page.getByText('Retained executions, grouped by start date.')).toBeVisible()
      await expect(
        page.getByText('Other includes cancelled, paused, and unfinished runs.')
      ).toBeVisible()
      await expect(page.getByRole('button', { name: 'View all', exact: true })).toHaveCount(2)
    })
  })
  notProvable(
    'Insights: allowance meter, legend totals, and the unattributed-workspace note',
    'The fixture seeds no usage limit, ledger credits, or unattributed workspace row'
  )
  await check(
    'Permission groups: a failed provider blacklist blocks Providers only',
    async () => {
      await withSession(ADMIN, async ({ page }) => {
        await page.route('**/api/settings/allowed-providers**', (route) =>
          route.fulfill({ status: 500, json: { error: 'unavailable' } })
        )
        const group = `/settings/access-control?group-id=${STANDARD_GROUP_ID}`
        await page.goto(orgUrl(`${group}&group-tab=providers`))
        await expect(page.getByText('unavailable', { exact: true })).toBeVisible()
        await expect(page.getByRole('region', { name: 'Providers' })).toHaveCount(0)
        await page.goto(orgUrl(`${group}&group-tab=blocks`))
        await expect(page.getByRole('region', { name: 'Core Blocks' })).toBeVisible()
      })
    },
    { allow: [/500 GET .*allowed-providers/] }
  )
  await check('Single sign-on: the client secret keeps its autofill guards', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/settings/sso'))
      const decoy = page.locator('input[name="fakepasswordremembered"]')
      await expect(decoy).toHaveJSProperty('hidden', false)
      const secret = page.getByRole('textbox', { name: 'Client secret' })
      await expect(secret).toHaveAttribute('type', 'text')
      await expect(secret).toHaveAttribute('data-masked', 'true')
      await expect(secret).toHaveJSProperty('readOnly', true)
      await secret.focus()
      await expect(secret).toHaveJSProperty('readOnly', false)
    })
  })
  await check('admin settings sections all open', async () => {
    await withSession(ADMIN, async ({ page }) => {
      for (const path of [...SETTINGS_FOR_ADMIN, 'search-mcp']) {
        const response = await page.goto(orgUrl(`/settings/${path}`))
        assert((response?.status() ?? 500) < 400, `settings/${path} ${response?.status()}`)
        await expect(sidebar(page)).toBeVisible()
        await expect(page.getByText('Page not found')).toHaveCount(0)
      }
    })
  })
}

async function blastRadiusChecks() {
  section('Blast radius')
  const workspaceHome = `/workspace/${MEMBER_ADMIN_WORKSPACE.id}/home`
  const WORKSPACE_RAIL_ROWS = ['Integrations', 'Tables', 'Files', 'Knowledge bases', 'Logs']
  await check('/workspace has no platform surface and its usual nav', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(url(workspaceHome))
      const rail = page.getByRole('complementary', { name: 'Workspace sidebar' })
      await expect(rail).toBeVisible()
      for (const label of WORKSPACE_RAIL_ROWS)
        await expect(rail.getByRole('link', { name: label, exact: true })).toBeVisible()
      await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
    })
  })
  await check(
    'client navigation from /o to /workspace leaves legacy controls unchanged',
    async () => {
      const sample = (page: Page) =>
        page.evaluate(() => {
          const props = [
            'font-family',
            'font-size',
            'font-weight',
            'line-height',
            'letter-spacing',
            'color',
            'background-color',
            'border-top-color',
            'border-top-width',
            'border-top-style',
            'border-top-left-radius',
            'padding-top',
            'padding-left',
            'height',
            'box-shadow',
            'outline-style',
          ]
          const tokens = [
            '--bg',
            '--surface-1',
            '--surface-3',
            '--text-primary',
            '--text-muted',
            '--border',
            '--font-sans',
            '--font-mono',
            '--color-border',
            '--color-accent',
            '--color-background',
            '--color-secondary',
            '--text-caption',
          ]
          const rootStyle = getComputedStyle(document.documentElement)
          const output: Record<string, string> = {}
          for (const token of tokens)
            output[`:root ${token}`] = rootStyle.getPropertyValue(token).trim()
          for (const prop of props)
            output[`body ${prop}`] = getComputedStyle(document.body).getPropertyValue(prop)
          const seen = new Map<string, number>()
          const rail = document.querySelector('[aria-label="Workspace sidebar"]')
          const controls = rail
            ? rail.querySelectorAll('a, button, input, textarea, [role="button"], h1, h2, p, span')
            : []
          for (const element of Array.from(controls).slice(0, 200)) {
            const text = (element.textContent ?? '').trim().slice(0, 24)
            const base = `${element.tagName} ${element.getAttribute('aria-label') ?? text}`
            const count = seen.get(base) ?? 0
            seen.set(base, count + 1)
            const key = `${base} #${count}`
            const style = getComputedStyle(element)
            output[key] = props.map((prop) => style.getPropertyValue(prop)).join(' | ')
          }
          return output
        })
      for (const theme of ['light', 'dark'] as const) {
        let fresh: Record<string, string> = {}
        await withSession(
          ADMIN,
          async (session) => {
            await session.page.goto(url(workspaceHome))
            await expect(
              session.page.getByRole('complementary', { name: 'Workspace sidebar' })
            ).toBeVisible()
            await session.settle()
            fresh = await sample(session.page)
          },
          { theme }
        )
        await withSession(
          ADMIN,
          async (session) => {
            const { page } = session
            for (const path of ['links', 'integrations', 'search?mode=search', 'home']) {
              await page.goto(orgUrl(`/${path}`))
              await session.settle()
            }
            await page.evaluate((href) => {
              ;(
                window as unknown as { next: { router: { push: (href: string) => void } } }
              ).next.router.push(href)
            }, workspaceHome)
            await expect(page).toHaveURL(url(workspaceHome), { timeout: 45_000 })
            await expect(
              page.getByRole('complementary', { name: 'Workspace sidebar' })
            ).toBeVisible()
            await session.settle()
            await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
            const carried = await sample(page)
            const differences = Object.keys(fresh)
              .filter((key) => key in carried && carried[key] !== fresh[key])
              .map((key) => `${key}: fresh ${fresh[key]} vs carried ${carried[key]}`)
            const comparedControls = Object.keys(fresh).filter(
              (key) => !key.startsWith(':root ') && !key.startsWith('body ') && key in carried
            )
            for (const label of WORKSPACE_RAIL_ROWS)
              assert(
                comparedControls.some((key) => key.startsWith(`A ${label} #`)),
                `The comparison never reached the ${label} row: ${comparedControls.join(', ')}`
              )
            assert.deepEqual(
              differences,
              [],
              `${differences.length} computed styles moved in ${theme}`
            )
          },
          { theme }
        )
      }
    }
  )
  await check(
    "a workspace's Credential groups link opens the organization's page",
    async () => {
      await withSession(ADMIN, async ({ page }) => {
        await page.goto(url(`/workspace/${MEMBER_ADMIN_WORKSPACE.id}/settings/connected-accounts`))
        await expect(page).toHaveURL(/\/o\/[^/]+\/settings\/connected-accounts/)
        await expect(
          page.getByRole('heading', { level: 1, name: 'Credential groups', exact: true })
        ).toBeVisible()
      })
    },
    // The workspace shell reads its inbox whatever the group's hideInboxTab says.
    { allow: [/403 GET .*\/inbox/] }
  )
  await check('the extension panel has no platform surface and reads no Home data', async () => {
    await withSession(
      MEMBER,
      async (session) => {
        const { page } = session
        // Opened outside the extension's frame, where a chrome-extension target has no meaning.
        await page.addInitScript(() => {
          const post = window.postMessage.bind(window)
          window.postMessage = ((...args: Parameters<typeof post>) => {
            if (!String(args[1]).startsWith('chrome-extension://')) post(...args)
          }) as typeof window.postMessage
        })
        const consoleErrors: string[] = []
        page.on('console', (message) => {
          if (message.type() === 'error') consoleErrors.push(message.text())
        })
        await page.goto(url(`/extension/o/${ORGANIZATION_ID}`))
        await expect(composer(page))
          .toBeVisible()
          .catch((error) => {
            throw new Error(`${getErrorMessage(error)}\nConsole: ${consoleErrors.join('\n')}`)
          })
        await session.settle()
        await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
        const home = session.requests.filter(({ path }) => /\/home\/|\/usage\/activity/.test(path))
        assert.deepEqual(home, [])
        await expect(page.getByRole('region', { name: 'Email', exact: true })).toHaveCount(0)
        await page.goto(url('/extension/create-link'))
        await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
      },
      { viewport: { name: 'panel', width: 400, height: 800 } }
    )
  })
  await check(
    '/sim, /sim-links, /invite, login and marketing have no platform surface',
    async () => {
      await withSession(MEMBER, async ({ page, context }) => {
        await context.route(/^https:\/\/example\.com\//, (route) =>
          route.fulfill({ status: 200, contentType: 'text/html', body: 'stand-in' })
        )
        for (const path of ['/sim/no-such-link', '/invite/not-a-token']) {
          await page.goto(url(path))
          await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
        }
      })
      await withSession(null, async ({ page }) => {
        for (const path of ['/login', '/', '/platform']) {
          await page.goto(url(path))
          await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
        }
      })
    },
    {
      // The three addresses this check opens that have nothing to show.
      allow: [
        refused(404, 'GET', '/sim/no-such-link'),
        refused(404, 'GET', '/invite/not-a-token'),
        refused(404, 'GET', '/platform'),
      ],
    }
  )
  await check('the surface defines its caption token without reaching :root', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      const { onRoot, onSurface } = await page.evaluate(() => {
        const read = (element: Element | null) =>
          element ? getComputedStyle(element).getPropertyValue('--text-caption').trim() : null
        return {
          onRoot: read(document.documentElement),
          onSurface: read(document.querySelector('[data-platform-ui]')),
        }
      })
      assert(onSurface, 'Home mounts the surface, which defines the token')
      assert.notEqual(onRoot, onSurface, 'The surface token reached :root')
    })
  })
}

const PREFETCHED_ON_LAYOUT = [
  { label: 'chat list', pattern: /^\/api\/mothership\/chats\?(?=.*organizationId=)/ },
  { label: 'profile', pattern: /^\/api\/users\/me\/profile/ },
  { label: 'workspace list', pattern: /^\/api\/workspaces(\?|$)/ },
]
const PREFETCHED_INVENTORY = [
  { label: 'connected accounts', pattern: /\/connected-accounts(\?|$)/ },
  { label: 'search integrations', pattern: /\/api\/knowledge\/sim-search\/integrations/ },
]
const PREFETCHED_HISTORY = [{ label: 'search history', pattern: /\/search\/history(\?|$)/ }]
const PREFETCHED_SECRET_SOURCE = [
  { label: 'secret source', pattern: /\/secrets\/source|\/secret-source/ },
]
const PREFETCHED_LINKS = [{ label: 'links first page', pattern: /\/sim-links(\?(?!.*cursor=)|$)/ }]

/** The composer's lists: about a dozen for each workspace, so they wait until someone asks. */
const PER_WORKSPACE_READ = [
  /^\/api\/skills\?/,
  /^\/api\/workflows\?/,
  /^\/api\/table\?/,
  /^\/api\/workspaces\/[^/]+\/files/,
  /^\/api\/knowledge\?/,
  /^\/api\/folders\?/,
  /^\/api\/mothership\/chats\?(?=.*workspaceId=)/,
  /^\/api\/permission-groups\/user/,
  /^\/api\/logs\?/,
]
const isPerWorkspaceRead = (path: string) => PER_WORKSPACE_READ.some((read) => read.test(path))

async function firstPaintChecks() {
  section('6 First paint')
  const pages = [
    {
      name: 'Home',
      path: 'home',
      primary: (page: Page) => composer(page),
      prefetched: [...PREFETCHED_ON_LAYOUT, ...PREFETCHED_INVENTORY, ...PREFETCHED_HISTORY],
    },
    {
      name: 'Search',
      path: 'search?mode=search',
      primary: (page: Page) => searchField(page),
      prefetched: [...PREFETCHED_ON_LAYOUT, ...PREFETCHED_HISTORY],
    },
    {
      name: 'Integrations',
      path: 'integrations',
      primary: (page: Page) => page.getByRole('link', { name: /^Gmail/ }),
      prefetched: [...PREFETCHED_ON_LAYOUT, ...PREFETCHED_INVENTORY, ...PREFETCHED_SECRET_SOURCE],
    },
    {
      name: 'Links',
      path: 'links',
      primary: (page: Page) => page.getByRole('row').nth(1),
      prefetched: [...PREFETCHED_ON_LAYOUT, ...PREFETCHED_LINKS],
    },
    {
      name: 'Links by opens',
      path: 'links?sort=popular&dir=desc',
      primary: (page: Page) => page.getByRole('row').nth(1),
      prefetched: [...PREFETCHED_ON_LAYOUT, ...PREFETCHED_LINKS],
    },
  ] satisfies {
    name: string
    path: string
    primary: (page: Page) => Locator
    prefetched: { label: string; pattern: RegExp }[]
  }[]
  await check(
    'an admin composer reads no workspace list until its menu opens, then the menu fills',
    async () => {
      await withSession(ADMIN, async (session) => {
        const { page } = session
        await page.goto(orgUrl('/home'))
        await composer(page).first().waitFor({ timeout: 30_000 })
        await session.settle()
        const reads = () =>
          session.requests.map(({ path }) => path).filter((path) => isPerWorkspaceRead(path))
        assert.deepEqual(reads(), [], 'The composer read every workspace on load')
        await page.getByRole('button', { name: 'Add resources' }).click()
        const menu = page.getByRole('menu')
        await expect(
          menu.getByRole('menuitem', { name: MEMBER_ADMIN_WORKSPACE.name })
        ).toBeVisible()
        await expect.poll(() => reads().length).toBeGreaterThan(0)
        await session.settle()
        await expect(menu.getByText('Loading resources')).toHaveCount(0)
        await menu.getByPlaceholder('Search resources').fill(MEMBER_ADMIN_WORKSPACE.name)
        await expect(
          menu.getByRole('menuitem', { name: MEMBER_ADMIN_WORKSPACE.name })
        ).toBeVisible()
      })
    }
  )
  await check('a slash in an admin composer reads skills, not the resource lists', async () => {
    await withSession(ADMIN, async (session) => {
      const { page } = session
      await page.goto(orgUrl('/home'))
      await composer(page).first().waitFor({ timeout: 30_000 })
      await session.settle()
      await composer(page).first().pressSequentially('/')
      await expect(page.getByRole('menu').getByRole('menuitem').first()).toBeVisible()
      await session.settle()
      const reads = session.requests
        .map(({ path }) => path)
        .filter((path) => isPerWorkspaceRead(path))
      assert(reads.length > 0, 'The skills were never read')
      assert.deepEqual(
        reads.filter((path) => !path.startsWith('/api/skills?')),
        [],
        'A slash read the resource lists'
      )
    })
  })
  await check(
    'Links paints its first page from the server, even with the client read refused',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        const reads: string[] = []
        await page.route(`**/api/organizations/${ORGANIZATION_ID}/sim-links**`, (route) => {
          reads.push(route.request().url())
          return route.fulfill({ status: 500, json: { error: 'The client must not need this' } })
        })
        await page.goto(orgUrl('/links'))
        await expect(
          page.getByRole('row').filter({ hasText: NAMED_LINKS.handbook.name })
        ).toBeVisible()
        await expect(page.getByRole('button', { name: /Retry/ })).toHaveCount(0)
        assert.deepEqual(
          reads.filter((address) => !address.includes('cursor=')),
          [],
          'The seeded first page was fetched again'
        )
        await page.goto(orgUrl('/links?sort=popular&dir=desc'))
        await expect(page.getByRole('row').nth(1)).toContainText(NAMED_LINKS.mostUsed.name)
        await page.goto(orgUrl(`/links?search=${NAMED_LINKS.mostUsed.name}`))
        await expect(page.getByRole('row').nth(1)).toContainText(NAMED_LINKS.mostUsed.name)
        assert.deepEqual(
          reads.filter((address) => !address.includes('cursor=')),
          [],
          'A seeded view of the URL was fetched again'
        )
      })
    },
    { allow: [/500 GET .*\/sim-links/] }
  )
  await check('the Links document already carries the first page of rows', async () => {
    await withSession(MEMBER, async ({ page, context }) => {
      await page.goto(orgUrl('/home'))
      const html = await (await context.request.get(orgUrl('/links'))).text()
      assert(html.includes(NAMED_LINKS.handbook.url), 'The document holds the seeded rows')
    })
  })
  for (const persona of [MEMBER, ADMIN]) {
    for (const entry of pages) {
      await check(
        `${persona.key} ${entry.name}: measured, no duplicate or prefetched-key fetch`,
        async () => {
          await withSession(persona, async (session) => {
            const { page } = session
            // A returning member's browser already holds the app's scripts.
            await page.goto(orgUrl(`/${entry.path}`))
            await entry.primary(page).first().waitFor({ timeout: 30_000 })
            await session.settle()
            session.requests.length = 0
            const started = performance.now()
            await page.goto(orgUrl(`/${entry.path}`), { waitUntil: 'commit' })
            await entry.primary(page).first().waitFor({ timeout: 30_000 })
            const primaryVisibleMs = Math.round(performance.now() - started)
            await session.settle()
            const paints = await page.evaluate(() =>
              Object.fromEntries(
                performance
                  .getEntriesByType('paint')
                  .map((item) => [item.name, Math.round(item.startTime)])
              )
            )
            const api = session.requests.filter(({ path }) => path.startsWith('/api/'))
            const labelled = api.map(({ method, path }) => `${method} ${path}`)
            const counts = new Map<string, number>()
            for (const label of labelled) counts.set(label, (counts.get(label) ?? 0) + 1)
            const duplicates = [...counts.entries()]
              .filter(([, count]) => count > 1)
              .map(([label, count]) => `${label} x${count}`)
            const perWorkspaceReads = labelled.filter((label) =>
              isPerWorkspaceRead(label.replace(/^\S+ /, ''))
            )
            const refetched = entry.prefetched.flatMap(({ label, pattern }) =>
              api.some(({ method, path }) => method === 'GET' && pattern.test(path)) ? [label] : []
            )
            firstPaints.push({
              persona: persona.key,
              page: entry.name,
              firstPaintMs: paints['first-paint'] ?? null,
              firstContentfulPaintMs: paints['first-contentful-paint'] ?? null,
              primaryVisibleMs,
              apiRequests: labelled,
              totalRequestCount: session.requests.length,
              duplicates,
              prefetchedAndRefetched: refetched,
              perWorkspaceReads,
            })
            assert.deepEqual(duplicates, [], 'A read was fetched twice on first paint')
            assert.deepEqual(refetched, [], 'A prefetched key was fetched again on first paint')
            assert.deepEqual(perWorkspaceReads, [], 'The composer read every workspace on load')
          })
        }
      )
    }
  }
}

const SETTINGS_FOR_ALL = ['general', 'members', 'recently-deleted', 'requests', 'search-mcp']
const SETTINGS_FOR_ADMIN = [
  'subscription',
  'connected-accounts',
  'usage',
  'whitelabeling',
  'audit-logs',
  'access-control',
  'sso',
  'security',
  'data-retention',
  'data-drains',
  'integrations',
  'search-slack',
]

const settingsRoutes = (sections: readonly string[]) =>
  sections.map((section) => ({ name: `settings-${section}`, path: `settings/${section}` }))

function routesFor(persona: Persona): { name: string; path: string }[] {
  const shared = [
    { name: 'home', path: 'home' },
    { name: 'search', path: 'search?mode=search' },
    { name: 'search-empty-query', path: 'search?mode=search&q=warranty' },
    { name: 'assistant', path: 'search?mode=assistant' },
    { name: 'integrations', path: 'integrations' },
    { name: 'integration-gmail', path: 'integrations/gmail' },
    { name: 'integration-gitlab', path: 'integrations/gitlab' },
    { name: 'generic-secrets', path: 'integrations/secrets' },
    { name: 'links', path: 'links' },
    { name: 'links-new', path: 'links?create=new-link' },
    ...settingsRoutes(SETTINGS_FOR_ALL),
  ]
  if (persona === MEMBER)
    return [...shared, { name: 'assistant-chat', path: `search/chat/${MEMBER_CHATS.assistant.id}` }]
  if (persona === ADMIN || persona === OWNER)
    return [
      ...shared,
      ...(persona === ADMIN ? [{ name: 'agent-chat', path: `chat/${ADMIN_CHATS.agent.id}` }] : []),
      ...settingsRoutes(SETTINGS_FOR_ADMIN),
    ]
  if (persona === CONNECTED)
    return [
      { name: 'home', path: 'home' },
      { name: 'integrations', path: 'integrations' },
      { name: 'integration-gmail', path: 'integrations/gmail' },
      { name: 'tool-permissions', path: `integrations/accounts/${GRANTS.gmail.credentialId}` },
    ]
  return shared
}

/** The app scrolls inside its own panes, so the viewport grows to what they hold before the shot. */
async function fullPageScreenshot(page: Page, path: string, viewport: Viewport) {
  const height = await page.evaluate(() => {
    let tallest = innerHeight
    for (const element of Array.from(document.querySelectorAll('body *'))) {
      const overflow = element.scrollHeight - element.clientHeight
      if (overflow > 1) tallest = Math.max(tallest, innerHeight + overflow)
    }
    return Math.min(tallest, 3600)
  })
  const grows = height > viewport.height
  if (grows) {
    await page.setViewportSize({ width: viewport.width, height })
    await sleep(150)
  }
  await page.screenshot({
    path,
    fullPage: true,
    animations: 'disabled',
    style: 'nextjs-portal { display: none; }',
    timeout: 20_000,
  })
  if (grows) await page.setViewportSize({ width: viewport.width, height: viewport.height })
}

async function walkOne(persona: Persona, viewport: Viewport, theme: Theme) {
  const name = `${persona.key} ${viewport.name} ${theme}: every route renders healthy`
  const started = performance.now()
  try {
    await withSession(
      persona,
      async (session) => {
        const { page } = session
        const failures: string[] = []
        if (persona === CONNECTED) await stubConnectedHome(page)
        for (const route of routesFor(persona)) {
          const response = await page.goto(orgUrl(`/${route.path}`), { timeout: 60_000 })
          await session.settle()
          if (route.name === 'home')
            await composer(page)
              .waitFor({ timeout: 20_000 })
              .catch(() => failures.push('home never left its skeleton'))
          const screenshot = `${persona.key}__${route.name}__${viewport.name}__${theme}.png`
          const path = resolve(artifactDirectory, screenshot)
          await fullPageScreenshot(page, path, viewport)
            // A client redirect can land after the page has settled.
            .catch(() => session.settle().then(() => fullPageScreenshot(page, path, viewport)))
            .catch((error) => failures.push(`${route.name} screenshot: ${getErrorMessage(error)}`))
          const facts = await page.evaluate(() => ({
            dark: document.documentElement.classList.contains('dark'),
            font: getComputedStyle(document.body).fontFamily,
            overflow: document.documentElement.scrollWidth - innerWidth,
            surfaces: document.querySelectorAll('[data-platform-ui]').length,
            text: (
              document.querySelector('main')?.textContent ??
              document.body.textContent ??
              ''
            ).trim().length,
          }))
          routes.push({
            persona: persona.key,
            route: route.path,
            viewport: viewport.name,
            theme,
            status: response?.status() ?? null,
            finalPath: pathOf(page.url()),
            screenshot,
            platformSurfaces: facts.surfaces,
          })
          if ((response?.status() ?? 500) >= 400)
            failures.push(`${route.name} status ${response?.status()}`)
          const expectedPathname = `${root}/${route.path.split('?')[0]}`
          if (new URL(page.url()).pathname !== expectedPathname)
            failures.push(`${route.name} landed on ${pathOf(page.url())}`)
          if (facts.dark !== (theme === 'dark')) failures.push(`${route.name} wrong theme`)
          if (/Times/.test(facts.font)) failures.push(`${route.name} has no stylesheet`)
          if (facts.overflow > 1) failures.push(`${route.name} overflows by ${facts.overflow}px`)
          if (facts.text === 0) failures.push(`${route.name} rendered an empty shell`)
        }
        assert.deepEqual(failures, [])
      },
      { viewport, theme }
    )
    record(name, 'Route walk', started)
  } catch (error) {
    record(name, 'Route walk', started, truncate(getErrorMessage(error), 2000))
  }
}

interface StateShot {
  name: string
  path: string
  /** Before the page loads, for a read this suite has no upstream for. */
  stub?: (page: Page) => Promise<void>
  /** Opens the state after the page loads. */
  open?: (page: Page) => Promise<void>
  /** On a phone, where the sidebar sits behind the navigation toggle. */
  openOnPhone?: (page: Page) => Promise<void>
  /** A state the phone layout does not have. */
  desktopOnly?: boolean
  persona?: Persona
}

const STATE_SHOTS: readonly StateShot[] = [
  { name: 'settings-admin', path: 'settings/admin?q=member' },
  {
    name: 'settings-mothership',
    path: 'settings/mothership',
    // The proxy needs an upstream and super admin mode; the page's own gate is what the shot shows.
    stub: async (page) => {
      await page.route('**/api/admin/mothership**', (route) =>
        route.fulfill({
          json: {
            total_requests: 3,
            total_users: 1,
            count: 1,
            users: [
              {
                user_id: 'user-1',
                request_count: 3,
                total_cost: 0.25,
                last_request: '2026-11-05T10:00:00.000Z',
              },
            ],
            requests: [
              {
                request_id: 'request-1',
                model: 'claude-model',
                duration_ms: 1200,
                billed_total_cost: 0.25,
                tool_call_count: 1,
                error: false,
                aborted: false,
                created_at: '2026-11-05T10:00:00.000Z',
              },
            ],
          },
        })
      )
    },
  },
  { name: 'not-found', path: 'settings/does-not-exist' },
  {
    name: 'collapsed-sidebar',
    path: 'home',
    desktopOnly: true,
    open: (page) => page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click(),
  },
  {
    name: 'menu-row-actions',
    path: 'settings/members',
    open: (page) =>
      page
        .getByRole('button', { name: /^Actions for / })
        .first()
        .click(),
  },
  {
    name: 'flyout-organization',
    path: 'home',
    open: (page) => orgChip(page).click(),
    openOnPhone: async (page) => {
      await page
        .getByRole('button', { name: /open (sidebar|menu|navigation)/i })
        .first()
        .click()
      await orgChip(page).click()
    },
  },
  {
    name: 'modal-invite',
    path: 'settings/members',
    open: (page) => page.getByRole('button', { name: 'Invite', exact: true }).click(),
  },
  {
    name: 'modal-create-group',
    path: 'settings/access-control',
    open: (page) => page.getByRole('button', { name: 'Create group', exact: true }).click(),
  },
  {
    name: 'modal-add-source',
    path: 'settings/integrations',
    open: (page) => page.getByRole('button', { name: 'Add source', exact: true }).click(),
  },
  {
    name: 'modal-add-user',
    path: 'settings/admin',
    open: (page) => page.getByRole('button', { name: 'Add user', exact: true }).click(),
  },
]

/** States a route walk never reaches. A shot that cannot open is a failure, not a missing file. */
async function stateScreenshots() {
  section('State screenshots')
  for (const viewport of [DESKTOP, PHONE]) {
    await check(`${viewport.name}: states capture`, () =>
      asPlatformAdmin(async () => {
        const failures: string[] = []
        // The fixture's default group forbids invitations, and the invite modal is a state to shoot.
        await sql`update permission_group set config = config - 'disableInvitations' where id = ${STANDARD_GROUP_ID}`
        try {
          for (const shot of STATE_SHOTS) {
            if (shot.desktopOnly && viewport === PHONE) continue
            await withSession(
              shot.persona ?? ADMIN,
              async (session) => {
                await shot.stub?.(session.page)
                await session.page.goto(orgUrl(`/${shot.path}`), { timeout: 60_000 })
                await session.settle()
                const open = viewport === PHONE ? (shot.openOnPhone ?? shot.open) : shot.open
                await open?.(session.page)
                await sleep(200)
                await session.page.screenshot({
                  path: resolve(artifactDirectory, `state__${shot.name}__${viewport.name}.png`),
                  animations: 'disabled',
                  timeout: 20_000,
                })
              },
              { viewport, theme: 'light' }
            ).catch((error) => failures.push(`${shot.name}: ${getErrorMessage(error)}`))
          }
        } finally {
          await sql`update permission_group set config = config || '{"disableInvitations":true}'::jsonb where id = ${STANDARD_GROUP_ID}`
        }
        await withSession(
          OUTSIDER,
          async (session) => {
            await session.page.goto(orgUrl('/home'), { timeout: 60_000 })
            await session.page.screenshot({
              path: resolve(artifactDirectory, `state__access-denied__${viewport.name}.png`),
              timeout: 20_000,
            })
          },
          { viewport, theme: 'light' }
        ).catch((error) => failures.push(`access-denied: ${getErrorMessage(error)}`))
        assert.deepEqual(failures, [])
      })
    )
  }
}

async function walkRoutes(personas: Persona[]) {
  section('Route walk')
  currentCheck = 'Route walk'
  // The token route limits per user, and one persona opens a hundred pages here within minutes.
  allowedFailures = [/429 POST \/api\/auth\/socket-token/]
  const plan = personas.flatMap((persona) =>
    [DESKTOP, PHONE].flatMap((viewport) =>
      (['light', 'dark'] as const).map((theme) => ({ persona, viewport, theme }))
    )
  )
  await mapWithConcurrency(plan, WALK_CONCURRENCY, ({ persona, viewport, theme }) =>
    walkOne(persona, viewport, theme)
  )
}

async function peoplePhaseChecks() {
  section('People with its flag on')
  await check('nav: People sits after Search', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/home'))
      assert.deepEqual(await navLabels(page), ['Home', 'Search', 'People', 'Integrations', 'Links'])
    })
  })
  await check(
    'a member reads that an organization admin connects the directory, and no name',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl('/people'))
        await expect(page.getByRole('button', { name: 'Org chart' })).toBeVisible()
        await expect(page.getByText(/organization admin/i).first()).toBeVisible()
        await expect(page.getByRole('button', { name: 'Directory sync' })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Connect Okta' })).toHaveCount(0)
      })
    }
  )
  await check('an admin can sync and import from the empty state', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/people'))
      await expect(page.getByRole('button', { name: 'Connect Okta' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Import profiles' })).toBeVisible()
    })
  })
  await check('the directory lists the organization', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/people?view=directory'))
      await expect(page.getByText(ADMIN.name).first()).toBeVisible()
    })
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
                ['chart', 'people'],
                ['directory', 'people?view=directory'],
              ]) {
                await session.page.goto(orgUrl(`/${path}`))
                await session.settle()
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

async function run() {
  await mkdir(artifactDirectory, { recursive: true })
  if (phase === 'people') {
    await peoplePhaseChecks()
  } else {
    await landingChecks()
    await sidebarChecks()
    await homeChecks()
    await chatChecks()
    await searchChecks()
    await integrationChecks()
    await linksChecks()
    await settingsChecks()
    await firstPaintChecks()
    await blastRadiusChecks()
    await walkRoutes([MEMBER, ADMIN, OWNER, CONNECTED, NARROW])
    await stateScreenshots()
  }
  section('Health')
  await check('no unexpected browser runtime errors or failed same-origin requests', async () => {
    assert.deepEqual(unexpected, [])
  })
}

await run()
  .catch((error) => {
    logger.error('Org redesign E2E aborted', { error: getErrorMessage(error) })
    process.exitCode = 1
  })
  .finally(async () => {
    await browser.close().catch(() => {})
    await sql.end({ timeout: 5 }).catch(() => {})
    const { failed } = reportCounts()
    if (failed > 0 || checks.length === 0) process.exitCode = 1
    finished = true
    writeReport()
    logger.info(`Org redesign E2E: ${JSON.stringify(reportCounts())}`)
  })
