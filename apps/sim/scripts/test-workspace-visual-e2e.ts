import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
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
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { truncate } from '@sim/utils/string'
import { makeSignature } from 'better-auth/crypto'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { diffPngFiles } from '@/scripts/compare-visual-baseline'
import {
  AGENT_WORKFLOW,
  API_KEYS,
  ASSISTANT_REPLY,
  BLOCKS,
  CUSTOM_TOOL_TITLE,
  DASHBOARD_TITLE,
  EMPTY_WORKSPACE,
  FIRST_FILE,
  FIRST_KNOWLEDGE_BASE,
  FIRST_SKILL,
  FIRST_TABLE,
  FREE,
  FREE_WORKSPACE,
  FROZEN_CLOCK_ISO,
  LATEST_RELEASE,
  OAUTH_INTEGRATION_SLUG,
  OPENED_CHAT,
  OWNER,
  POPULATED_WORKSPACE,
  SECRET_NAMES,
  WORKFLOW_MCP_SERVER_NAME,
} from '@/scripts/workspace-visual-e2e/fixture'

/**
 * The visual and behavior baseline for `/workspace`, taken before it moves to the Platform design
 * system, against a hosted production build with real Postgres, Redis and the realtime server.
 * Photographs each destination across widths and themes with a frozen clock, then records per-route
 * request, paint, byte, keyboard, portal and canvas facts from separate sessions on the real clock,
 * so a frozen clock never distorts a timing. `compare-visual-baseline.ts` diffs two runs.
 *
 * A check fails only when a page cannot be reached or shown. Everything else is data for the
 * comparison: a baseline records today's behavior, including what is wrong with it.
 *
 * Requires WORKSPACE_VISUAL_E2E_ORIGIN, WORKSPACE_VISUAL_E2E_DATABASE_URL,
 * WORKSPACE_VISUAL_E2E_AUTH_SECRET and WORKSPACE_VISUAL_E2E_REPORT_PATH. Shots land in `shots/`
 * beside the report; name the report `report.json` so the comparison tool finds it.
 */
const logger = createLogger('WorkspaceVisualE2E')
const expect = browserExpect.configure({ timeout: 30_000 })

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

const origin = new URL(requiredEnvironment('WORKSPACE_VISUAL_E2E_ORIGIN')).origin
assertDisposableTestDatabaseUrl(requiredEnvironment('WORKSPACE_VISUAL_E2E_DATABASE_URL'))
const authSecret = requiredEnvironment('WORKSPACE_VISUAL_E2E_AUTH_SECRET')
const reportPath = resolve(requiredEnvironment('WORKSPACE_VISUAL_E2E_REPORT_PATH'))
const outputDirectory = dirname(reportPath)
const shotDirectory = resolve(outputDirectory, 'shots')
const repeatDirectory = resolve(outputDirectory, 'shots-repeat')
const failureDirectory = resolve(outputDirectory, 'failures')

type Theme = 'light' | 'dark'
type Persona = typeof OWNER | typeof FREE
type Area = 'canvas' | 'settings' | 'integrations' | 'resource' | 'shell'
type CellState = 'populated' | 'empty' | 'modal' | 'menu' | 'terminal' | 'panel'

interface Viewport {
  name: string
  width: number
  height: number
  touch: boolean
}

const WIDE: Viewport = { name: '1440', width: 1440, height: 900, touch: false }
const LAPTOP: Viewport = { name: '1024', width: 1024, height: 768, touch: false }
const TABLET: Viewport = { name: '768', width: 768, height: 1024, touch: false }
const PHONE: Viewport = { name: '390', width: 390, height: 844, touch: true }
const ALL_WIDTHS = [WIDE, LAPTOP, TABLET, PHONE]
/** An open overlay and the secondary settings pages keep the run near 300 shots. */
const NARROW_AND_WIDE = [WIDE, PHONE]
const THEMES: readonly Theme[] = ['light', 'dark']

const SHOT_CONCURRENCY = 3
const CHECK_TIMEOUT_MS = 180_000
const SETTLE_MS = 8_000
const FOCUS_STOPS = 12
const PAN_STEPS = 60

/** The socket token route allows 30 mints a minute per user, and every document load mints one. */
const DOCUMENT_LOAD_SPACING_MS = 2_400
const HIGH_VOLUME_REQUEST = /\/api\/mothership\/events|\/socket\.io\//
/** A redirect or not-found is how Next ends those renders, not a failure of them. */
const HANDLED_RUNTIME = /NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK/
/** Consequences of this harness, not of the page: blocked hosts and plain-HTTP origins. */
const HARNESS_NOISE = /ERR_BLOCKED_BY_CLIENT|Cross-Origin-Opener-Policy header has been ignored/
const OPEN_LAYER = '[role="dialog"],[role="alertdialog"],[role="menu"]'
const MASK_ATTRIBUTE = 'data-visual-mask'

/** Zero, not `none`: a component waiting on `animationend` must still receive it. */
const STILLNESS_CSS = `*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
}`

/** Text the clock or a generated id can change; each match's element is masked in the shot. */
const VOLATILE_TEXT = [
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
  /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?/,
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b/,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/,
  /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/,
  /\b\d+\s*(?:s|sec|second|m|min|minute|h|hr|hour|d|day|w|week|mo|month|y|yr|year)s?\s+ago\b/,
  /\bjust now\b|\byesterday\b|\bin \d+ (?:minute|hour|day|week|month)s?\b/,
  /\b(?:wf|exec|run|sk-sim)[_-][a-z0-9-]{6,}/,
  /\bworkspace-visual-[\w-]+/,
].map(({ source }) => source)

interface Cell {
  area: Area
  destination: string
  state: CellState
  persona: Persona
  path: string
  viewports: readonly Viewport[]
  expectedStatus?: number
  /** An unmatched URL renders the root 404, outside the workspace layout. */
  outsideShell?: boolean
  /** Asserts the page shows what this state is about; runs before the page has settled. */
  ready: (page: Page) => Promise<void>
  /** Moves a settled page into this state. */
  enter?: (page: Page, viewport: Viewport) => Promise<void>
}

interface Shot {
  file: string
  area: Area
  destination: string
  state: CellState
  viewport: string
  theme: Theme
  width: number
  height: number
  finalPath: string
  contentBox: { x: number; y: number; width: number; height: number } | null
  /** Errors the page itself showed, which a passing shot would otherwise bury in pixels. */
  alerts: string[]
}

interface Problem {
  kind: 'runtime' | 'console' | 'http' | 'network'
  detail: string
}

interface FocusStop {
  tag: string
  role: string | null
  name: string
  focusVisible: boolean
  indicator: boolean
}

interface PortalProbe {
  state: CellState
  role: string | null
  label: string | null
  mountedOnBody: boolean
  insideContentShell: boolean
  insidePlatformScope: boolean
  zIndex: string
  background: string
  layerBgToken: string
  rootBgToken: string
  withinViewport: boolean
  focusInside: boolean
  escapeCloses: boolean
  focusAfterClose: FocusStop | null
}

interface RouteFacts {
  route: string
  path: string
  documentStatus: number | null
  finalPath: string
  requests: {
    total: number
    api: number
    duplicates: string[]
    paths: string[]
  }
  firstPaintMs: number | null
  firstContentfulPaintMs: number | null
  transferred: {
    jsBytes: number
    cssBytes: number
    jsFiles: number
    cssFiles: number
  }
  keyboard: FocusStop[]
  portals: PortalProbe[]
  alerts: string[]
  canvas?: {
    framesObserved: number
    meanFrameMs: number
    p95FrameMs: number
    maxFrameMs: number
    panned: boolean
  }
  problems: Problem[]
}

const checks: {
  name: string
  section: string
  status: 'passed' | 'failed'
  durationMs: number
  error?: string
}[] = []
const shots: Shot[] = []
const routes = new Map<string, RouteFacts>()
const determinism: { shot: string; changed: boolean; share: number | null }[] = []
let clientAddress = 0
let rateLimitedResponses = 0
let nextDocumentLoadAt = 0
let currentSection = 'Setup'

const browser: Browser = await chromium.launch()

function reportCounts() {
  return {
    passed: checks.filter(({ status }) => status === 'passed').length,
    failed: checks.filter(({ status }) => status === 'failed').length,
    shots: shots.length,
    rateLimitedResponses,
    problems: [...routes.values()].reduce((sum, route) => sum + route.problems.length, 0),
  }
}

/** Written as the run goes, so a job that runs out of time still leaves what it found. */
function writeReport() {
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        status: process.exitCode ? 'failed' : 'passed',
        sha: process.env.GITHUB_SHA ?? null,
        frozenClock: FROZEN_CLOCK_ISO,
        counts: reportCounts(),
        checks,
        shots,
        routes: [...routes.values()],
        determinism,
      },
      null,
      2
    )}\n`
  )
}

function section(name: string) {
  currentSection = name
  writeReport()
}

async function check(name: string, run: () => Promise<void>) {
  const sectionName = currentSection
  const started = performance.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out after ${CHECK_TIMEOUT_MS}ms`)),
      CHECK_TIMEOUT_MS
    )
  })
  try {
    await Promise.race([run(), timeout])
    checks.push({
      name,
      section: sectionName,
      status: 'passed',
      durationMs: Math.round(performance.now() - started),
    })
    logger.info(`PASS ${sectionName}: ${name}`)
  } catch (error) {
    const message = truncate(getErrorMessage(error), 2000)
    checks.push({
      name,
      section: sectionName,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: message,
    })
    logger.error(`FAIL ${sectionName}: ${name}`, { error: message })
  } finally {
    clearTimeout(timer)
  }
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

/** Sentry, analytics, and remote assets answer differently between runs; only the app may load. */
function isExternalRequest(address: URL) {
  if (address.protocol === 'data:' || address.protocol === 'blob:') return false
  return address.hostname !== new URL(origin).hostname && address.hostname !== '127.0.0.1'
}

class Session {
  private readonly inflight = new Set<Request>()
  private lastActivity = Date.now()
  readonly requests: { method: string; path: string; type: string; body: string | null }[] = []
  readonly problems: Problem[] = []

  constructor(
    readonly context: BrowserContext,
    readonly page: Page
  ) {
    const problem = (kind: Problem['kind'], detail: string) => {
      if (HANDLED_RUNTIME.test(detail) || HARNESS_NOISE.test(detail)) return
      const entry = { kind, detail: truncate(detail, 500) }
      if (!this.problems.some((known) => known.kind === kind && known.detail === entry.detail)) {
        this.problems.push(entry)
      }
    }
    page.on('pageerror', (error) => problem('runtime', error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') problem('console', message.text())
    })
    page.on('request', (request) => {
      if (HIGH_VOLUME_REQUEST.test(request.url())) return
      this.inflight.add(request)
      this.lastActivity = Date.now()
      if (isSameOrigin(request.url())) {
        this.requests.push({
          method: request.method(),
          path: pathOf(request.url()),
          type: request.resourceType(),
          body: request.postData(),
        })
      }
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
      ) {
        problem('network', `${request.method()} ${pathOf(request.url())} ${reason}`)
      }
    })
    page.on('response', (response) => {
      if (response.status() === 429) rateLimitedResponses += 1
      if (response.status() >= 400 && isSameOrigin(response.url())) {
        problem(
          'http',
          `${response.status()} ${response.request().method()} ${pathOf(response.url())}`
        )
      }
    })
  }

  /** Quiet for 400ms, ignoring the SSE and socket connections that never finish. */
  async settle(maxMs = SETTLE_MS) {
    const deadline = Date.now() + maxMs
    while (Date.now() < deadline) {
      if (this.inflight.size === 0 && Date.now() - this.lastActivity > 400) return
      await sleep(100)
    }
  }
}

interface OpenOptions {
  persona: Persona
  viewport: Viewport
  theme: Theme
  /** A session that takes pictures freezes time; one that measures keeps the real clock. */
  frozen: boolean
}

async function withSession<T>(options: OpenOptions, run: (session: Session) => Promise<T>) {
  const { persona, viewport, theme, frozen } = options
  clientAddress += 1
  const context = await browser.newContext({
    // Better Auth and the socket token route limit by address; these are not one client's traffic.
    extraHTTPHeaders: {
      'x-forwarded-for': `10.1.${Math.floor(clientAddress / 250)}.${clientAddress % 250}`,
    },
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: theme,
    deviceScaleFactor: 1,
    hasTouch: viewport.touch,
    isMobile: viewport.touch,
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: frozen ? 'reduce' : 'no-preference',
    bypassCSP: frozen,
  })
  await context.route(isExternalRequest, (route) => route.abort('blockedbyclient'))
  if (frozen) await context.clock.setFixedTime(new Date(FROZEN_CLOCK_ISO))
  const signature = await makeSignature(persona.sessionToken, authSecret)
  await context.addCookies([
    {
      name: 'better-auth.session_token',
      value: encodeURIComponent(`${persona.sessionToken}.${signature}`),
      url: origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
  const session = new Session(context, await context.newPage())
  try {
    return await run(session)
  } catch (error) {
    mkdirSync(failureDirectory, { recursive: true })
    await session.page
      .screenshot({
        path: resolve(failureDirectory, `failure-${checks.length + 1}.png`),
        timeout: 5_000,
      })
      .catch(() => {})
    throw error
  } finally {
    await context.close().catch(() => {})
  }
}

function contentShell(page: Page): Locator {
  return page.locator('.workspace-content-shell').filter({ visible: true })
}

function resourceRow(page: Page, name: string): Locator {
  return page.locator('[data-resource-row]').filter({ hasText: name }).first()
}

function openDialog(page: Page): Locator {
  return page.locator('[role="dialog"],[role="alertdialog"]').filter({ visible: true }).first()
}

function canvasNode(page: Page, blockId: string): Locator {
  return page.locator(`.react-flow__node[data-id="${blockId}"]`)
}

/** Fired directly: a coarse pointer has no right button, and the row's handler is what matters. */
async function openContextMenu(target: Locator, opened: Locator) {
  await expect(async () => {
    const box = await target.boundingBox()
    assert(box, 'The context menu target is not on screen')
    // Playwright's dispatchEvent builds a plain Event here, which has no coordinates to place a menu.
    await target.evaluate(
      (element, { clientX, clientY }) => {
        element.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            button: 2,
            clientX,
            clientY,
          })
        )
      },
      {
        clientX: Math.round(box.x + Math.min(24, box.width / 2)),
        clientY: Math.round(box.y + box.height / 2),
      }
    )
    await expect(opened).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
}

async function openRowMenu(page: Page, rowName: string) {
  await openContextMenu(resourceRow(page, rowName), page.getByRole('menu').first())
}

async function openRowDeleteModal(page: Page, rowName: string) {
  await openRowMenu(page, rowName)
  await page
    .getByRole('menuitem', { name: /^Delete/ })
    .first()
    .click()
  await expect(openDialog(page)).toBeVisible()
}

/** Clicks until the page has hydrated enough to answer. */
async function clickUntilOpen(trigger: Locator, opened: Locator) {
  await expect(async () => {
    if (!(await opened.isVisible())) await trigger.click({ timeout: 5_000 })
    await expect(opened).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 30_000 })
}

async function openSearchModal(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Search' })
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.keyboard.press('ControlOrMeta+k')
    await expect(dialog).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 30_000 })
}

async function openResourcesMenu(page: Page) {
  await clickUntilOpen(
    page.getByRole('button', { name: 'Add resources', exact: true }),
    page.getByRole('menu').first()
  )
}

async function showMessageBox(page: Page) {
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
}

async function showSeededRow(page: Page, name: string) {
  await expect(resourceRow(page, name)).toBeVisible()
}

async function showEmptyList(page: Page) {
  await expect(contentShell(page)).toBeVisible()
  await expect(page.locator('[data-resource-row]')).toHaveCount(0)
}

async function showCanvas(page: Page) {
  for (const blockId of Object.values(BLOCKS)) {
    await expect(canvasNode(page, blockId)).toBeVisible()
  }
}

async function openBlockMenu(page: Page) {
  await openContextMenu(
    canvasNode(page, BLOCKS.agent),
    page.getByRole('menuitem', { name: /^Copy/ })
  )
}

/** A phone reaches the panel only through a block's menu; wider screens always show it. */
async function openBlockEditor(page: Page, viewport: Viewport) {
  if (viewport.touch) {
    await openBlockMenu(page)
    await page.getByRole('menuitem', { name: 'Open Editor', exact: true }).click()
  } else {
    await canvasNode(page, BLOCKS.agent).click({ position: { x: 24, y: 16 } })
  }
  const panel = page.locator('#workflow-panel')
  await expect(panel).toBeVisible()
  await panel.locator('[data-tab-button="editor"]').click()
}

async function openTerminal(page: Page) {
  const terminal = page.locator('.terminal-container')
  await expect(terminal).toBeVisible()
  const box = await terminal.boundingBox()
  if ((box?.height ?? 0) < 60) {
    await terminal.getByText('Logs', { exact: true }).first().click()
    await expect
      .poll(async () => (await terminal.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(100)
  }
  await clickUntilOpen(
    terminal.getByRole('button', { name: 'Terminal options', exact: true }),
    page.locator(OPEN_LAYER).filter({ visible: true }).first()
  )
}

async function openDeployModal(page: Page, viewport: Viewport) {
  if (viewport.touch) await openBlockEditor(page, viewport)
  await clickUntilOpen(
    page
      .locator('#workflow-panel')
      .getByRole('button', { name: /^(?:Live|Update|Deploy)$/ })
      .first(),
    openDialog(page)
  )
}

const populatedPath = `/workspace/${POPULATED_WORKSPACE.id}`
const emptyPath = `/workspace/${EMPTY_WORKSPACE.id}`

function cell(
  area: Area,
  destination: string,
  state: CellState,
  path: string,
  ready: Cell['ready'],
  extra: Partial<
    Pick<Cell, 'enter' | 'persona' | 'viewports' | 'expectedStatus' | 'outsideShell'>
  > = {}
): Cell {
  const overlay = state === 'modal' || state === 'menu'
  return {
    area,
    destination,
    state,
    path,
    ready,
    persona: OWNER,
    viewports: overlay ? NARROW_AND_WIDE : ALL_WIDTHS,
    ...extra,
  }
}

/** A list page: seeded rows, the same page empty, a row's menu, and the row's delete confirmation. */
function resourceListCells(destination: string, firstRow: string): Cell[] {
  const path = `${populatedPath}/${destination}`
  const ready = (page: Page) => showSeededRow(page, firstRow)
  return [
    cell('resource', destination, 'populated', path, ready),
    cell('resource', destination, 'empty', `${emptyPath}/${destination}`, showEmptyList),
    cell('resource', destination, 'menu', path, ready, {
      enter: (page) => openRowMenu(page, firstRow),
    }),
    cell('resource', destination, 'modal', path, ready, {
      enter: (page) => openRowDeleteModal(page, firstRow),
    }),
  ]
}

/**
 * The settings pages shown in full. The rest appear at two widths; their content is a list of
 * rows in the same shell, which `general` and `apikeys` already cover at every width.
 */
const SECONDARY_SETTINGS: readonly {
  id: string
  title: string
  expect?: string
  expectField?: string
}[] = [
  { id: 'billing', title: 'Subscription' },
  { id: 'teammates', title: 'Teammates', expect: OWNER.email },
  { id: 'secrets', title: 'Secrets', expectField: SECRET_NAMES[0] },
  { id: 'byok', title: 'BYOK' },
  { id: 'sandboxes', title: 'Sandboxes' },
  { id: 'custom-tools', title: 'Custom tools', expect: CUSTOM_TOOL_TITLE },
  { id: 'mcp', title: 'MCP tools' },
  { id: 'workflow-mcp-servers', title: 'MCP servers', expect: WORKFLOW_MCP_SERVER_NAME },
  { id: 'inbox', title: 'Sim Mailer' },
  { id: 'recently-deleted', title: 'Recently deleted' },
]

/**
 * Whether a section is open to this viewer is the page gate's decision, and a redirect to General
 * is itself the behavior to record (`finalPath`), so only an unredirected page asserts its content.
 */
function settingsReady(sectionId: string, title: string, seeded?: string, seededField?: string) {
  return async (page: Page) => {
    await expect(contentShell(page)).toBeVisible()
    if (!new URL(page.url()).pathname.endsWith(`/settings/${sectionId}`)) return
    await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible()
    if (seeded) await expect(page.getByText(seeded).first()).toBeVisible()
    if (seededField) {
      await expect
        .poll(() =>
          page
            .locator('input')
            .evaluateAll(
              (inputs, value) =>
                inputs.some((input) => (input as HTMLInputElement).value === value),
              seededField
            )
        )
        .toBe(true)
    }
  }
}

const editorPath = `${populatedPath}/w/${AGENT_WORKFLOW.id}`
const chatPath = `${populatedPath}/chat/${OPENED_CHAT.id}`
const integrationsPath = `${populatedPath}/integrations`
const gmailPath = `${integrationsPath}/${OAUTH_INTEGRATION_SLUG}`
const apiKeysPath = `${populatedPath}/settings/apikeys`

const showPageNotFound = async (page: Page) => {
  await expect(page.getByText('Page not found', { exact: true })).toBeVisible()
}
const showIntegrations = async (page: Page) => {
  await expect(page.getByPlaceholder('Search integrations...', { exact: true })).toBeVisible()
}
const showGmail = async (page: Page) => {
  await expect(
    contentShell(page).getByRole('link', { name: 'Integrations', exact: true })
  ).toBeVisible()
}
const showApiKeys = settingsReady('apikeys', 'Sim API keys', API_KEYS[0])

const VISUAL_CELLS: Cell[] = [
  cell('shell', 'home', 'populated', `${populatedPath}/home`, showMessageBox),
  cell('shell', 'home', 'empty', `${emptyPath}/home`, showMessageBox),
  cell('shell', 'home', 'menu', `${populatedPath}/home`, showMessageBox, {
    enter: openResourcesMenu,
  }),
  cell('shell', 'home', 'modal', `${populatedPath}/home`, showMessageBox, {
    enter: openSearchModal,
  }),
  cell('shell', 'chat', 'populated', chatPath, async (page) => {
    await expect(page.getByText(ASSISTANT_REPLY).first()).toBeVisible()
  }),
  cell('shell', 'chat', 'menu', chatPath, showMessageBox, { enter: openResourcesMenu }),
  ...resourceListCells('files', FIRST_FILE),
  ...resourceListCells('tables', FIRST_TABLE),
  ...resourceListCells('knowledge', FIRST_KNOWLEDGE_BASE),
  cell('resource', 'logs', 'populated', `${populatedPath}/logs`, (page) =>
    showSeededRow(page, AGENT_WORKFLOW.name)
  ),
  cell('resource', 'logs', 'empty', `${emptyPath}/logs`, showEmptyList),
  cell(
    'resource',
    'logs',
    'menu',
    `${populatedPath}/logs`,
    (page) => showSeededRow(page, AGENT_WORKFLOW.name),
    { enter: (page) => openRowMenu(page, AGENT_WORKFLOW.name) }
  ),
  cell('integrations', 'skills', 'populated', `${populatedPath}/skills`, async (page) => {
    await expect(page.getByText(FIRST_SKILL, { exact: true }).first()).toBeVisible()
  }),
  cell('integrations', 'skills', 'empty', `${emptyPath}/skills`, async (page) => {
    await expect(page.getByPlaceholder('Search skills...', { exact: true })).toBeVisible()
  }),
  cell('resource', 'dashboards', 'populated', `${populatedPath}/dashboards`, async (page) => {
    await expect(page.getByText(DASHBOARD_TITLE, { exact: true }).first()).toBeVisible()
  }),
  cell('resource', 'dashboards', 'empty', `${emptyPath}/dashboards`, async (page) => {
    await expect(contentShell(page)).toBeVisible()
    await expect(page.getByText('Dashboards are not enabled')).toHaveCount(0)
  }),
  cell('resource', 'changelog', 'populated', `${populatedPath}/changelog`, async (page) => {
    await expect(page.getByRole('heading', { name: LATEST_RELEASE, exact: true })).toBeVisible()
  }),
  cell('resource', 'changelog', 'empty', `${emptyPath}/changelog`, async (page) => {
    await expect(contentShell(page)).toBeVisible()
    await expect(page.getByRole('heading', { name: LATEST_RELEASE })).toHaveCount(0)
  }),
  cell(
    'shell',
    'upgrade',
    'populated',
    `/workspace/${FREE_WORKSPACE.id}/upgrade`,
    async (page) => {
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    },
    { persona: FREE }
  ),
  cell(
    'shell',
    'not-found',
    'populated',
    `${populatedPath}/no-such-destination`,
    showPageNotFound,
    { expectedStatus: 404, outsideShell: true }
  ),
  cell(
    'shell',
    'workspace-not-found',
    'populated',
    `${populatedPath}/settings/no-such-section`,
    showPageNotFound,
    { expectedStatus: 404, viewports: NARROW_AND_WIDE }
  ),
  cell('integrations', 'integrations', 'populated', integrationsPath, showIntegrations),
  cell('integrations', 'integrations', 'menu', integrationsPath, showIntegrations, {
    enter: (page) =>
      clickUntilOpen(
        contentShell(page).locator('button').filter({ hasText: /^All/ }).first(),
        page.getByRole('menu').first()
      ),
  }),
  cell('integrations', 'integration-detail', 'populated', gmailPath, showGmail),
  // The deep link opens the modal on load, which hides the page behind it from role queries.
  cell(
    'integrations',
    'integration-detail',
    'modal',
    `${gmailPath}?connect=oauth`,
    async (page) => {
      await expect(openDialog(page)).toBeVisible()
    }
  ),
  cell(
    'settings',
    'general',
    'populated',
    `${populatedPath}/settings/general`,
    settingsReady('general', 'General')
  ),
  cell('settings', 'apikeys', 'populated', apiKeysPath, showApiKeys),
  cell('settings', 'apikeys', 'menu', apiKeysPath, showApiKeys, {
    enter: (page) =>
      clickUntilOpen(
        page.getByRole('button', { name: 'API key actions', exact: true }).first(),
        page.getByRole('menu').first()
      ),
  }),
  cell('settings', 'apikeys', 'modal', apiKeysPath, showApiKeys, {
    enter: (page) =>
      clickUntilOpen(
        page.getByRole('button', { name: 'Create API key', exact: true }).first(),
        openDialog(page)
      ),
  }),
  ...SECONDARY_SETTINGS.map(({ id, title, expect: seeded, expectField }) =>
    cell(
      'settings',
      id,
      'populated',
      `${populatedPath}/settings/${id}`,
      settingsReady(id, title, seeded, expectField),
      { viewports: NARROW_AND_WIDE }
    )
  ),
]

/**
 * One at a time and last: two sessions on the same workflow would show each other as collaborators.
 */
const EDITOR_CELLS: Cell[] = [
  cell('canvas', 'editor', 'populated', editorPath, showCanvas),
  cell('canvas', 'editor', 'terminal', editorPath, showCanvas, { enter: openTerminal }),
  cell('canvas', 'editor', 'panel', editorPath, showCanvas, { enter: openBlockEditor }),
  cell('canvas', 'editor', 'menu', editorPath, showCanvas, { enter: openBlockMenu }),
  cell('canvas', 'editor', 'modal', editorPath, showCanvas, { enter: openDeployModal }),
]

function shotName(target: Cell, viewport: Viewport, theme: Theme) {
  return `${target.area}__${target.destination}__${target.state}__${viewport.name}__${theme}.png`
}

/** Spaces loads across workers, so a rate limited token never leaves a shot without its socket. */
async function waitForDocumentLoadSlot() {
  const now = Date.now()
  const slot = Math.max(now, nextDocumentLoadAt)
  nextDocumentLoadAt = slot + DOCUMENT_LOAD_SPACING_MS
  if (slot > now) await sleep(slot - now)
}

async function loadCell(session: Session, target: Cell) {
  await waitForDocumentLoadSlot()
  const response = await session.page.goto(`${origin}${target.path}`, {
    waitUntil: 'load',
    timeout: 90_000,
  })
  const status = response?.status() ?? null
  if (target.expectedStatus === undefined) {
    assert(status !== null && status < 400, `${target.path} answered ${status}`)
  }
  if (!target.outsideShell) await expect(contentShell(session.page)).toBeVisible()
  await expect(session.page.getByText('Application error', { exact: false })).toHaveCount(0)
  await target.ready(session.page)
  await session.settle()
  return status
}

/** ECharts paints on its own schedule, past anything CSS can stop. */
async function waitForStableCanvases(page: Page) {
  const read = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('canvas'))
        .map((canvas) => {
          try {
            return canvas.toDataURL()
          } catch {
            return ''
          }
        })
        .join('|')
    )
  let previous = await read()
  if (!previous) return
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(250)
    const next = await read()
    if (next === previous) return
    previous = next
  }
}

function readAlerts(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="alert"]'))
      .map((alert) => (alert.textContent ?? '').trim().slice(0, 200))
      .filter(Boolean)
  )
}

async function markVolatileText(page: Page) {
  await page.evaluate(
    ({ sources, attribute }) => {
      const patterns = sources.map((source) => new RegExp(source, 'i'))
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement
        const text = node.textContent ?? ''
        if (!parent || !text.trim() || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) {
          continue
        }
        if (patterns.some((pattern) => pattern.test(text))) parent.setAttribute(attribute, '')
      }
      for (const element of Array.from(document.querySelectorAll('time,[datetime]'))) {
        element.setAttribute(attribute, '')
      }
    },
    { sources: VOLATILE_TEXT, attribute: MASK_ATTRIBUTE }
  )
}

async function takeShot(
  target: Cell,
  viewport: Viewport,
  theme: Theme,
  directory: string
): Promise<Shot> {
  const file = shotName(target, viewport, theme)
  return withSession(
    { persona: target.persona, viewport, theme, frozen: true },
    async (session) => {
      const { page } = session
      await loadCell(session, target)
      await page.addStyleTag({ content: STILLNESS_CSS })
      if (target.enter) {
        await target.enter(page, viewport)
        await session.settle(4_000)
      }
      await page.evaluate(() => document.fonts.ready.then(() => undefined))
      await page.mouse.move(0, 0)
      await waitForStableCanvases(page)
      assert.equal(
        await page.evaluate(() => document.documentElement.classList.contains('dark')),
        theme === 'dark',
        'The page did not follow the requested theme'
      )
      const alerts = await readAlerts(page)
      await markVolatileText(page)
      const contentBox = await contentShell(page)
        .first()
        .boundingBox()
        .catch(() => null)
      await page.screenshot({
        path: resolve(directory, file),
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
        mask: [page.locator(`[${MASK_ATTRIBUTE}]`)],
        maskColor: '#808080',
        timeout: 30_000,
      })
      return {
        file,
        area: target.area,
        destination: target.destination,
        state: target.state,
        viewport: viewport.name,
        theme,
        width: viewport.width,
        height: viewport.height,
        finalPath: pathOf(page.url()),
        contentBox,
        alerts,
      }
    }
  )
}

function expandCells(cells: readonly Cell[]) {
  return cells.flatMap((target) =>
    target.viewports.flatMap((viewport) => THEMES.map((theme) => ({ target, viewport, theme })))
  )
}

async function photograph(cells: readonly Cell[], concurrency: number) {
  await mapWithConcurrency(expandCells(cells), concurrency, async ({ target, viewport, theme }) => {
    await check(shotName(target, viewport, theme), async () => {
      shots.push(await takeShot(target, viewport, theme, shotDirectory))
    })
  })
}

/** Reloads a few shots from scratch, so the report says whether this environment repeats itself. */
async function measureDeterminism() {
  mkdirSync(repeatDirectory, { recursive: true })
  const samples = [VISUAL_CELLS[0], VISUAL_CELLS[6], VISUAL_CELLS[8], EDITOR_CELLS[0]]
  for (const target of samples) {
    const file = shotName(target, WIDE, 'light')
    await check(`repeat ${file}`, async () => {
      if (!shots.some((shot) => shot.file === file)) return
      await takeShot(target, WIDE, 'light', repeatDirectory)
      const { changed, share } = await diffPngFiles(
        resolve(shotDirectory, file),
        resolve(repeatDirectory, file)
      )
      determinism.push({ shot: file, changed, share })
      if (changed) logger.warn(`A repeated shot differs: ${file}`, { share })
    })
  }
}

interface ProbeCounters {
  jsBytes: number
  cssBytes: number
  jsFiles: number
  cssFiles: number
}

async function countTransferredBytes(session: Session): Promise<ProbeCounters> {
  const counters: ProbeCounters = { jsBytes: 0, cssBytes: 0, jsFiles: 0, cssFiles: 0 }
  const types = new Map<string, string>()
  const cdp = await session.context.newCDPSession(session.page)
  cdp.on('Network.responseReceived', ({ requestId, type }) => {
    types.set(requestId, type)
  })
  cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    const type = types.get(requestId)
    if (type === 'Script') {
      counters.jsBytes += encodedDataLength
      counters.jsFiles += 1
    } else if (type === 'Stylesheet') {
      counters.cssBytes += encodedDataLength
      counters.cssFiles += 1
    }
  })
  await cdp.send('Network.enable')
  return counters
}

async function describeFocus(page: Page): Promise<FocusStop | null> {
  return page.evaluate(() => {
    const element = document.activeElement
    if (!element || element === document.body) return null
    const style = getComputedStyle(element)
    return {
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role'),
      name: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 60),
      focusVisible: element.matches(':focus-visible'),
      indicator: style.outlineStyle !== 'none' || style.boxShadow !== 'none',
    }
  })
}

async function probeKeyboard(page: Page): Promise<FocusStop[]> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  const stops: FocusStop[] = []
  for (let press = 0; press < FOCUS_STOPS; press += 1) {
    await page.keyboard.press('Tab')
    const stop = await describeFocus(page)
    if (stop) stops.push(stop)
  }
  return stops
}

async function probePortal(page: Page, state: CellState): Promise<PortalProbe> {
  const facts = await page.evaluate((selector) => {
    const layers = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((layer) =>
      layer.checkVisibility({ visibilityProperty: true })
    )
    const layer = layers[layers.length - 1]
    if (!layer) throw new Error('No open layer to probe')
    let stacked: HTMLElement | null = layer
    let zIndex = 'auto'
    while (stacked && stacked !== document.body) {
      const value = getComputedStyle(stacked).zIndex
      if (value !== 'auto') {
        zIndex = value
        break
      }
      stacked = stacked.parentElement
    }
    const box = layer.getBoundingClientRect()
    const style = getComputedStyle(layer)
    return {
      role: layer.getAttribute('role'),
      label: layer.getAttribute('aria-label'),
      mountedOnBody: !layer.closest('.workspace-content-shell') && !layer.closest('main'),
      insideContentShell: Boolean(layer.closest('.workspace-content-shell')),
      insidePlatformScope: Boolean(layer.closest('[data-platform-ui]')),
      zIndex,
      background: style.backgroundColor,
      layerBgToken: style.getPropertyValue('--bg').trim(),
      rootBgToken: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
      withinViewport:
        box.left >= 0 &&
        box.top >= 0 &&
        box.right <= window.innerWidth &&
        box.bottom <= window.innerHeight,
      focusInside: layer.contains(document.activeElement),
    }
  }, OPEN_LAYER)
  await page.keyboard.press('Escape')
  const closed = page.locator(OPEN_LAYER).filter({ visible: true })
  const escapeCloses = await expect(closed)
    .toHaveCount(0, { timeout: 3_000 })
    .then(() => true)
    .catch(() => false)
  return { state, ...facts, escapeCloses, focusAfterClose: await describeFocus(page) }
}

function emptyTransfer(): RouteFacts['transferred'] {
  return { jsBytes: 0, cssBytes: 0, jsFiles: 0, cssFiles: 0 }
}

/** One cold load of a route on the real clock: what it fetched, painted, and lets a keyboard do. */
async function probeRoute(target: Cell) {
  await withSession(
    { persona: target.persona, viewport: WIDE, theme: 'light', frozen: false },
    async (session) => {
      const counters = await countTransferredBytes(session)
      const status = await loadCell(session, target)
      const paints = await session.page.evaluate(() =>
        Object.fromEntries(
          performance.getEntriesByType('paint').map(({ name, startTime }) => [name, startTime])
        )
      )
      const api = session.requests.filter(({ path }) => path.startsWith('/api/'))
      // The same URL with a different body is a different read, as dashboard panels all are.
      const seen = new Map<string, { label: string; count: number }>()
      for (const { method, path, body } of api) {
        const key = `${method} ${path} ${body ?? ''}`
        const entry = seen.get(key) ?? { label: `${method} ${path}`, count: 0 }
        seen.set(key, { ...entry, count: entry.count + 1 })
      }
      const known = routes.get(target.destination)
      routes.set(target.destination, {
        route: target.destination,
        path: target.path,
        documentStatus: status,
        finalPath: pathOf(session.page.url()),
        requests: {
          total: session.requests.length,
          api: api.length,
          duplicates: [...seen.values()]
            .filter(({ count }) => count > 1)
            .map(({ label, count }) => `${label} x${count}`),
          paths: [...new Set(api.map(({ method, path }) => `${method} ${path}`))].sort(),
        },
        firstPaintMs: paints['first-paint'] ?? null,
        firstContentfulPaintMs: paints['first-contentful-paint'] ?? null,
        transferred: { ...counters },
        alerts: await readAlerts(session.page),
        keyboard: await probeKeyboard(session.page),
        portals: known?.portals ?? [],
        ...(known?.canvas ? { canvas: known.canvas } : {}),
        problems: session.problems,
      })
    }
  )
}

async function probeOverlay(target: Cell) {
  await withSession(
    { persona: target.persona, viewport: WIDE, theme: 'light', frozen: false },
    async (session) => {
      await loadCell(session, target)
      await target.enter?.(session.page, WIDE)
      await session.settle(4_000)
      const probe = await probePortal(session.page, target.state)
      const known = routes.get(target.destination)
      if (known) {
        known.portals.push(probe)
      } else {
        routes.set(target.destination, {
          route: target.destination,
          path: target.path,
          documentStatus: null,
          finalPath: pathOf(session.page.url()),
          requests: { total: 0, api: 0, duplicates: [], paths: [] },
          firstPaintMs: null,
          firstContentfulPaintMs: null,
          transferred: emptyTransfer(),
          keyboard: [],
          portals: [probe],
          alerts: [],
          problems: session.problems,
        })
      }
    }
  )
}

/** Wheel input: on a mouse-driven canvas a plain drag selects, and scrolling is what pans. */
async function probeCanvasPan(target: Cell) {
  await withSession(
    { persona: target.persona, viewport: WIDE, theme: 'light', frozen: false },
    async (session) => {
      const { page } = session
      await loadCell(session, target)
      const pane = await page.locator('.react-flow__pane').first().boundingBox()
      assert(pane, 'The canvas pane is not on screen')
      const transform = () =>
        page
          .locator('.react-flow__viewport')
          .first()
          .evaluate((element) => element.style.transform)
      const before = await transform()
      await page.mouse.move(pane.x + pane.width / 2, pane.y + 40)
      await page.evaluate(() => {
        const state = { samples: [] as number[], running: true }
        let last = performance.now()
        const tick = (now: number) => {
          state.samples.push(now - last)
          last = now
          if (state.running) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
        Object.assign(window, { __panProbe: state })
      })
      let turnaround = before
      for (let step = 0; step < PAN_STEPS; step += 1) {
        if (step === PAN_STEPS / 2) turnaround = await transform()
        await page.mouse.wheel(step < PAN_STEPS / 2 ? 12 : -12, 0)
        await sleep(16)
      }
      const samples = await page.evaluate(() => {
        const { __panProbe: state } = window as typeof window & {
          __panProbe: { samples: number[]; running: boolean }
        }
        state.running = false
        return state.samples
      })
      const sorted = [...samples].sort((left, right) => left - right)
      const mean = sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length)
      const canvas = {
        framesObserved: sorted.length,
        meanFrameMs: Number(mean.toFixed(2)),
        p95FrameMs: Number((sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(2)),
        maxFrameMs: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
        panned: before !== turnaround,
      }
      const known = routes.get(target.destination)
      if (known) known.canvas = canvas
    }
  )
}

function probeTargets(cells: readonly Cell[]) {
  const firstByDestination = new Map<string, Cell>()
  for (const target of cells) {
    if (target.state === 'populated' && !firstByDestination.has(target.destination)) {
      firstByDestination.set(target.destination, target)
    }
  }
  return [...firstByDestination.values()]
}

async function run() {
  for (const directory of [outputDirectory, shotDirectory]) {
    mkdirSync(directory, { recursive: true })
  }
  section('Shots')
  await photograph(VISUAL_CELLS, SHOT_CONCURRENCY)
  section('Editor shots')
  await photograph(EDITOR_CELLS, 1)

  section('Determinism')
  await measureDeterminism()

  const everyCell = [...VISUAL_CELLS, ...EDITOR_CELLS]
  section('Route facts')
  for (const target of probeTargets(everyCell)) {
    await check(`${target.destination} route facts`, () => probeRoute(target))
  }
  section('Portal facts')
  for (const target of everyCell.filter(({ state }) => state === 'modal' || state === 'menu')) {
    await check(`${target.destination} ${target.state} portal facts`, () => probeOverlay(target))
  }
  section('Canvas facts')
  await check('canvas pan frame time', () => probeCanvasPan(EDITOR_CELLS[0]))
}

await run()
  .catch((error) => {
    logger.error('Workspace visual E2E aborted', { error: getErrorMessage(error) })
    process.exitCode = 1
  })
  .finally(async () => {
    await browser.close().catch(() => {})
    const { failed } = reportCounts()
    if (failed > 0 || checks.length === 0) process.exitCode = 1
    writeReport()
    logger.info(`Workspace visual E2E: ${JSON.stringify(reportCounts())}`)
  })
