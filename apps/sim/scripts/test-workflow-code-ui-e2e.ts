import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { type Browser, expect as browserExpect, chromium, type Page } from '@playwright/test'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId, generateShortId } from '@sim/utils/id'
import { truncate } from '@sim/utils/string'
import { makeSignature } from 'better-auth/crypto'
import postgres from 'postgres'
import {
  v2ApplyWorkflowSourceContract,
  v2GetWorkflowSourceContract,
} from '@/lib/api/contracts/v2/workflow-source'
import {
  v2ApplyWorkflowOperationsContract,
  v2CreateWorkflowContract,
} from '@/lib/api/contracts/v2/workflows'
import { getWorkflowSourceContract, type WorkflowSource } from '@/lib/api/contracts/workflow-source'

/**
 * The read-only Code tab in the workflow editor, in a real browser against two local apps built
 * from the same production build and sharing one disposable database: one with the
 * `workflow-code` flag on (`WORKFLOW_CODE=true`, with its realtime server, so canvas edits persist
 * and `workflow-updated` reaches the page) and one with it off. SQL seeds the user, workspace,
 * session and personal API key; the workflow is built through the v2 routes.
 *
 * - Flag off: the Code tab is absent, and a persisted `activeTab: 'code'` falls back to the toolbar.
 * - Flag on: the editor shows the draft's source and ignores typing; disabling a block on the canvas
 *   and applying source through `POST /api/v2/workflows/{id}/source` each refresh it; dragging
 *   a block does not.
 * - A failed source read shows the error state.
 * - The flag turning off while the tab is open: the page's next read is answered by the flag-off
 *   app (the real 403), and the tab shows the error state.
 *
 *   WORKFLOW_CODE_UI_E2E_BASE_URL=http://127.0.0.1:3028 \
 *   WORKFLOW_CODE_UI_E2E_FLAG_OFF_BASE_URL=http://127.0.0.1:3030 \
 *   WORKFLOW_CODE_UI_E2E_DATABASE_URL=postgres://…/sim_test \
 *   WORKFLOW_CODE_UI_E2E_AUTH_SECRET=… \
 *   WORKFLOW_CODE_UI_E2E_REPORT_PATH=/tmp/workflow-code-ui-report.json \
 *   bun run test:workflow-code-ui:e2e
 */
const logger = createLogger('WorkflowCodeUiE2E')
const startedAt = new Date().toISOString()
const expect = browserExpect.configure({ timeout: 60_000 })
const PAGE_LOAD_TIMEOUT_MS = 180_000
const SCORE_CODE = 'return 40 + 2'
const APPLIED_CODE = 'return 6 * 7'

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

function loopbackOrigin(name: string): URL {
  const url = new URL(requiredEnvironment(name))
  assert(new Set(['localhost', '127.0.0.1', '[::1]']).has(url.hostname), `${name}: use loopback`)
  assert.equal(url.protocol, 'http:', `${name}: use local HTTP`)
  assert.equal(url.pathname, '/', `${name}: use an origin without a path`)
  assert(!url.username && !url.password, `${name}: no credentials in the URL`)
  return url
}

const baseUrl = loopbackOrigin('WORKFLOW_CODE_UI_E2E_BASE_URL')
const flagOffUrl = loopbackOrigin('WORKFLOW_CODE_UI_E2E_FLAG_OFF_BASE_URL')
assert.notEqual(baseUrl.origin, flagOffUrl.origin, 'The flag-off app must be a separate app')
const databaseUrl = assertDisposableTestDatabaseUrl(
  requiredEnvironment('WORKFLOW_CODE_UI_E2E_DATABASE_URL')
)
const authSecret = requiredEnvironment('WORKFLOW_CODE_UI_E2E_AUTH_SECRET')
const reportPath = requiredEnvironment('WORKFLOW_CODE_UI_E2E_REPORT_PATH')
const artifactDirectory = `${reportPath}.artifacts`
assert(authSecret.length >= 32, 'Use a local Better Auth secret of at least 32 characters')

const sql = postgres(databaseUrl.toString(), { max: 2 })
const ownerId = generateId()
const workspaceId = generateId()
const scoreBlockId = generateId()
const personalKey = `sk-sim-fixture-${generateId()}`
const sessionToken = generateShortId()
const checks: {
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  error?: string
  screenshot?: string
}[] = []
const requests: { method: string; path: string; status: number; durationMs: number }[] = []
let cookie = ''
let workflowId = ''
let browser: Browser | undefined

function failureMessage(error: unknown): string {
  let message = getErrorMessage(error)
  for (const secret of [personalKey, sessionToken, authSecret]) {
    message = message.replaceAll(secret, '[redacted]')
  }
  return truncate(message, 2000)
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
      await page.screenshot({ path: screenshot, timeout: 10_000 }).catch(() => {})
    }
    checks.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: failureMessage(error),
      screenshot,
    })
    throw error
  }
}

async function call(
  method: 'GET' | 'POST',
  path: string,
  auth: { key: string } | { session: string },
  expected: number,
  body?: unknown
): Promise<unknown> {
  const url = new URL(path, baseUrl)
  const headers = new Headers({ accept: 'application/json', 'x-forwarded-for': '127.0.0.1' })
  if ('key' in auth) headers.set('x-api-key', auth.key)
  else headers.set('cookie', `better-auth.session_token=${auth.session}`)
  if (body !== undefined) headers.set('content-type', 'application/json')
  const started = performance.now()
  // boundary-raw-fetch: browser E2E seeds and reads a separately running local app over real HTTP
  const response = await fetch(url, {
    method,
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  requests.push({
    method,
    path: url.pathname,
    status: response.status,
    durationMs: Math.round(performance.now() - started),
  })
  const text = await response.text()
  assert.equal(response.status, expected, `${method} ${url.pathname}: ${truncate(text, 500)}`)
  return JSON.parse(text)
}

async function seed() {
  await sql.begin(async (tx) => {
    const email = `${ownerId}@workflow-code-ui.test`
    await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
      values (${ownerId}, 'Workflow Code tab fixture', ${email}, ${email}, true, now(), now())`
    await tx`insert into user_stats (id, user_id) values (${generateId()}, ${ownerId})`
    await tx`insert into project (id, name, owner_id) values (${workspaceId}, 'Workflow Code tab project', ${ownerId})`
    await tx`insert into workspace (id, project_id, name, owner_id, billed_account_user_id)
      values (${workspaceId}, ${workspaceId}, 'Workflow Code tab workspace', ${ownerId}, ${ownerId})`
    await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type)
      values (${generateId()}, ${ownerId}, 'workspace', ${workspaceId}, 'admin')`
    await tx`insert into session (id, token, user_id, expires_at, created_at, updated_at)
      values (${generateId()}, ${sessionToken}, ${ownerId}, now() + interval '1 day', now(), now())`
    await tx`insert into api_key (id, user_id, name, key, key_hash, type)
      values (${generateId()}, ${ownerId}, 'Workflow Code tab fixture', ${personalKey}, ${sha256Hex(personalKey)}, 'personal')`
  })
  cookie = encodeURIComponent(`${sessionToken}.${await makeSignature(sessionToken, authSecret)}`)
}

/** A workflow of a start block wired to one function block, built through the v2 routes. */
async function createWorkflow() {
  const created = v2CreateWorkflowContract.response.schema.parse(
    await call('POST', '/api/v2/workflows', { key: personalKey }, 201, {
      workspaceId,
      name: 'Code tab fixture',
    })
  ).data
  workflowId = created.id
  const start = created.blocks[0]
  assert(start, 'The new workflow is seeded with a start block')
  const { data } = v2ApplyWorkflowOperationsContract.response.schema.parse(
    await call('POST', `/api/v2/workflows/${workflowId}/operations`, { key: personalKey }, 200, {
      operations: [
        {
          operation_type: 'add',
          block_id: scoreBlockId,
          params: { type: 'function', name: 'Score', inputs: { code: SCORE_CODE } },
        },
        {
          operation_type: 'edit',
          block_id: start.id,
          params: { connections: { success: scoreBlockId } },
        },
      ],
      atomic: true,
    })
  )
  assert.equal(data.skipped.length, 0, 'Every operation must apply')
}

/** The source the Code tab requests: the canvas route, function code inline. */
async function serverSource(): Promise<WorkflowSource> {
  return getWorkflowSourceContract.response.schema.parse(
    await call(
      'GET',
      `/api/workflows/${workflowId}/source?functionCode=inline`,
      { session: cookie },
      200
    )
  ).data
}

function entryFile(source: WorkflowSource): string {
  const text = source.files['workflow.ts']
  assert(text, 'The source must include workflow.ts')
  return text
}

/** The editor wraps long lines; compare without whitespace. */
const compact = (text: string) => text.replace(/\s+/g, '')

const isSourceRead = (url: string | URL) =>
  new URL(url).pathname === `/api/workflows/${workflowId}/source`

function workflowPanel(page: Page) {
  return page.getByRole('complementary', { name: 'Workflow panel', exact: true })
}

function codeTab(page: Page) {
  return workflowPanel(page).locator('[data-tab-content="code"]')
}

/**
 * Opens the Code tab. The panel is server-rendered, so a click that lands before React hydrates
 * has no handler and is lost: click until the tab shows.
 */
async function openCodeTab(page: Page) {
  const button = workflowPanel(page).locator('[data-tab-button="code"]')
  await expect(async () => {
    await button.click()
    await expect(codeTab(page)).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: PAGE_LOAD_TIMEOUT_MS })
}

/** The editor's rendered lines in document order; Playwright's CSS locators pierce its shadow root. */
async function editorText(page: Page): Promise<string> {
  return codeTab(page)
    .locator('[data-code-editor] [data-content] [data-line]')
    .evaluateAll((lines) =>
      lines
        .sort((a, b) => Number(a.getAttribute('data-line')) - Number(b.getAttribute('data-line')))
        .map((line) => line.textContent ?? '')
        .join('\n')
    )
}

/** Whether the editor's editable surface holds focus, inside the host's shadow root. */
async function editorHasFocus(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.activeElement?.shadowRoot?.activeElement?.hasAttribute('data-content') === true
  )
}

/** Waits until the stored source differs from `previous`, then until the editor shows exactly it. */
async function expectEditorToShowNewSource(page: Page, previous: WorkflowSource) {
  let current = previous
  await expect
    .poll(async () => {
      current = await serverSource()
      return current.base.fingerprint
    })
    .not.toBe(previous.base.fingerprint)
  const expected = compact(entryFile(current))
  await expect.poll(async () => compact(await editorText(page))).toBe(expected)
  return current
}

function scoreBlock(page: Page) {
  return page.locator(`.react-flow__node[data-id="${scoreBlockId}"]`)
}

async function toggleScoreBlock(page: Page, action: 'Disable' | 'Enable') {
  const block = scoreBlock(page)
  await block.hover()
  await block.getByRole('button', { name: action, exact: true }).click()
}

async function visitWorkflow(page: Page, origin: URL) {
  await page.goto(new URL(`/workspace/${workspaceId}/w/${workflowId}`, origin).href, {
    waitUntil: 'domcontentloaded',
    timeout: PAGE_LOAD_TIMEOUT_MS,
  })
  await expect(workflowPanel(page)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT_MS })
}

/** A page in a fresh browser context signed in to `origin`. */
async function signedInPage(origin: URL): Promise<Page> {
  assert(browser, 'The browser must be launched first')
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  await context.addCookies([
    { name: 'better-auth.session_token', value: cookie, url: origin.origin },
  ])
  const page = await context.newPage()
  page.setDefaultTimeout(60_000)
  return page
}

try {
  await mkdir(artifactDirectory, { recursive: true })
  browser = await chromium.launch()
  await seed()
  await check('create a start-to-function workflow through the v2 routes', undefined, () =>
    createWorkflow()
  )

  const offPage = await signedInPage(flagOffUrl)
  await offPage.addInitScript(() => {
    localStorage.setItem(
      'panel-state',
      JSON.stringify({ state: { activeTab: 'code' }, version: 0 })
    )
  })
  await check(
    'flag off: no Code tab, and a persisted Code tab falls back to the toolbar',
    offPage,
    async () => {
      await visitWorkflow(offPage, flagOffUrl)
      const panel = workflowPanel(offPage)
      await expect(panel.locator('[data-tab-button="toolbar"]')).toBeVisible()
      await expect(panel.locator('[data-tab-button="code"]')).toHaveCount(0)
      await expect(panel.locator('[data-tab-content="code"]')).toHaveCount(0)
      await expect(panel.locator('[data-tab-content="toolbar"]')).toBeVisible()
      const persisted = await offPage.evaluate(() => localStorage.getItem('panel-state'))
      assert.equal(
        persisted && JSON.parse(persisted).state.activeTab,
        'code',
        'The persisted tab stays code; only the rendered tab falls back'
      )
    }
  )
  await offPage.context().close()

  const page = await signedInPage(baseUrl)
  let shown = await serverSource()

  await check(
    'flag on: the Code tab shows the draft source in a read-only editor',
    page,
    async () => {
      await visitWorkflow(page, baseUrl)
      await openCodeTab(page)
      const editor = codeTab(page).locator('[data-code-editor][data-read-only]')
      await expect(editor).toBeVisible()
      await expect.poll(async () => compact(await editorText(page))).toBe(compact(entryFile(shown)))
      assert(entryFile(shown).includes(SCORE_CODE), 'The inline source carries the function code')
      await codeTab(page).locator('[data-code-editor] [data-content] [data-line]').first().click()
      await expect.poll(() => editorHasFocus(page)).toBe(true)
      await page.keyboard.type('typed into a read-only view')
      await page.keyboard.press('Enter')
      await page.keyboard.press('Backspace')
      await page.evaluate(() => navigator.clipboard.writeText('pasted into a read-only view'))
      await page.keyboard.press('ControlOrMeta+v')
      // The editor paints edits on the next animation frame; two frames cover any queued render.
      await page.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done()))
          )
      )
      assert.equal(compact(await editorText(page)), compact(entryFile(shown)))
    }
  )

  await check('disabling a block on the canvas refreshes the code', page, async () => {
    await toggleScoreBlock(page, 'Disable')
    shown = await expectEditorToShowNewSource(page, shown)
    assert.match(entryFile(shown), /disabled: true/)
  })

  await check('dragging a block on the canvas does not re-read the code', page, async () => {
    const reads: string[] = []
    const onRequest = (request: { url(): string }) => {
      if (isSourceRead(request.url())) reads.push(request.url())
    }
    page.on('request', onRequest)
    const block = scoreBlock(page)
    const before = await block.boundingBox()
    assert(before, 'The function block must be on the canvas')
    await page.mouse.move(before.x + before.width / 2, before.y + 12)
    await page.mouse.down()
    await page.mouse.move(before.x + before.width / 2 + 160, before.y + 92, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => (await block.boundingBox())?.x).not.toBe(before.x)
    // Past the Code tab's refresh debounce, with time for the move to persist.
    await page.waitForTimeout(3_000)
    page.off('request', onRequest)
    assert.deepEqual(reads, [], 'A position-only edit never re-reads the source')
  })

  await check('a source apply through the v2 API refreshes the code', page, async () => {
    const source = v2GetWorkflowSourceContract.response.schema.parse(
      await call(
        'GET',
        `/api/v2/workflows/${workflowId}/source?functionCode=inline`,
        { key: personalKey },
        200
      )
    ).data
    const text = entryFile(source)
    assert.equal(text.split(SCORE_CODE).length, 2, 'The function code appears exactly once')
    const applied = v2ApplyWorkflowSourceContract.response.schema.parse(
      await call('POST', `/api/v2/workflows/${workflowId}/source`, { key: personalKey }, 200, {
        files: { 'workflow.ts': text.replace(SCORE_CODE, APPLIED_CODE) },
        lock: source.lock,
        base: source.base,
        provenance: { client: 'api' },
      })
    ).data
    assert.equal(applied.applied, true, 'The apply writes the draft')
    // The drag above selected the block, which opens the Editor tab: reopening Code proves an
    // apply that lands while the tab is hidden shows on return.
    await openCodeTab(page)
    shown = await expectEditorToShowNewSource(page, shown)
    assert(entryFile(shown).includes(APPLIED_CODE), 'The refreshed source carries the applied code')
  })

  await check(
    'the flag turning off while the tab is open shows the error state',
    page,
    async () => {
      await page.route(isSourceRead, async (route) => {
        const target = new URL(route.request().url())
        target.protocol = flagOffUrl.protocol
        target.host = flagOffUrl.host
        await route.fulfill({ response: await route.fetch({ url: target.href }) })
      })
      const refused = page.waitForResponse((response) => isSourceRead(response.url()))
      await toggleScoreBlock(page, 'Enable')
      assert.equal((await refused).status(), 403, 'The flag-off app refuses the source read')
      await expect(codeTab(page).getByTestId('workflow-code-error')).toBeVisible()
      await expect(codeTab(page).locator('[data-code-editor]')).toHaveCount(0)
      await page.unroute(isSourceRead)
    }
  )
  await page.context().close()

  const failingPage = await signedInPage(baseUrl)
  await failingPage.route(isSourceRead, (route) => route.abort('failed'))
  await check('a failed source read shows the error state', failingPage, async () => {
    await visitWorkflow(failingPage, baseUrl)
    await openCodeTab(failingPage)
    await expect(codeTab(failingPage).getByTestId('workflow-code-error')).toBeVisible()
    await expect(codeTab(failingPage).locator('[data-code-editor]')).toHaveCount(0)
  })
  await failingPage.context().close()
} catch (error) {
  logger.error(failureMessage(error))
  process.exitCode = 1
} finally {
  await browser?.close()
  try {
    await check('remove disposable fixtures', undefined, async () => {
      await sql.begin(async (tx) => {
        await tx`delete from workspace where id = ${workspaceId}`
        await tx`delete from project where id = ${workspaceId}`
      })
      await sql`delete from "user" where id = ${ownerId}`
    })
  } catch (error) {
    logger.error(failureMessage(error))
    process.exitCode = 1
  } finally {
    await sql.end()
    await writeFile(
      reportPath,
      `${JSON.stringify(
        {
          startedAt,
          finishedAt: new Date().toISOString(),
          status: process.exitCode ? 'failed' : 'passed',
          transport: 'Chromium against two local Next.js apps (flag on and off) and PostgreSQL',
          checks,
          requests,
        },
        null,
        2
      )}\n`
    )
  }
}
