import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import {
  type Browser,
  type BrowserContext,
  expect as browserExpect,
  chromium,
  type Locator,
  type Page,
  webkit,
} from '@playwright/test'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId, generateShortId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { makeSignature } from 'better-auth/crypto'
import postgres from 'postgres'
import {
  isPathOrDescendant,
  organizationRoutes,
  workspaceEntry,
  workspacePath,
} from '@/lib/navigation/paths'
import { workspaceResourcePath } from '@/lib/resources/urls'

/**
 * Real browser coverage of the product shell and its pages against a running local app and
 * disposable PostgreSQL.
 * Requires MOBILE_E2E_BASE_URL, MOBILE_E2E_DATABASE_URL, MOBILE_E2E_AUTH_SECRET,
 * and MOBILE_E2E_REPORT_PATH. The app runs without KNOWLEDGE_MEMBER_ACCESS and CREDENTIAL_GROUPS,
 * so the seeded personal organization proves Integrations and Skills need neither. Native launches
 * require installed Playwright browsers.
 * PLAYWRIGHT_WEBKIT_WS_ENDPOINT uses the pinned loopback WebKit server instead.
 * MOBILE_E2E_BROWSER and MOBILE_E2E_VIEWPORT narrow a diagnostic rerun.
 * MOBILE_E2E_SHARD (index/count, one-based) partitions all viewports across CI jobs.
 */
const logger = createLogger('MobileE2E')
const expect = browserExpect.configure({ timeout: 20_000 })

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

const selectedBrowser = process.env.MOBILE_E2E_BROWSER
const webkitEndpoint = process.env.PLAYWRIGHT_WEBKIT_WS_ENDPOINT
if (webkitEndpoint !== undefined) {
  assert.equal(selectedBrowser, 'webkit', 'A remote endpoint requires explicit WebKit selection')
  assert(/^ws:\/\/127\.0\.0\.1:[1-9]\d*\/$/.test(webkitEndpoint), 'Invalid WebKit endpoint')
  new URL(webkitEndpoint)
  assert.equal(
    toRecord(createRequire(import.meta.url)('@playwright/test/package.json')).version,
    '1.64.1',
    'The remote WebKit image requires Playwright 1.64.1'
  )
}

const baseUrl = new URL(requiredEnvironment('MOBILE_E2E_BASE_URL'))
const databaseUrl = new URL(requiredEnvironment('MOBILE_E2E_DATABASE_URL'))
const authSecret = requiredEnvironment('MOBILE_E2E_AUTH_SECRET')
const reportPath = resolve(requiredEnvironment('MOBILE_E2E_REPORT_PATH'))
const artifactDirectory = `${reportPath}.artifacts`
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
assert(loopbackHosts.has(baseUrl.hostname), 'The app must use a loopback host')
assert.equal(baseUrl.protocol, 'http:', 'The app must use local HTTP')
assert(!baseUrl.username && !baseUrl.password, 'App URL must not contain credentials')
assert.equal(baseUrl.pathname, '/', 'App URL must be an origin without a path')
assert(loopbackHosts.has(databaseUrl.hostname), 'The database must use a loopback host')
assert(['postgres:', 'postgresql:'].includes(databaseUrl.protocol), 'Expected a PostgreSQL URL')
assert(
  /(?:^|[_-])test(?:[_-]|$)/i.test(databaseUrl.pathname.slice(1)),
  'Use a dedicated test database'
)
assert(authSecret.length >= 32, 'Use a local Better Auth secret of at least 32 characters')

const sql = postgres(databaseUrl.toString(), { max: 2 })
const ownerId = generateId()
const organizationId = generateId()
const workspaceId = generateId()
const folderId = generateId()
const workflowId = generateId()
const snapshotId = generateId()
const chatId = generateId()
const tableId = generateId()
const tableRowId = generateId()
const publicChatIdentifier = `mobile-e2e-${generateId()}`
const folderName = 'Mobile E2E folder'
const workspaceName = 'Mobile E2E workspace'
const organization = organizationRoutes(organizationId)
const filesPath = workspacePath(workspaceId, 'files')
const logsPath = workspacePath(workspaceId, 'logs')
const tablePath = workspaceResourcePath(workspaceId, 'table', tableId)
const workflowPath = workspaceResourcePath(workspaceId, 'workflow', workflowId)
/** The EMCN compact control (`--spacing-app-control-sm`): Run, Deploy and a filled icon's face. */
const COMPACT_CONTROL_HEIGHT = 28
/** The EMCN touch target (`--spacing-app-touch-target`), the box a quiet icon takes on touch. */
const TOUCH_TARGET_SIZE = 44
/** The shell swaps its sidebar for the navigation drawer at `48rem` and below. */
const COMPACT_NAVIGATION_WIDTH = 768
const startedAt = new Date().toISOString()
const checks: CheckResult[] = []
const screenshots: string[] = []
const httpErrors: { browser: string; status: number; path: string }[] = []
/**
 * Every workspace page load mounts the shared realtime socket, which mints one realtime token from a
 * route capped at 30 per minute per client IP. The suite loads well over 30 documents a minute, all
 * from loopback, so that route's own rate-limit response is expected here; it is recorded apart
 * from `httpErrors` and must still carry `Retry-After`, and each browser must mint at least once.
 */
const SOCKET_TOKEN_PATH = '/api/auth/socket-token'
const socketTokenMints = new Map<string, { minted: number; rateLimited: number }>()
const requestFailures: {
  browser: string
  viewport: string
  path: string
  error: string | undefined
}[] = []
const navigationDiagnostics: {
  browser: string
  viewport: string
  timestamp: string
  from: string
  to: string
  path: string
  error: string
}[] = []
const viewports = [
  { name: 'small-phone', width: 320, height: 568, touch: true },
  { name: 'android', width: 360, height: 800, touch: true },
  { name: 'phone', width: 390, height: 844, touch: true },
  { name: 'landscape', width: 667, height: 375, touch: true },
  { name: 'tablet', width: 820, height: 1180, touch: true },
  { name: 'desktop', width: 1440, height: 1000, touch: false },
  { name: 'wide-desktop', width: 1920, height: 1080, touch: false },
] as const
interface SurfaceRoute {
  name: string
  path: string
  /** What the page shows once its data arrives. */
  content: (page: Page) => Locator
}

const routes: SurfaceRoute[] = [
  { name: 'home', path: organization.home, content: (page) => homeComposer(page) },
  {
    name: 'files',
    path: filesPath,
    content: (page) => page.getByText(folderName, { exact: true }),
  },
  {
    name: 'tables',
    path: workspacePath(workspaceId, 'tables'),
    content: (page) => page.getByText('Mobile E2E table', { exact: true }),
  },
  {
    name: 'knowledge',
    path: workspacePath(workspaceId, 'knowledge'),
    content: (page) =>
      page.getByText('Upload documents to give your agents a memory they can search.', {
        exact: true,
      }),
  },
  { name: 'logs', path: logsPath, content: (page) => runLink(page) },
  {
    name: 'integrations',
    path: organization.integrations,
    content: (page) =>
      page
        .getByRole('region', { name: 'Organization integrations', exact: true })
        .getByRole('searchbox', { name: /^Search / }),
  },
  {
    name: 'settings',
    path: organization.settings,
    content: (page) => page.getByRole('button', { name: /^Theme:/ }),
  },
]
const selectedViewport = process.env.MOBILE_E2E_VIEWPORT
assert(!selectedBrowser || ['chromium', 'webkit'].includes(selectedBrowser), 'Unknown browser')
assert(
  !selectedViewport || viewports.some((viewport) => viewport.name === selectedViewport),
  'Unknown viewport'
)
const shard = /^([1-9]\d*)\/([1-9]\d*)$/.exec(process.env.MOBILE_E2E_SHARD || '1/1')
assert(shard, 'MOBILE_E2E_SHARD must be index/count, one-based')
const shardIndex = Number(shard[1]) - 1
const shardCount = Number(shard[2])
assert(shardIndex < shardCount && shardCount <= viewports.length, 'Invalid viewport shard')
assert(!selectedViewport || shardCount === 1, 'Select either a viewport or a shard')

interface CheckResult {
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  error?: string
  screenshot?: string
}

interface ViewportMeasurement {
  layoutHeight: number
  height: number
  top: number
  scale: number
}

interface ViewportRecovery {
  surface: string
  before: ViewportMeasurement
  zoomed: ViewportMeasurement | null
  restored: ViewportMeasurement | null
}

const viewportMeasurements: ViewportRecovery[] = []

interface DocumentNavigation {
  from: string
  to: string
}

const documentNavigations = new WeakMap<Page, DocumentNavigation>()

/** Tracks teardown until run resolves at document commit, then waits for the new page to load. */
async function withDocumentNavigation<T>(
  page: Page,
  destination: string,
  run: () => Promise<T>
): Promise<T> {
  const navigation = { from: page.url(), to: new URL(destination, baseUrl).href }
  documentNavigations.set(page, navigation)
  let result: T
  try {
    result = await run()
  } finally {
    if (documentNavigations.get(page) === navigation) documentNavigations.delete(page)
  }
  await page.waitForLoadState('load', { timeout: 360_000 })
  return result
}

/**
 * WebKit reports handled same-origin requests during teardown as page errors.
 * Playwright splits stackless EventSource diagnostics at the URL colon and drops its first slash.
 */
function getNavigationCancellationPath(
  error: Error,
  browserName: string,
  navigation: { from: string; to: string } | null
): string | undefined {
  if (
    browserName !== 'webkit' ||
    !navigation ||
    new URL(navigation.from).origin !== baseUrl.origin
  ) {
    return
  }
  const match = error.stack?.match(
    /^Fetch API cannot load (https?:\/\/\S+) due to access control checks\./
  )
  const eventSourceMatch =
    !error.stack && error.name === 'EventSource cannot load http'
      ? error.message.match(/^\/([^/\s]\S*) due to access control checks\.$/)
      : null
  const target = match?.[1] ?? (eventSourceMatch ? `http://${eventSourceMatch[1]}` : undefined)
  if (!target) return
  const url = new URL(target)
  return url.origin === baseUrl.origin ? url.pathname : undefined
}

async function check(name: string, page: Page | undefined, run: () => Promise<void>) {
  const started = performance.now()
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) })
    logger.info(`PASS ${name}`)
  } catch (error) {
    const screenshot = page ? resolve(artifactDirectory, `${checks.length + 1}.png`) : undefined
    if (page && screenshot) {
      await page.screenshot({ path: screenshot, caret: 'initial', timeout: 10_000 }).catch(() => {})
    }
    checks.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: getErrorMessage(error),
      screenshot,
    })
    logger.error(`FAIL ${name}`, { error: getErrorMessage(error) })
  }
}

async function seed(): Promise<string> {
  const sessionToken = generateShortId()
  const email = `${ownerId}@mobile-e2e.test`
  await sql.begin(async (tx) => {
    await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
      values (${ownerId}, 'Mobile E2E', ${email}, ${email}, true, now(), now())`
    await tx`insert into user_stats (id, user_id) values (${generateId()}, ${ownerId})`
    await tx`insert into organization (id, name, slug, kind, created_at, updated_at)
      values (${organizationId}, 'Mobile E2E organization', ${`personal-${ownerId.toLowerCase()}`}, 'personal', now(), now())`
    await tx`insert into member (id, user_id, organization_id, role)
      values (${generateId()}, ${ownerId}, ${organizationId}, 'owner')`
    await tx`insert into project (id, name, organization_id, owner_id)
      values (${workspaceId}, 'Mobile E2E project', ${organizationId}, ${ownerId})`
    await tx`insert into workspace (id, project_id, name, owner_id, organization_id, billed_account_user_id)
      values (${workspaceId}, ${workspaceId}, ${workspaceName}, ${ownerId}, ${organizationId}, ${ownerId})`
    await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type)
      values (${generateId()}, ${ownerId}, 'workspace', ${workspaceId}, 'admin')`
    await tx`insert into session (id, token, user_id, expires_at, created_at, updated_at)
      values (${generateId()}, ${sessionToken}, ${ownerId}, now() + interval '1 day', now(), now())`
    await tx`insert into folder (id, resource_type, name, user_id, workspace_id)
      values (${folderId}, 'file', ${folderName}, ${ownerId}, ${workspaceId})`
    await tx`insert into workflow (id, user_id, workspace_id, name, last_synced, created_at, updated_at)
      values (${workflowId}, ${ownerId}, ${workspaceId}, 'Mobile E2E workflow', now(), now(), now())`
    await tx`insert into chat (id, workflow_id, user_id, identifier, title, customizations)
      values (${generateId()}, ${workflowId}, ${ownerId}, ${publicChatIdentifier}, 'Mobile E2E public chat',
        ${tx.json({ welcomeMessage: 'Public mobile welcome' })})`
    await tx`insert into user_table_definitions (id, workspace_id, name, schema, created_by)
      values (${tableId}, ${workspaceId}, 'Mobile E2E table',
        ${tx.json({
          columns: [
            { id: 'col_note', name: 'Note', type: 'string' },
            { id: 'col_count', name: 'Count', type: 'number' },
          ],
        })}, ${ownerId})`
    await tx`insert into user_table_rows (id, table_id, workspace_id, data, created_by)
      values (${tableRowId}, ${tableId}, ${workspaceId}, ${tx.json({ col_note: 'Seed note', col_count: 1 })}, ${ownerId})`
    await tx`insert into workflow_execution_snapshots (id, workflow_id, state_hash, state_data)
      values (${snapshotId}, ${workflowId}, ${snapshotId}, ${tx.json({ blocks: {}, edges: [], loops: {}, parallels: {}, variables: {} })})`
    await tx`insert into workflow_execution_logs
      (id, workflow_id, workspace_id, execution_id, state_snapshot_id, level, status, trigger, started_at, ended_at, total_duration_ms, execution_data)
      values (${generateId()}, ${workflowId}, ${workspaceId}, ${generateId()}, ${snapshotId}, 'info', 'completed', 'manual', now() - interval '1 second', now(), 1000,
        ${tx.json({ finalOutput: { result: 'Mobile E2E complete' }, workflowInput: {}, traceSpans: [] })})`
    await tx`insert into copilot_chats (id, user_id, organization_id, type, title, config, resources)
      values (${chatId}, ${ownerId}, ${organizationId}, 'mothership', 'Mobile E2E conversation',
        ${tx.json({ conversationMode: 'agent' })},
        ${tx.json([{ type: 'table', id: tableId, title: 'Mobile E2E table', workspaceId }])})`
    const messages = [
      { role: 'user', content: 'Show the project summary and working files.' },
      {
        role: 'assistant',
        content: `Mobile project summary\n\nHere is the summary with a deliberately long reference: https://example.test/${'reference'.repeat(24)}\n\n| Project | Status | Owner | Next milestone |\n| --- | --- | --- | --- |\n| Mobile experience | In review | Product and engineering | Verify on phones and desktop |\n\n\`\`\`json\n{"project":"mobile","description":"${'A long code value. '.repeat(18)}"}\n\`\`\``,
      },
    ] as const
    for (const [seq, message] of messages.entries()) {
      const messageId = generateId()
      await tx`insert into copilot_messages (id, chat_id, message_id, role, content, seq)
        values (${generateId()}, ${chatId}, ${messageId}, ${message.role},
          ${tx.json({ id: messageId, ...message, timestamp: new Date().toISOString() })}, ${seq + 1})`
    }
  })
  return encodeURIComponent(`${sessionToken}.${await makeSignature(sessionToken, authSecret)}`)
}

function compactNavigation(width: number): boolean {
  return width <= COMPACT_NAVIGATION_WIDTH
}

function sidebar(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Platform sidebar', exact: true })
}

/** The shell's opener: it opens the drawer at narrow widths and expands a collapsed sidebar. */
function openNavigation(page: Page): Locator {
  return page.getByRole('button', { name: 'Expand sidebar', exact: true })
}

function homeComposer(page: Page): Locator {
  return page.getByRole('textbox', {
    name: 'Ask about your business, or give Sim something to do…',
    exact: true,
  })
}

function runLink(page: Page): Locator {
  return page
    .getByRole('list', { name: 'Runs', exact: true })
    .getByRole('link', { name: /^Mobile E2E workflow, / })
}

function folderActions(page: Page): Locator {
  return page.getByRole('button', { name: `Actions for ${folderName}`, exact: true })
}

/** React Flow's wrapper, the workflow editor's canvas. */
function workflowCanvas(page: Page): Locator {
  return page.getByRole('main').getByRole('application')
}

/**
 * The shell's content pane, which holds every page: the outermost scroll viewport outside the
 * sidebar and its drawer. Pages render no shared landmark, so this reads the pane by the
 * `data-scroll-axis` the shell's edge-fade measurement sets on it. React parks a streamed segment
 * in a hidden `<div id="S:n">`, so only a pane with a size counts.
 */
async function contentPaneBounds(page: Page) {
  return page.evaluate(() => {
    for (const element of document.querySelectorAll('[data-scroll-axis]')) {
      if (element.closest('aside, dialog')) continue
      const { x, y, width, height } = element.getBoundingClientRect()
      if (width > 0 && height > 0) return { x, y, width, height }
    }
    return null
  })
}

async function visit(page: Page, path: string, content?: Locator) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().isNavigationRequest() && new URL(response.url()).pathname === path,
      { timeout: 360_000 }
    ),
    withDocumentNavigation(page, path, () =>
      page.goto(path, { waitUntil: 'commit', timeout: 360_000 })
    ),
  ])
  assert(response.status() < 400, `Could not load ${path}: ${response.status()}`)
  assert(isPathOrDescendant(new URL(page.url()).pathname, path), 'Session was rejected')
  await expect.poll(async () => (await contentPaneBounds(page)) !== null).toBe(true)
  await expect(page.getByText('Application error', { exact: false })).toHaveCount(0)
  if (content) await expect(content).toBeVisible({ timeout: 120_000 })
}

async function expectContained(page: Page, locator: Locator) {
  await expect(locator).toBeVisible()
  await expect
    .poll(
      async () => {
        const bounds = await locator.boundingBox()
        const viewport = page.viewportSize()
        if (!bounds || !viewport) return false
        return (
          bounds.x >= -1 &&
          bounds.y >= -1 &&
          bounds.x + bounds.width <= viewport.width + 1 &&
          bounds.y + bounds.height <= viewport.height + 1
        )
      },
      { message: 'The interactive surface must fit the viewport' }
    )
    .toBe(true)
}

async function capture(page: Page, name: string) {
  const path = resolve(artifactDirectory, `${name}.png`)
  await page.screenshot({ path, caret: 'initial' })
  screenshots.push(path)
}

async function expectNoOverflow(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
            window.innerWidth
        ),
      {
        message: 'The page must not scroll horizontally',
      }
    )
    .toBeLessThanOrEqual(1)
  const pane = await contentPaneBounds(page)
  assert(pane && pane.width > 0 && pane.x >= -1, 'The content must have usable horizontal space')
  assert(pane.x + pane.width <= (page.viewportSize()?.width ?? 0) + 1, 'Content extends offscreen')
}

/** Exercises native visual-viewport recovery without another layout resize. */
async function expectVisualViewportRecovery(page: Page, surface: string, targets: Locator[]) {
  const original = page.viewportSize()
  assert(original)
  const session = await page.context().newCDPSession(page)
  const measure = () =>
    page.evaluate(() => {
      const viewport = window.visualViewport
      if (!viewport) throw new Error('Visual viewport is unavailable')
      return {
        layoutHeight: window.innerHeight,
        height: viewport.height,
        top: viewport.offsetTop,
        scale: viewport.scale,
      }
    })
  const settle = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    )
  const measurements: ViewportRecovery = {
    surface,
    before: await measure(),
    zoomed: null,
    restored: null,
  }
  try {
    await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 })
    await page.setViewportSize({ width: original.width, height: 400 })
    await settle()
    const zoomed = await measure()
    measurements.zoomed = zoomed
    assert.equal(zoomed.scale, 2)
    assert.equal(zoomed.layoutHeight, 400)
    await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
    await settle()
    const restored = await measure()
    measurements.restored = restored
    assert.equal(
      restored.layoutHeight,
      zoomed.layoutHeight,
      'Recovery must not resize the layout viewport'
    )
    assert.equal(restored.scale, 1)
    assert(
      restored.height > zoomed.height + 100,
      'Native visual viewport must resize independently'
    )
    try {
      for (const target of targets) await expectContained(page, target)
    } finally {
      await capture(page, `chromium-phone-visual-viewport-${surface}`)
    }
  } finally {
    viewportMeasurements.push(measurements)
    await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
    await page.setViewportSize(original)
    await settle()
    await session.detach()
  }
}

async function expectDesktopPreference(context: BrowserContext) {
  const cookie = (await context.cookies()).find((entry) => entry.name === 'sidebar_collapsed')
  assert.equal(cookie?.value, '0', 'Mobile navigation must preserve desktop expansion preference')
}

async function exerciseViewport(
  browser: Browser,
  browserName: string,
  cookie: string,
  viewport: (typeof viewports)[number]
) {
  const context = await browser.newContext({
    baseURL: baseUrl.origin,
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.touch,
    hasTouch: viewport.touch,
    colorScheme: viewport.name === 'android' ? 'dark' : 'light',
    reducedMotion:
      viewport.name === 'phone' || viewport.name === 'desktop' ? 'no-preference' : 'reduce',
    storageState: {
      cookies: [
        {
          name: 'better-auth.session_token',
          value: cookie,
          domain: baseUrl.hostname,
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
        {
          name: 'sidebar_collapsed',
          value: '0',
          domain: baseUrl.hostname,
          path: '/',
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [
        {
          origin: baseUrl.origin,
          localStorage: [
            {
              name: 'panel-state',
              value: JSON.stringify({
                state: { panelWidth: 520, activeTab: 'toolbar' },
                version: 0,
              }),
            },
          ],
        },
      ],
    },
  })
  context.setDefaultTimeout(20_000)
  const nativeErrors: string[] = []
  await context.exposeBinding('reportMobileBrowserError', (_source, message: unknown) => {
    if (typeof message === 'string' && nativeErrors.length < 20) nativeErrors.push(message)
  })
  await context.addInitScript(() => {
    const report = (message: string) => {
      const windowWithReporter = window as typeof window & {
        reportMobileBrowserError: (message: string) => Promise<void>
      }
      void windowWithReporter
        .reportMobileBrowserError(`${new Date().toISOString()} ${location.pathname}: ${message}`)
        .catch(() => {})
    }
    window.addEventListener('error', (event) => report(event.message))
    window.addEventListener('unhandledrejection', (event) => report(String(event.reason)))
  })
  await context.tracing.start({ screenshots: true, snapshots: true })
  const page = await context.newPage()
  const pageErrors: string[] = []
  page.on('pageerror', (error) => {
    const pendingNavigation = documentNavigations.get(page) ?? null
    const path = getNavigationCancellationPath(error, browserName, pendingNavigation)
    if (path && pendingNavigation) {
      if (navigationDiagnostics.length < 100) {
        navigationDiagnostics.push({
          browser: browserName,
          viewport: viewport.name,
          timestamp: new Date().toISOString(),
          ...pendingNavigation,
          path,
          error: error.message,
        })
      }
      return
    }
    if (pageErrors.length < 20) pageErrors.push(error.message)
  })
  const mints = socketTokenMints.get(browserName) ?? { minted: 0, rateLimited: 0 }
  socketTokenMints.set(browserName, mints)
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (url.origin === baseUrl.origin && url.pathname === SOCKET_TOKEN_PATH) {
      if (response.ok()) mints.minted += 1
      if (response.status() === 429 && response.headers()['retry-after']) {
        mints.rateLimited += 1
        return
      }
    }
    if (url.origin === baseUrl.origin && response.status() >= 400 && httpErrors.length < 100) {
      httpErrors.push({ browser: browserName, status: response.status(), path: url.pathname })
    }
  })
  page.on('requestfailed', (request) => {
    const url = new URL(request.url())
    if (url.origin === baseUrl.origin && requestFailures.length < 100) {
      requestFailures.push({
        browser: browserName,
        viewport: viewport.name,
        path: url.pathname,
        error: request.failure()?.errorText,
      })
    }
  })
  const prefix = `${browserName}/${viewport.name}`
  const initialFailures = checks.filter((result) => result.status === 'failed').length
  try {
    const compact = compactNavigation(viewport.width)
    for (const route of routes) {
      await check(`${prefix}/${route.name} fits the screen`, page, async () => {
        await visit(page, route.path, route.content(page))
        await expectNoOverflow(page)
        if (compact) {
          await expect(openNavigation(page)).toBeVisible()
          await expect(sidebar(page)).toBeHidden()
        } else {
          await expect(openNavigation(page)).toBeHidden()
          await expect(sidebar(page)).toBeVisible()
        }
        if (
          viewport.name === 'phone' ||
          viewport.name === 'desktop' ||
          (viewport.name === 'wide-desktop' && route.name === 'home')
        ) {
          await capture(page, `${browserName}-${viewport.name}-${route.name}`)
        }
      })
    }

    await check(
      `${prefix}/a personal organization manages workspace apps and skills in Integrations`,
      page,
      async () => {
        const center = page.getByRole('region', { name: 'Organization integrations', exact: true })
        // Legacy's workspace Skills URL lands on the organization's Skills tab for that workspace.
        await withDocumentNavigation(page, organization.integrations, () =>
          page.goto(workspacePath(workspaceId, 'skills'), { waitUntil: 'commit' })
        )
        await expect.poll(() => new URL(page.url()).pathname).toBe(organization.integrations)
        await expect(
          center.getByRole('button', { name: 'Create skill', exact: true })
        ).toBeVisible()
        await expect(center.getByRole('button', { name: /^Workspace:/ })).toBeVisible()
        await visit(page, organization.integrations, center.getByRole('searchbox'))
        await expect(center.getByRole('link', { name: 'Skills', exact: true })).toBeVisible()
        await expect(center.getByRole('link', { name: 'Credentials', exact: true })).toBeVisible()
        await expectNoOverflow(page)
      }
    )

    if (viewport.name === 'desktop') {
      await check(`${prefix}/a saved draft returns after a reload`, page, async () => {
        const draft = 'A draft saved before reloading'
        const storedDrafts = () =>
          page.evaluate(() => localStorage.getItem('mothership-drafts:v1') ?? '')
        const composer = homeComposer(page)
        await visit(page, organization.home, composer)
        await composer.fill(draft)
        await expect.poll(storedDrafts).toContain(draft)
        const pageErrorCount = pageErrors.length
        const nativeErrorCount = nativeErrors.length
        await visit(page, organization.home, composer)
        await expect(composer).toHaveValue(draft)
        assert.deepEqual(
          [...pageErrors.slice(pageErrorCount), ...nativeErrors.slice(nativeErrorCount)],
          [],
          'Restoring a saved draft must hydrate cleanly'
        )
        await composer.fill('')
        await expect.poll(storedDrafts).not.toContain(draft)
      })

      for (const width of [390, viewport.width]) {
        await check(
          `${prefix}/${width}px draft scroll boundaries preserve the surrounding page`,
          page,
          async () => {
            const composer = homeComposer(page)
            await visit(page, organization.home, composer)
            const heading = page.getByRole('heading', { level: 1 })
            const readScroll = () =>
              composer.evaluate((element) => {
                let ancestor = element.parentElement
                while (ancestor) {
                  if (
                    ancestor.scrollHeight > ancestor.clientHeight &&
                    getComputedStyle(ancestor).overflowY === 'auto'
                  ) {
                    const bounds = ancestor.getBoundingClientRect()
                    return {
                      top: ancestor.scrollTop,
                      max: ancestor.scrollHeight - ancestor.clientHeight,
                      x: bounds.x + bounds.width / 2,
                      y: bounds.y + bounds.height / 2,
                    }
                  }
                  ancestor = ancestor.parentElement
                }
                throw new Error('The long draft must have a scrollable editor')
              })
            const settle = () =>
              page.evaluate(
                () =>
                  new Promise<void>((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
                  )
              )
            try {
              await page.setViewportSize({ width, height: 520 })
              await composer.fill('A draft line\n'.repeat(30))
              await expect
                .poll(async () => (await readScroll().catch(() => null))?.max ?? 0, {
                  message: 'The draft must overflow its editor',
                })
                .toBeGreaterThan(100)
              const editor = await readScroll()
              await page.mouse.move(editor.x, editor.y)
              await page.mouse.wheel(0, 10_000)
              await expect
                .poll(
                  async () => {
                    const scroll = await readScroll()
                    return Math.abs(scroll.top - scroll.max)
                  },
                  { message: 'The draft must reach its lower scroll boundary' }
                )
                .toBeLessThanOrEqual(1)
              const before = await heading.boundingBox()
              assert(before)
              await page.mouse.wheel(0, 600)
              await settle()
              const after = await heading.boundingBox()
              assert(after)
              // The composer contains its own scroll at every width; Home scrolls from outside it.
              assert(Math.abs(after.y - before.y) <= 1, 'Scrolling past a draft must not move Home')
              await page.mouse.move(width - 2, 300)
              await page.mouse.wheel(0, 600)
              await expect
                .poll(async () => (await heading.boundingBox())?.y ?? before.y, {
                  message: 'Scrolling beside the draft must move Home',
                })
                .toBeLessThan(before.y - 10)
              await capture(page, `${browserName}-${width}-draft-scroll`)
            } finally {
              await composer.fill('')
              await page.setViewportSize({ width: viewport.width, height: viewport.height })
            }
          }
        )
      }
    }

    if (compact) {
      await check(
        `${prefix}/navigation opens, dismisses, and preserves desktop preferences`,
        page,
        async () => {
          await visit(page, filesPath, folderActions(page))
          const navigation = sidebar(page)
          const opener = openNavigation(page)
          await opener.focus()
          const modifier = await page.evaluate(() =>
            /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent) ? 'Meta' : 'Control'
          )
          await page.keyboard.press(`${modifier}+b`)
          await expectContained(page, navigation)
          await expectDesktopPreference(context)
          await page.keyboard.press(`${modifier}+b`)
          await expect(navigation).toBeHidden()
          await expectDesktopPreference(context)
          await opener.tap()
          await expectContained(page, navigation)
          if (viewport.name === 'phone') await capture(page, `${browserName}-phone-navigation`)
          await navigation.getByRole('link', { name: 'Home', exact: true }).tap()
          await expect(page).toHaveURL((url) => url.pathname === organization.home, {
            timeout: 120_000,
          })
          await expect(homeComposer(page)).toBeVisible()
          await expect(navigation).toBeHidden()
          await opener.tap()
          await navigation.getByRole('button', { name: 'Collapse sidebar', exact: true }).tap()
          await expect(navigation).toBeHidden()
          await opener.tap()
          await navigation
            .getByRole('region', { name: 'Workspaces', exact: true })
            .getByRole('link', { name: workspaceName, exact: true })
            .tap()
          await expect(page).toHaveURL((url) =>
            isPathOrDescendant(url.pathname, workspaceEntry(workspaceId))
          )
          await expect(navigation).toBeHidden()
          await page
            .getByRole('navigation', { name: `${workspaceName} pages`, exact: true })
            .getByRole('link', { name: 'Files', exact: true })
            .tap()
          await expect(page).toHaveURL((url) => url.pathname === filesPath, {
            timeout: 120_000,
          })
          await expect(navigation).toBeHidden()
          await expect(folderActions(page)).toBeVisible()
          await expectNoOverflow(page)
          await expectDesktopPreference(context)
        }
      )

      await check(
        `${prefix}/touch row actions open without hover or a right click`,
        page,
        async () => {
          const actions = folderActions(page)
          await visit(page, filesPath, actions)
          // A short landscape viewport puts the first row below the fold of the scrolling page.
          await actions.scrollIntoViewIfNeeded()
          await expectContained(page, actions)
          await actions.tap()
          await expect(page.getByRole('menuitem', { name: 'Rename', exact: true })).toBeVisible()
          await page.keyboard.press('Escape')
          await expect(page.getByRole('menu')).toHaveCount(0)
        }
      )
    }

    await check(
      `${prefix}/dialog remains reachable with desktop sidebar and panel preferences saved`,
      page,
      async () => {
        await visit(page, workspacePath(workspaceId, 'knowledge'))
        const newBase = page.getByRole('button', { name: 'New base', exact: true }).first()
        await expect(newBase).toBeEnabled({ timeout: 120_000 })
        await newBase.click()
        const dialog = page.getByRole('dialog', { name: 'New knowledge base', exact: true })
        await expectContained(page, dialog)
        const field = dialog.getByPlaceholder('Enter knowledge base name')
        await field.fill('Mobile E2E draft')
        if (viewport.touch && compact) {
          assert.equal(
            await field.evaluate((element) => getComputedStyle(element).fontSize),
            '16px'
          )
        }
        if (browserName === 'chromium' && viewport.name === 'phone') {
          await expectVisualViewportRecovery(page, 'modal', [
            dialog,
            dialog.getByRole('button', { name: 'Close', exact: true }),
          ])
        }
        if (viewport.name === 'phone' || viewport.name === 'desktop') {
          await capture(page, `${browserName}-${viewport.name}-knowledge-modal`)
        }
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
        await expect(dialog).toHaveCount(0)
        await expect(
          page.getByRole('button', { name: 'New base', exact: true }).first()
        ).toBeEnabled()
      }
    )

    const chatComposer = page.getByRole('textbox', { name: 'Ask a follow-up…', exact: true })
    const chatPanel = page.getByRole('complementary', { name: 'Chat panel', exact: true })
    const openChatPanel = page.getByRole('button', { name: 'Open chat panel', exact: true })
    const closeChatPanel = page.getByRole('button', { name: 'Close chat panel', exact: true })
    /** The chat sets its panel beside the conversation only when the content pane exceeds 48rem. */
    const chatSideBySide = async () => {
      const pane = await contentPaneBounds(page)
      assert(pane, 'The content pane must be measurable')
      return pane.width > COMPACT_NAVIGATION_WIDTH
    }
    const openChatResources = async () => {
      await visit(page, organization.chat(chatId))
      await expect(page.getByRole('button', { name: /^(Open|Close) chat panel$/ })).toBeVisible()
      const summary = page.getByText('Mobile project summary', { exact: false })
      await expect
        .poll(async () => (await summary.isVisible()) || (await closeChatPanel.isVisible()))
        .toBe(true)
      return summary
    }

    await check(
      `${prefix}/chat and resources adapt without losing an unsent draft`,
      page,
      async () => {
        const summary = await openChatResources()
        await expect(summary).toBeVisible()
        await expectNoOverflow(page)
        await chatComposer.fill('Keep this draft')
        if (compact) {
          const send = page.getByRole('button', { name: 'Send message', exact: true })
          await expectContained(page, send)
          // Emir's filled icon keeps its drawn face on touch; only its target grows past it.
          const bounds = await send.boundingBox()
          assert(
            bounds &&
              bounds.width === COMPACT_CONTROL_HEIGHT &&
              bounds.height === COMPACT_CONTROL_HEIGHT,
            `Send keeps its drawn face: ${JSON.stringify(bounds)}`
          )
          await chatComposer.press('Enter')
          await expect(chatComposer).toHaveValue('Keep this draft\n')
        }
        if (await openChatPanel.isVisible()) await openChatPanel.click()
        await expectContained(page, chatPanel)
        const resource = chatPanel.getByRole('link', { name: 'Open Mobile E2E table', exact: true })
        await expect(resource).toBeVisible()
        await expect(resource).toHaveAttribute('href', tablePath)
        await expectNoOverflow(page)
        if (
          viewport.name === 'phone' ||
          viewport.name === 'android' ||
          viewport.name === 'desktop' ||
          viewport.name === 'wide-desktop'
        ) {
          await capture(page, `${browserName}-${viewport.name}-resources`)
        }
        if (await chatSideBySide()) {
          await expectContained(page, chatComposer)
          const composerBounds = await chatComposer.boundingBox()
          const resourceBounds = await chatPanel.boundingBox()
          assert(composerBounds && resourceBounds)
          assert(
            composerBounds.x + composerBounds.width <= resourceBounds.x,
            'Wide screens must retain side-by-side chat and resources'
          )
          await closeChatPanel.click()
        } else {
          await expect(chatComposer).toBeHidden()
          await expectContained(page, closeChatPanel)
          await closeChatPanel.click()
        }
        await expect(chatPanel).toBeHidden()
        await expect(chatComposer).toHaveValue(compact ? 'Keep this draft\n' : 'Keep this draft')
        if (
          viewport.name === 'phone' ||
          viewport.name === 'android' ||
          viewport.name === 'desktop' ||
          viewport.name === 'wide-desktop'
        ) {
          await capture(page, `${browserName}-${viewport.name}-chat`)
        }
        if (browserName === 'chromium' && viewport.name === 'phone') {
          await expectVisualViewportRecovery(page, 'composer', [
            chatComposer,
            page.getByRole('button', { name: 'Send message', exact: true }),
          ])
        }
        if (compact) {
          await page.setViewportSize({
            width: viewport.width,
            height: Math.min(400, Math.round(viewport.height * 0.65)),
          })
          await chatComposer.focus()
          await expectContained(page, chatComposer)
          await expectContained(
            page,
            page.getByRole('button', { name: 'Send message', exact: true })
          )
          await page.setViewportSize({ width: viewport.width, height: viewport.height })
        }
        await chatComposer.fill('')
        if (!viewport.touch) {
          await chatComposer.press('Enter')
          await expect(chatComposer).toHaveValue('')
          await chatComposer.press('Shift+Enter')
          await expect(chatComposer).toHaveValue('\n')
          await chatComposer.fill('')
        }
        const rows =
          await sql`select count(*)::int as count from copilot_messages where chat_id = ${chatId}`
        assert.equal(rows[0]?.count, 2, 'Mobile Enter must not send a message')
      }
    )

    if (viewport.name === 'desktop' || viewport.name === 'wide-desktop') {
      await check(
        `${prefix}/chat resources resize within their accessible range`,
        page,
        async () => {
          await openChatResources()
          if (await openChatPanel.isVisible()) await openChatPanel.click()
          await expectContained(page, chatPanel)
          assert(await chatSideBySide(), 'Wide screens must set resources beside the chat')
          const divider = page.getByRole('separator', {
            name: 'Resize resource view',
            exact: true,
          })
          try {
            for (const key of ['Home', 'End']) {
              await divider.press(key)
              await expect(async () => {
                const measurement = await divider.evaluate((element) => {
                  const panel = document.querySelector('aside[aria-label="Chat panel"]')
                  if (!panel) throw new Error('Resource panel is unavailable')
                  return {
                    width: panel.getBoundingClientRect().width,
                    min: Number.parseFloat(element.getAttribute('aria-valuemin') ?? ''),
                    now: Number.parseFloat(element.getAttribute('aria-valuenow') ?? ''),
                    max: Number.parseFloat(element.getAttribute('aria-valuemax') ?? ''),
                  }
                })
                const { width, min, now, max } = measurement
                assert(
                  min <= now && now <= max,
                  `The panel width must stay within its accessible range: ${JSON.stringify(measurement)}`
                )
                assert(
                  Math.abs(now - width) <= 1,
                  `The resize value must describe the visible panel: ${JSON.stringify(measurement)}`
                )
              }).toPass({ timeout: 20_000 })
              await expectContained(page, chatComposer)
              await expectNoOverflow(page)
            }
          } finally {
            await closeChatPanel.click()
          }
        }
      )
    }

    if (viewport.name === 'android') {
      await check(
        `${prefix}/public chat attachments leave the composer reachable`,
        page,
        async () => {
          const chatPath = `/chat/${publicChatIdentifier}`
          const response = await withDocumentNavigation(page, chatPath, () =>
            page.goto(chatPath, { waitUntil: 'commit', timeout: 360_000 })
          )
          assert(response && response.status() < 400)
          await expect(page.getByText('Public mobile welcome', { exact: true })).toBeVisible({
            timeout: 120_000,
          })
          const fileChooser = page.waitForEvent('filechooser')
          await page.getByRole('button', { name: 'Attach files', exact: true }).tap()
          await (await fileChooser).setFiles([
            {
              name: 'mobile-image.png',
              mimeType: 'image/png',
              buffer: Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=',
                'base64'
              ),
            },
            ...Array.from({ length: 14 }, (_, index) => ({
              name: `mobile-${index}.txt`,
              mimeType: 'text/plain',
              buffer: Buffer.from('Mobile attachment fixture'),
            })),
          ])
          const removeButtons = page.getByRole('button', { name: /^Remove mobile-/ })
          await expect(removeButtons).toHaveCount(15)
          const composer = page.getByRole('textbox', { name: 'Message', exact: true })
          await composer.fill('A long draft line\n'.repeat(30))
          await page.setViewportSize({ width: viewport.width, height: 400 })
          await composer.focus()
          await expectContained(page, page.getByRole('group', { name: 'Chat message input' }))
          await expectContained(
            page,
            page.getByRole('button', { name: 'Send message', exact: true })
          )
          await expect
            .poll(async () => (await composer.boundingBox())?.height)
            .toBeLessThanOrEqual(101)
          await page.getByRole('button', { name: 'Remove mobile-image.png', exact: true }).tap()
          await expect(removeButtons).toHaveCount(14)
          await page.getByRole('button', { name: 'Remove mobile-0.txt', exact: true }).tap()
          await expect(removeButtons).toHaveCount(13)
          await expect(composer).toHaveValue('A long draft line\n'.repeat(30))
          await capture(page, `${browserName}-public-attachments`)
          await page.setViewportSize({ width: viewport.width, height: viewport.height })
        }
      )
    }

    if (!viewport.touch) {
      await check(
        `${prefix}/desktop sidebar collapse and expansion preserve its width`,
        page,
        async () => {
          await visit(page, filesPath, folderActions(page))
          const navigation = sidebar(page)
          const width = (await navigation.boundingBox())?.width
          assert(width, 'The expanded sidebar must have a width')
          await navigation.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
          await expect(navigation).toBeHidden()
          await openNavigation(page).click()
          await expect.poll(async () => (await navigation.boundingBox())?.width).toBe(width)
          await expectDesktopPreference(context)
          await expectNoOverflow(page)
        }
      )
    }

    if (viewport.name === 'phone') {
      await check(
        `${prefix}/table edits persist and configuration panels remain reachable by touch`,
        page,
        async () => {
          const cell = page.locator(`[data-row-id="${tableRowId}"][data-col="0"]`)
          await visit(page, tablePath, cell)
          await cell.tap()
          const editor = page.getByRole('dialog', { name: 'Expanded view of Note', exact: true })
          await expect(editor).toHaveCount(0)
          await cell.tap()
          await expectContained(page, editor)
          const value = `Edited on ${browserName} mobile`
          await editor.getByRole('textbox').fill(value)
          const [saved] = await Promise.all([
            page.waitForResponse(
              (response) =>
                response.request().method() === 'PATCH' &&
                new URL(response.url()).pathname === `/api/table/${tableId}/rows/${tableRowId}`,
              { timeout: 120_000 }
            ),
            editor.getByRole('button', { name: 'Save', exact: true }).tap(),
          ])
          assert.equal(saved.status(), 200, 'Saving the cell must succeed over HTTP')
          await expect(editor).toHaveCount(0)
          await expect
            .poll(async () => {
              const rows =
                await sql`select data->>'col_note' as note from user_table_rows where id = ${tableRowId}`
              return rows[0]?.note
            })
            .toBe(value)
          await withDocumentNavigation(page, page.url(), () =>
            page.reload({ waitUntil: 'commit', timeout: 360_000 })
          )
          await expect(cell).toHaveText(value, { timeout: 120_000 })
          /** A configuration panel takes the grid's whole row on a phone instead of squeezing beside it. */
          const expectFillsRow = (panel: Locator) =>
            expect
              .poll(() =>
                panel.evaluate((element) => {
                  const row = element.parentElement?.getBoundingClientRect().width ?? 0
                  return Math.abs(element.getBoundingClientRect().width - row)
                })
              )
              .toBeLessThanOrEqual(1)
          await page.getByRole('button', { name: 'Column options', exact: true }).first().tap()
          await expectContained(page, page.getByRole('menu'))
          await page.getByRole('menuitem', { name: 'Edit column', exact: true }).tap()
          const columnConfig = page.getByRole('complementary', {
            name: 'Configure column',
            exact: true,
          })
          await expectContained(page, columnConfig)
          await expectFillsRow(columnConfig)
          await capture(page, `${browserName}-phone-column-config`)
          await columnConfig.getByRole('button', { name: 'Close', exact: true }).tap()
          await expect(columnConfig).toBeHidden()
          for (const [name, panelName] of [
            ['Workflow', 'Add workflow'],
            ['Enrichments', 'Enrichments'],
          ] as const) {
            await page.getByRole('button', { name: 'New column', exact: true }).first().tap()
            await page.getByRole('menuitem', { name, exact: true }).tap()
            const configuration = page.getByRole('complementary', { name: panelName, exact: true })
            await expectContained(page, configuration)
            await expectFillsRow(configuration)
            await capture(page, `${browserName}-phone-${name.toLowerCase()}-config`)
            await configuration.getByRole('button', { name: 'Close', exact: true }).tap()
            await expect(configuration).toBeHidden()
          }
          await expectNoOverflow(page)
        }
      )

      await check(`${prefix}/run details fill the phone and can be dismissed`, page, async () => {
        await visit(page, logsPath, runLink(page))
        await runLink(page).tap()
        await expect(page).toHaveURL(
          (url) => url.pathname.startsWith(`${logsPath}/`) && url.pathname !== `${logsPath}/`
        )
        const trace = page.getByRole('region', { name: /^Run \S+ trace$/ })
        const step = page.getByRole('complementary', { name: 'Selected step', exact: true })
        await expect(trace).toBeVisible()
        await expect(step.getByText('Mobile E2E complete', { exact: false })).toBeVisible({
          timeout: 120_000,
        })
        await expect
          .poll(
            async () => {
              const reading = await trace.boundingBox()
              const rail = await step.boundingBox()
              return Boolean(
                reading &&
                  rail &&
                  reading.x >= -1 &&
                  reading.x + reading.width <= viewport.width + 1 &&
                  rail.x + rail.width <= viewport.width + 1 &&
                  rail.y >= reading.y + reading.height - 1
              )
            },
            { message: 'A phone must stack the step beneath the run, inside the screen' }
          )
          .toBe(true)
        await expectNoOverflow(page)
        await capture(page, `${browserName}-phone-run-details`)
        await page
          .getByRole('navigation', { name: 'Logs navigation', exact: true })
          .getByRole('link', { name: 'Logs', exact: true })
          .tap()
        await expect(page).toHaveURL((url) => url.pathname === logsPath)
        await expect(trace).toHaveCount(0)
        await expect(runLink(page)).toBeVisible()
      })

      await check(`${prefix}/standalone settings sections remain accessible`, page, async () => {
        const response = await withDocumentNavigation(page, '/selfhost/settings/general', () =>
          page.goto('/selfhost/settings/general', { waitUntil: 'commit', timeout: 360_000 })
        )
        assert(response && response.status() < 400)
        await expect(page.getByRole('button', { name: 'Theme', exact: true })).toBeVisible({
          timeout: 120_000,
        })
        const navigation = page.getByRole('navigation', {
          name: 'Settings navigation',
          exact: true,
        })
        await expectContained(page, navigation)
        await navigation.getByRole('button', { name: 'General', exact: true }).tap()
        await expectContained(page, page.getByRole('menu'))
        await page.getByRole('menuitemradio', { name: 'General', exact: true }).tap()
        await expect(page.getByRole('menu')).toHaveCount(0)
        await expect(page).toHaveURL(/\/selfhost\/settings\/general/)
        await expect(navigation).toBeVisible()
        await capture(page, `${browserName}-phone-standalone-settings`)
        await navigation.getByRole('button', { name: 'Sim home', exact: true }).tap()
        await page.waitForURL((url) => url.pathname === '/' && url.searchParams.has('home'), {
          waitUntil: 'load',
          timeout: 120_000,
        })
      })
    }

    if (viewport.name === 'phone' || viewport.name === 'tablet') {
      await check(
        `${prefix}/rotation restores desktop sidebar and preserves navigation`,
        page,
        async () => {
          await visit(page, filesPath, folderActions(page))
          const navigation = sidebar(page)
          let width: number | undefined
          if (viewport.name === 'tablet') {
            width = (await navigation.boundingBox())?.width
            assert(width, 'The expanded sidebar must have a width')
            await navigation.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
            await expect(navigation).toBeHidden()
            await openNavigation(page).click()
            await expectDesktopPreference(context)
          }
          await page.setViewportSize({ width: 1440, height: 1000 })
          await expect(navigation).toBeVisible()
          const desktopWidth = (await navigation.boundingBox())?.width
          assert(desktopWidth, 'The restored sidebar must have a width')
          if (width) assert.equal(desktopWidth, width, 'The sidebar keeps one width')
          await expectDesktopPreference(context)
          await page.setViewportSize({ width: viewport.width, height: viewport.height })
          if (compact) await expect(navigation).toBeHidden()
          else await expect(navigation).toBeVisible()
          await expectDesktopPreference(context)
          await expectNoOverflow(page)
        }
      )
      if (viewport.name === 'phone') {
        await check(
          `${prefix}/workflow canvas and panel share the phone and unlock`,
          page,
          async () => {
            const canvas = workflowCanvas(page)
            await visit(page, workflowPath, canvas)
            const panel = page.getByRole('complementary', { name: 'Workflow panel', exact: true })
            await capture(page, `${browserName}-${viewport.name}-workflow-canvas`)
            await expectContained(page, canvas)
            await expectContained(page, panel)
            await capture(page, `${browserName}-${viewport.name}-workflow-panel`)
            await expect
              .poll(async () => {
                const canvasBounds = await canvas.boundingBox()
                const panelBounds = await panel.boundingBox()
                const content = await contentPaneBounds(page)
                return canvasBounds && panelBounds && content
                  ? panelBounds.y >= canvasBounds.y + canvasBounds.height - 1 &&
                      canvasBounds.width / content.width > 0.95
                  : false
              })
              .toBe(true)
            await sql`update workflow set locked = true where id = ${workflowId}`
            await withDocumentNavigation(page, page.url(), () =>
              page.reload({ waitUntil: 'commit', timeout: 360_000 })
            )
            const notifications = page.getByRole('region', {
              name: 'Notification stack',
              exact: true,
            })
            const notice = notifications.getByRole('article', {
              name: 'This workflow is locked',
              exact: true,
            })
            const showAll = notifications.getByRole('button', { name: /^Notifications?\b/ })
            await expect
              .poll(async () => (await notice.isVisible()) || (await showAll.isVisible()))
              .toBe(true)
            // The tray minimizes a notice it has shown once nobody engages with it.
            if (!(await notice.isVisible())) await showAll.tap()
            await expectContained(page, notice)
            const unlock = notice.getByRole('button', { name: 'Unlock Workflow', exact: true })
            await expectContained(page, unlock)
            await capture(page, `${browserName}-phone-workflow-notification`)
            const [unlocked] = await Promise.all([
              page.waitForResponse(
                (response) =>
                  response.request().method() === 'PUT' &&
                  new URL(response.url()).pathname === `/api/workflows/${workflowId}`
              ),
              unlock.tap(),
            ])
            assert.equal(unlocked.status(), 200, 'Unlocking the workflow must succeed over HTTP')
            await expect
              .poll(async () => {
                const rows = await sql`select locked from workflow where id = ${workflowId}`
                return rows[0]?.locked
              })
              .toBe(false)
            await expectNoOverflow(page)
          }
        )
      }
    }

    if (viewport.name === 'phone' || viewport.name === 'tablet' || viewport.name === 'desktop') {
      await check(
        `${prefix}/workflow uses compact phone controls and regular desktop panels`,
        page,
        async () => {
          const canvas = workflowCanvas(page)
          await visit(page, workflowPath, canvas)
          const panel = page.getByRole('complementary', { name: 'Workflow panel', exact: true })
          await expectContained(page, panel)
          const editor = page.getByRole('main')
          const actions = editor.getByRole('button', { name: 'Workflow actions', exact: true })
          // The control bar precedes the panel, whose toolbar lists blocks by name.
          const run = editor.getByRole('button', { name: 'Run', exact: true }).first()
          const deploy = editor.getByRole('button', { name: 'Deploy', exact: true }).first()
          for (const control of [run, deploy]) {
            await expectContained(page, control)
            const bounds = await control.boundingBox()
            assert(
              bounds && bounds.height === COMPACT_CONTROL_HEIGHT,
              `Run and Deploy keep the compact face: ${JSON.stringify(bounds)}`
            )
          }
          // Emir's quiet icon takes the touch target as its box on touch, the compact face elsewhere.
          await expectContained(page, actions)
          const actionsSize = viewport.touch ? TOUCH_TARGET_SIZE : COMPACT_CONTROL_HEIGHT
          const actionsBounds = await actions.boundingBox()
          assert(
            actionsBounds &&
              actionsBounds.width === actionsSize &&
              actionsBounds.height === actionsSize,
            `Workflow actions takes ${actionsSize}px: ${JSON.stringify(actionsBounds)}`
          )
          if (compact) {
            const bounds = await actions.boundingBox()
            assert(bounds)
            await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
            // The row's accessible name ends with its drawn shortcut hint (⇧L).
            await expect(page.getByRole('menuitem', { name: /^Auto layout\b/ })).toBeVisible()
            await page.keyboard.press('Escape')
          } else {
            const canvasBounds = await canvas.boundingBox()
            const panelBounds = await panel.boundingBox()
            assert(canvasBounds && panelBounds)
            assert(
              canvasBounds.width > 0 && canvasBounds.x + canvasBounds.width <= panelBounds.x + 1,
              'Regular views must keep the canvas beside the workflow panel'
            )
          }
          await expectNoOverflow(page)
          await capture(page, `${browserName}-${viewport.name}-workflow-regular-layout`)
        }
      )
    }
  } finally {
    documentNavigations.delete(page)
    await check(`${prefix}/no uncaught browser errors`, page, async () => {
      assert.deepEqual(pageErrors, [])
      assert.deepEqual(nativeErrors, [])
    })
    const failed = checks.filter((result) => result.status === 'failed').length > initialFailures
    await context.tracing.stop(
      failed
        ? { path: resolve(artifactDirectory, `${prefix.replaceAll('/', '-')}.zip`) }
        : undefined
    )
    await context.close()
  }
}

await mkdir(artifactDirectory, { recursive: true })
try {
  const cookie = await seed()
  for (const [browserName, browserType] of [
    ['chromium', chromium],
    ['webkit', webkit],
  ] as const) {
    if (selectedBrowser && selectedBrowser !== browserName) continue
    let browser: Browser | undefined
    await check(`${browserName}/browser starts`, undefined, async () => {
      browser =
        webkitEndpoint === undefined
          ? await browserType.launch()
          : await browserType.connect(webkitEndpoint, { timeout: 180_000 })
    })
    if (!browser) continue
    try {
      for (const [index, viewport] of viewports.entries()) {
        if (index % shardCount !== shardIndex) continue
        if (selectedViewport && selectedViewport !== viewport.name) continue
        await exerciseViewport(browser, browserName, cookie, viewport)
      }
    } finally {
      await browser.close()
    }
  }
} catch (error) {
  checks.push({
    name: 'suite setup',
    status: 'failed',
    durationMs: 0,
    error: getErrorMessage(error),
  })
  logger.error('FAIL suite setup', { error: getErrorMessage(error) })
} finally {
  await check('fixtures are removed', undefined, async () => {
    await sql.begin(async (tx) => {
      await tx`delete from permissions where entity_type = 'workspace' and entity_id = ${workspaceId}`
      await tx`delete from workspace where id = ${workspaceId}`
      await tx`delete from project where id = ${workspaceId} and owner_id = ${ownerId}`
      await tx`delete from workflow_execution_snapshots where id = ${snapshotId}`
      await tx`delete from organization where id = ${organizationId}`
      await tx`delete from "user" where id = ${ownerId}`
    })
    const [remaining] = await sql`select
      exists(select 1 from "user" where id = ${ownerId}) as owner,
      exists(select 1 from organization where id = ${organizationId}) as organization,
      exists(select 1 from workspace where id = ${workspaceId}) as workspace,
      exists(select 1 from project where id = ${workspaceId}) as project,
      exists(select 1 from workflow_execution_snapshots where id = ${snapshotId}) as snapshot`
    assert.deepEqual(remaining, {
      owner: false,
      organization: false,
      workspace: false,
      project: false,
      snapshot: false,
    })
  })
  await sql.end()
  await check('same-origin HTTP responses succeed', undefined, async () => {
    assert.deepEqual(httpErrors, [])
  })
  await check('each browser mints a realtime token', undefined, async () => {
    for (const [browserName, mints] of socketTokenMints) {
      assert(mints.minted > 0, `${browserName} never minted a realtime token`)
    }
  })
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        startedAt,
        completedAt: new Date().toISOString(),
        baseUrl: baseUrl.origin,
        checks,
        screenshots,
        httpErrors,
        socketTokenMints: Object.fromEntries(socketTokenMints),
        requestFailures,
        navigationDiagnostics,
        viewportMeasurements,
      },
      null,
      2
    )
  )
}
const failures = checks.filter((result) => result.status === 'failed')
logger.info('Mobile browser checks complete', {
  passed: checks.length - failures.length,
  failed: failures.length,
  reportPath,
})
if (failures.length) process.exitCode = 1
