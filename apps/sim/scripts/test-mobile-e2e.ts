import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
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
import { makeSignature } from 'better-auth/crypto'
import postgres from 'postgres'

/**
 * Real browser coverage against a running local app and disposable PostgreSQL.
 * Requires MOBILE_E2E_BASE_URL, MOBILE_E2E_DATABASE_URL, MOBILE_E2E_AUTH_SECRET,
 * and MOBILE_E2E_REPORT_PATH. Install Chromium and WebKit with Playwright first.
 * MOBILE_E2E_BROWSER and MOBILE_E2E_VIEWPORT narrow a diagnostic rerun.
 */
const logger = createLogger('MobileE2E')
const expect = browserExpect.configure({ timeout: 20_000 })

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
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
const workspaceId = generateId()
const folderId = generateId()
const workflowId = generateId()
const snapshotId = generateId()
const chatId = generateId()
const tableId = generateId()
const tableRowId = generateId()
const publicChatIdentifier = `mobile-e2e-${generateId()}`
const folderName = 'Mobile E2E folder'
const startedAt = new Date().toISOString()
const checks: CheckResult[] = []
const screenshots: string[] = []
const httpErrors: { browser: string; status: number; path: string }[] = []
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
const routes = ['home', 'files', 'tables', 'knowledge', 'logs', 'integrations', 'settings/general']
const selectedBrowser = process.env.MOBILE_E2E_BROWSER
const selectedViewport = process.env.MOBILE_E2E_VIEWPORT
assert(!selectedBrowser || ['chromium', 'webkit'].includes(selectedBrowser), 'Unknown browser')
assert(
  !selectedViewport || viewports.some((viewport) => viewport.name === selectedViewport),
  'Unknown viewport'
)

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
    await tx`insert into workspace (id, name, owner_id, billed_account_user_id)
      values (${workspaceId}, 'Mobile E2E workspace', ${ownerId}, ${ownerId})`
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
    await tx`insert into copilot_chats (id, user_id, workspace_id, type, title, resources)
      values (${chatId}, ${ownerId}, ${workspaceId}, 'mothership', 'Mobile E2E conversation',
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

async function visit(page: Page, route: string) {
  const path = `/workspace/${workspaceId}/${route}`
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
  assert(response.status() < 400, `Could not load ${route}: ${response.status()}`)
  assert(
    new URL(page.url()).pathname.startsWith(`/workspace/${workspaceId}/`),
    'Session was rejected'
  )
  await expect(page.locator('.workspace-content-shell')).toBeVisible()
  await expect(page.getByText('Application error', { exact: false })).toHaveCount(0)
  const contentByRoute: Record<string, Locator> = {
    home: page.getByRole('textbox', { name: 'Message', exact: true }),
    files: page.getByText(folderName, { exact: true }),
    tables: page.getByText('Mobile E2E table', { exact: true }),
    knowledge: page.getByText('Upload documents to give your agents a memory they can search.', {
      exact: true,
    }),
    logs: page.getByRole('row').filter({ hasText: 'Mobile E2E workflow' }),
    integrations: page.getByPlaceholder('Search integrations...', { exact: true }),
    'settings/general': page.getByRole('button', { name: 'Theme', exact: true }),
  }
  const content = contentByRoute[route]
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
  const shell = await page.locator('.workspace-content-shell').boundingBox()
  assert(shell && shell.width > 0 && shell.x >= -1, 'The content must have usable horizontal space')
  assert(
    shell.x + shell.width <= (page.viewportSize()?.width ?? 0) + 1,
    'Content extends offscreen'
  )
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

async function expectDesktopPreference(context: BrowserContext, page: Page) {
  const cookie = (await context.cookies()).find((entry) => entry.name === 'sidebar_collapsed')
  assert.equal(cookie?.value, '0', 'Mobile navigation must preserve desktop expansion preference')
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('sidebar-state') ?? '{}').state?.sidebarWidth
    ),
    400,
    'Mobile navigation must preserve the saved desktop width'
  )
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
              name: 'sidebar-state',
              value: JSON.stringify({ state: { sidebarWidth: 400 }, version: 0 }),
            },
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
  page.on('response', (response) => {
    const url = new URL(response.url())
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
    for (const route of routes) {
      await check(`${prefix}/${route} fits the screen`, page, async () => {
        await visit(page, route)
        await expectNoOverflow(page)
        if (viewport.width < 768) {
          await expect(
            page.getByRole('button', { name: 'Open navigation', exact: true })
          ).toBeVisible()
          await expect(page.getByRole('complementary', { name: 'Workspace sidebar' })).toBeHidden()
        } else {
          await expect(
            page.getByRole('button', { name: 'Open navigation', exact: true })
          ).toBeHidden()
          await expect(page.getByRole('complementary', { name: 'Workspace sidebar' })).toBeVisible()
        }
        if (
          viewport.name === 'phone' ||
          viewport.name === 'desktop' ||
          (viewport.name === 'wide-desktop' && route === 'home')
        ) {
          await capture(page, `${browserName}-${viewport.name}-${route.replaceAll('/', '-')}`)
        }
      })
    }

    if (viewport.width < 768) {
      await check(
        `${prefix}/navigation opens, dismisses, and preserves desktop preferences`,
        page,
        async () => {
          await visit(page, 'files')
          const sidebar = page.getByRole('complementary', { name: 'Workspace sidebar' })
          const openNavigation = page.getByRole('button', { name: 'Open navigation', exact: true })
          await openNavigation.focus()
          const modifier = await page.evaluate(() =>
            /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent) ? 'Meta' : 'Control'
          )
          await page.keyboard.press(`${modifier}+b`)
          await expectContained(page, sidebar)
          await expectDesktopPreference(context, page)
          await page.keyboard.press(`${modifier}+b`)
          await expect(sidebar).toBeHidden()
          await expectDesktopPreference(context, page)
          await openNavigation.tap()
          await expectContained(page, sidebar)
          if (viewport.name === 'phone') await capture(page, `${browserName}-phone-navigation`)
          await sidebar.getByRole('link', { name: 'New chat', exact: true }).tap()
          await expect(page).toHaveURL(`${baseUrl.origin}/workspace/${workspaceId}/home`)
          await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
          await expect(sidebar).toBeHidden()
          await page.getByRole('button', { name: 'Open navigation', exact: true }).tap()
          await page.getByRole('button', { name: 'Close navigation', exact: true }).tap()
          await expect(sidebar).toBeHidden()
          await page.getByRole('button', { name: 'Open navigation', exact: true }).tap()
          await sidebar.getByRole('link', { name: 'Files', exact: true }).tap()
          await expect(page).toHaveURL(new RegExp(`/workspace/${workspaceId}/files`))
          await expect(sidebar).toBeHidden()
          await expect(page.locator('.workspace-content-shell')).toBeVisible()
          await expect(
            page.getByRole('button', { name: `Actions for ${folderName}`, exact: true })
          ).toBeVisible()
          await expectDesktopPreference(context, page)
        }
      )

      await check(
        `${prefix}/touch row actions open without hover or a right click`,
        page,
        async () => {
          await visit(page, 'files')
          const actions = page.getByRole('button', {
            name: `Actions for ${folderName}`,
            exact: true,
          })
          await expectContained(page, actions)
          await actions.tap()
          await expect(page.getByRole('menuitem', { name: 'Rename', exact: true })).toBeVisible()
          await page.keyboard.press('Escape')
          await expect(page.getByRole('menu')).toHaveCount(0)
        }
      )
    }

    await check(
      `${prefix}/dialog remains reachable with desktop sidebar and panel widths saved`,
      page,
      async () => {
        await visit(page, 'knowledge')
        const newBase = page.getByRole('button', { name: 'New base', exact: true }).first()
        await expect(newBase).toBeEnabled({ timeout: 120_000 })
        await newBase.click()
        const dialog = page.getByRole('dialog', { name: 'Create Knowledge Base', exact: true })
        await expectContained(page, dialog)
        const field = dialog.getByPlaceholder('Enter knowledge base name')
        await field.fill('Mobile E2E draft')
        if (viewport.touch && viewport.width < 768) {
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
    await check(
      `${prefix}/chat and resources adapt without losing an unsent draft`,
      page,
      async () => {
        await visit(page, `chat/${chatId}`)
        await expect(
          page.getByRole('button', {
            name: /^(Expand resource view|Collapse resource view|Back to chat)$/,
          })
        ).toBeVisible()
        const backToChat = page.getByRole('button', { name: 'Back to chat', exact: true })
        const summary = page.getByText('Mobile project summary', { exact: false })
        await expect
          .poll(async () => (await summary.isVisible()) || (await backToChat.isVisible()), {
            timeout: 120_000,
          })
          .toBe(true)
        await expect(summary).toBeVisible()
        await expectNoOverflow(page)
        const composer = page.getByRole('textbox', { name: 'Message', exact: true })
        await composer.fill('Keep this draft')
        if (viewport.width < 768) {
          const send = page.getByRole('button', { name: 'Send message', exact: true })
          await expectContained(page, send)
          const bounds = await send.boundingBox()
          assert(
            bounds && bounds.width >= 44 && bounds.height >= 44,
            `Send must be touch-sized: ${JSON.stringify({
              bounds,
              media: await send.evaluate((element) => ({
                viewportWidth: innerWidth,
                coarse: matchMedia('(pointer: coarse)').matches,
                minWidth: getComputedStyle(element).minWidth,
                minHeight: getComputedStyle(element).minHeight,
              })),
            })}`
          )
          await composer.press('Enter')
          await expect(composer).toHaveValue('Keep this draft\n')
        }
        const expand = page.getByRole('button', { name: 'Expand resource view', exact: true })
        if (await expand.isVisible()) await expand.click()
        const resource = page.locator('[data-mothership-panel]')
        await expectContained(page, resource)
        await expect(resource.locator(`[data-row-id="${tableRowId}"][data-col="0"]`)).toBeVisible({
          timeout: 120_000,
        })
        await expectNoOverflow(page)
        if (
          viewport.name === 'phone' ||
          viewport.name === 'android' ||
          viewport.name === 'desktop' ||
          viewport.name === 'wide-desktop'
        ) {
          await capture(page, `${browserName}-${viewport.name}-resources`)
        }
        if (viewport.width < 1000) {
          await expect(composer).toBeHidden()
          await expectContained(page, backToChat)
          await backToChat.click()
        } else {
          await expectContained(page, composer)
          const composerBounds = await composer.boundingBox()
          const resourceBounds = await resource.boundingBox()
          assert(composerBounds && resourceBounds)
          assert(
            composerBounds.x + composerBounds.width <= resourceBounds.x,
            'Wide screens must retain side-by-side chat and resources'
          )
          await page.getByRole('button', { name: 'Collapse resource view', exact: true }).click()
        }
        await expect(composer).toHaveValue(
          viewport.width < 768 ? 'Keep this draft\n' : 'Keep this draft'
        )
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
            composer,
            page.getByRole('button', { name: 'Send message', exact: true }),
          ])
        }
        if (viewport.width < 768) {
          await page.setViewportSize({
            width: viewport.width,
            height: Math.min(400, Math.round(viewport.height * 0.65)),
          })
          await composer.focus()
          await expectContained(page, composer)
          await expectContained(
            page,
            page.getByRole('button', { name: 'Send message', exact: true })
          )
          await page.setViewportSize({ width: viewport.width, height: viewport.height })
        }
        await composer.fill('')
        if (!viewport.touch) {
          await composer.press('Enter')
          await expect(composer).toHaveValue('')
          await composer.press('Shift+Enter')
          await expect(composer).toHaveValue('\n')
          await composer.fill('')
        }
        const rows =
          await sql`select count(*)::int as count from copilot_messages where chat_id = ${chatId}`
        assert.equal(rows[0]?.count, 2, 'Mobile Enter must not send a message')
      }
    )

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
          await visit(page, 'files')
          const sidebar = page.getByRole('complementary', { name: 'Workspace sidebar' })
          await sidebar.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
          await expect.poll(async () => (await sidebar.boundingBox())?.width).toBeLessThan(100)
          await sidebar.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
          await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(400)
          await expectDesktopPreference(context, page)
          await expectNoOverflow(page)
        }
      )
    }

    if (viewport.name === 'phone') {
      await check(
        `${prefix}/table edits persist and configuration panels remain reachable by touch`,
        page,
        async () => {
          await visit(page, `tables/${tableId}`)
          const cell = page.locator(`[data-row-id="${tableRowId}"][data-col="0"]`)
          await expect(cell).toBeVisible({ timeout: 120_000 })
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
          await expect(cell).toHaveText(value)
          await page.getByRole('button', { name: 'Column options', exact: true }).first().tap()
          await expectContained(page, page.getByRole('menu'))
          await page.getByRole('menuitem', { name: 'Edit column', exact: true }).tap()
          const columnConfig = page.getByRole('dialog', { name: 'Configure column', exact: true })
          await expectContained(page, columnConfig)
          await expect
            .poll(async () => (await columnConfig.boundingBox())?.width)
            .toBe(viewport.width)
          await capture(page, `${browserName}-phone-column-config`)
          await columnConfig.getByRole('button', { name: 'Close', exact: true }).tap()
          await expect(columnConfig).not.toBeInViewport()
          for (const [name, dialogName] of [
            ['Workflow', 'Configure workflow'],
            ['Enrichments', 'Enrichments'],
          ] as const) {
            await page.getByRole('button', { name: 'New column', exact: true }).first().tap()
            await page.getByRole('menuitem', { name, exact: true }).tap()
            const configuration = page.getByRole('dialog', { name: dialogName, exact: true })
            await expectContained(page, configuration)
            await expect
              .poll(async () => (await configuration.boundingBox())?.width)
              .toBe(viewport.width)
            await capture(page, `${browserName}-phone-${name.toLowerCase()}-config`)
            await configuration.getByRole('button', { name: 'Close', exact: true }).tap()
            await expect(configuration).not.toBeInViewport()
          }
          await expectNoOverflow(page)
        }
      )

      await check(`${prefix}/log details fill the phone and can be dismissed`, page, async () => {
        await visit(page, 'logs')
        await page.getByRole('row').filter({ hasText: 'Mobile E2E workflow' }).click()
        const details = page.getByLabel('Log details sidebar', { exact: true })
        await expectContained(page, details)
        await expect.poll(async () => (await details.boundingBox())?.width).toBe(viewport.width)
        await expect(
          page.getByRole('separator', { name: 'Resize log details panel', exact: true })
        ).toBeHidden()
        await expect(details.getByText('Workflow Output', { exact: true })).toBeVisible({
          timeout: 120_000,
        })
        await capture(page, `${browserName}-phone-log-details`)
        await details.getByRole('button', { name: 'Close', exact: true }).tap()
        await expect(details).not.toBeInViewport()
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
        await page.getByRole('menuitem', { name: 'General', exact: true }).tap()
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
          await visit(page, 'files')
          const sidebar = page.getByRole('complementary', { name: 'Workspace sidebar' })
          if (viewport.name === 'tablet') {
            await sidebar.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
            await expect.poll(async () => (await sidebar.boundingBox())?.width).toBeLessThan(100)
            await sidebar.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
            await expectDesktopPreference(context, page)
          }
          await page.setViewportSize({ width: 1440, height: 1000 })
          await expect(sidebar).toBeVisible()
          await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(400)
          await expectDesktopPreference(context, page)
          await page.setViewportSize({ width: viewport.width, height: viewport.height })
          if (viewport.width < 768) await expect(sidebar).toBeHidden()
          else await expect(sidebar).toBeVisible()
          await expectDesktopPreference(context, page)
          await expectNoOverflow(page)
        }
      )
      await check(`${prefix}/workflow controls open and return to the canvas`, page, async () => {
        await visit(page, `w/${workflowId}`)
        await expect(page.locator('.react-flow')).toBeVisible({ timeout: 120_000 })
        const panel = page.getByRole('complementary', { name: 'Workflow panel', exact: true })
        await expect(panel).toBeHidden()
        await capture(page, `${browserName}-${viewport.name}-workflow-canvas`)
        await page.getByRole('button', { name: 'Workflow', exact: true }).tap()
        await expectContained(page, panel)
        await capture(page, `${browserName}-${viewport.name}-workflow-panel`)
        await page.getByRole('button', { name: 'Back to canvas', exact: true }).tap()
        await expect(panel).toBeHidden()
        await expect
          .poll(async () => {
            const canvas = await page.locator('.react-flow').boundingBox()
            const content = await page.locator('.workspace-content-shell').boundingBox()
            return canvas && content ? canvas.width / content.width : 0
          })
          .toBeGreaterThan(0.95)
        if (viewport.name === 'phone') {
          await sql`update workflow set locked = true where id = ${workflowId}`
          await withDocumentNavigation(page, page.url(), () =>
            page.reload({ waitUntil: 'commit', timeout: 360_000 })
          )
          const notifications = page.getByLabel('Notifications', { exact: true })
          await expect(notifications).toContainText('This workflow is locked', {
            timeout: 120_000,
          })
          await expectContained(page, notifications)
          const unlock = notifications.getByRole('button', {
            name: 'Unlock Workflow',
            exact: true,
          })
          await expectContained(page, unlock)
          await capture(page, `${browserName}-phone-workflow-notification`)
          const [unlocked] = await Promise.all([
            page.waitForResponse(
              (response) =>
                response.request().method() === 'PUT' &&
                new URL(response.url()).pathname === `/api/workflows/${workflowId}`,
              { timeout: 120_000 }
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
        }
        await expectNoOverflow(page)
      })
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
      browser = await browserType.launch()
    })
    if (!browser) continue
    try {
      for (const viewport of viewports) {
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
} finally {
  await check('fixtures are removed', undefined, async () => {
    await sql.begin(async (tx) => {
      await tx`delete from permissions where entity_type = 'workspace' and entity_id = ${workspaceId}`
      await tx`delete from workspace where id = ${workspaceId}`
      await tx`delete from workflow_execution_snapshots where id = ${snapshotId}`
      await tx`delete from "user" where id = ${ownerId}`
    })
  })
  await sql.end()
  await check('same-origin HTTP responses succeed', undefined, async () => {
    assert.deepEqual(httpErrors, [])
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
