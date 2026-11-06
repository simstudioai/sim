/// <reference types="chrome" />

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import {
  type BrowserContext,
  expect as browserExpect,
  chromium,
  type Frame,
  type Locator,
  type Page,
  type Request,
  type Route,
  type WebSocketRoute,
} from '@playwright/test'
import { pageSnapshotSchema } from '@sim/browser-extension-protocol'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { PASTE_RENDER_THRESHOLDS } from '@sim/utils/paste'
import { generateRandomHex } from '@sim/utils/random'
import postgres from 'postgres'
import { chatContextsSchema } from '@/lib/api/contracts/mothership-chat-context'
import { MOTHERSHIP_CHAT_ID_HEADER } from '@/lib/mothership/constants'
import { dropOnChat } from '@/scripts/browser-extension-e2e/chat-file-drop'

/** Authenticated packaged-browser acceptance against a real local Sim app and disposable Postgres. */
const logger = createLogger('BrowserExtensionAppE2E')
const expect = browserExpect.configure({ timeout: 30_000 })
const ACCESS_REVALIDATION_TIMEOUT_MS = 35_000
const ACCESS_POLL_INTERVAL_MS = 30_000
function required(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}
const base = new URL(required('EXTENSION_APP_E2E_BASE_URL'))
const database = assertDisposableTestDatabaseUrl(required('EXTENSION_APP_E2E_DATABASE_URL'))
const report = resolve(required('EXTENSION_APP_E2E_REPORT_PATH'))
const liveChat = process.env.EXTENSION_APP_E2E_LIVE_CHAT === '1'
const group = process.env.EXTENSION_APP_E2E_GROUP ?? 'all'
assert(
  group === 'all' ||
    group === 'native' ||
    group === 'navigation' ||
    group === 'composer' ||
    group === 'access',
  'Unknown extension E2E group'
)
assert(!liveChat || group === 'all', 'Live-provider acceptance requires the complete suite')
const loopback = ['127.0.0.1', 'localhost', '[::1]']
assert(
  loopback.includes(base.hostname) &&
    base.protocol === 'http:' &&
    base.pathname === '/' &&
    !base.username &&
    !base.password,
  'Use a loopback HTTP app origin'
)
const extensionRoot = resolve(import.meta.dirname, '../../extension')
const temporary = await mkdtemp(resolve(tmpdir(), 'sim-extension-app-e2e-'))
const sql = postgres(database.toString(), { max: 2 })
const checks: {
  name: string
  status: 'passed' | 'failed' | 'skipped'
  durationMs: number
  error?: string
}[] = []
const screenshots: string[] = []
const browserErrors: string[] = []
const voiceDiagnostics: Record<string, unknown>[] = []
const signInRecoveryReceipts: Record<string, unknown>[] = []
const httpErrors: { path: string; status: number; injected: boolean }[] = []
const injectedRequests = new WeakSet<Request>()
const pendingRequests = new Set<Request>()
const failedRequests: { path: string; error: string | null }[] = []
const chatResponses: {
  status: number
  chatId: string | null
  events: { type: string | null; seq: number | null }[]
  error?: string
}[] = []
const uploadRequests: { event: string; stage: string; method: string; status?: number }[] = []
const draftRemovalReceipts: { scope: string; phase: string; matches: number }[] = []
const responseDiagnostics: Promise<void>[] = []
const chatTurns = new Map<string, number>()
const chatAttempts: {
  attempt: number
  turn: number | null
  check: string
  scenario: string
  phase: string
  scope: string
  sender: string
}[] = []
const dropReceipts: {
  scope: string
  phase: string
  receipt: Awaited<ReturnType<typeof dropOnChat>>
}[] = []
let currentCheck = ''
let scenario = ''
let phase = ''
let failureState: { path: string; chatId: string | null; text: string }[] = []
let pendingAtFailure: { path: string; method: string; resourceType: string }[] = []
const uploadedPaths = new Set<string>()

function trackUploadedFile(key: string) {
  const root = resolve(import.meta.dirname, '../uploads')
  const path = resolve(root, key)
  assert(path.startsWith(`${root}/`), 'Upload escaped the local fixture directory')
  uploadedPaths.add(path)
}
let context: BrowserContext | undefined
let panel: Page | undefined
let userId: string | undefined
let releaseHeldRequest = () => {}
const alphaId = generateId()
const betaId = generateId()
const deniedId = generateId()
const organizationId = generateId()
const otherOrganizationId = generateId()
const otherOrganizationChatId = generateId()
const hostProjectId = generateId()
const hostedWorkspaceId = generateId()
const historyId = generateId()
const historyMessageId = generateId()
const historyRequestId = generateId()
const otherUserId = generateId()
const workflowId = generateId()
const captureText =
  'QA_PRIVATE_PAGE_MARKER: The launch code is ORCHID-482. The delivery date is Friday.'
const fixture = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' })
  response.end(
    `<!doctype html><html><head><title>Extension QA page</title></head><body><article><h1>Delivery plan</h1><p>${captureText}</p></article></body></html>`
  )
})
fixture.listen(0, '127.0.0.1')
await once(fixture, 'listening')
const fixtureAddress = fixture.address()
assert(fixtureAddress && typeof fixtureAddress !== 'string')

function reportError(error: unknown) {
  // Playwright includes request headers and session cookies in its call log.
  return getErrorMessage(error).split('\nCall log:', 1)[0].trimEnd()
}

function submittedPages(body: Record<string, unknown>) {
  const contexts = Array.isArray(body.contexts) ? body.contexts : []
  return contexts
    .map(toRecord)
    .filter((context) => context.kind === 'browser_page')
    .map((context) => pageSnapshotSchema.parse(context.snapshot))
}

async function check(
  owner: 'navigation' | 'composer' | 'access',
  name: string,
  run: () => Promise<void>
) {
  if (group !== 'all' && group !== owner && !(group === 'native' && owner !== 'access')) return
  currentCheck = name
  scenario = ''
  phase = ''
  const started = performance.now()
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) })
    logger.info(`PASS ${name}`)
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: reportError(error),
    })
    throw error
  }
}
const checkNavigation = (name: string, run: () => Promise<void>) => check('navigation', name, run)
const checkComposer = (name: string, run: () => Promise<void>) => check('composer', name, run)
const checkAccess = (name: string, run: () => Promise<void>) => check('access', name, run)

async function screenshot(name: string, target = panel) {
  if (!target) return
  for (const frame of target.frames()) {
    await frame.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.playState === 'running' &&
              animation.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY
          )
          .map((animation) => animation.finished.catch(() => {}))
      )
    )
    for (const element of await frame
      .getByRole('menu')
      .or(frame.getByRole('dialog'))
      .elementHandles()) {
      try {
        await element.waitForElementState('stable')
      } catch (error) {
        if (await element.isVisible()) throw error
      } finally {
        await element.dispose()
      }
    }
  }
  const path = `${report}.${name}.png`
  await target.screenshot({ path, fullPage: true, animations: 'disabled' })
  screenshots.push(path)
}

async function recordSnapshot(target: Frame | Page) {
  await target.addScriptTag({ url: `${base.origin}/__extension-qa-recorder.js` })
  return target.evaluate(() => {
    const recorderWindow = window as typeof window & {
      __PosthogExtensions__?: {
        rrweb?: {
          record(options: {
            emit: (event: unknown) => void
            blockClass: string
          }): (() => void) | undefined
        }
      }
    }
    const events: unknown[] = []
    const record = recorderWindow.__PosthogExtensions__?.rrweb?.record
    if (!record) throw new Error('Installed PostHog recorder did not load')
    const stop = record({ emit: (event) => events.push(event), blockClass: 'ph-no-capture' })
    stop?.()
    return JSON.stringify(events)
  })
}
async function seed() {
  assert(userId)
  const owner = userId
  await sql.begin(async (tx) => {
    await tx`insert into project (id, name, owner_id) values (${alphaId}, 'Extension QA project', ${owner})`
    for (const [id, name] of [
      [alphaId, 'Extension QA alpha'],
      [betaId, 'Extension QA beta'],
    ] as const) {
      await tx`insert into workspace (id, project_id, name, owner_id, billed_account_user_id) values (${id}, ${alphaId}, ${name}, ${owner}, ${owner})`
      await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type) values (${generateId()}, ${owner}, 'workspace', ${id}, 'admin')`
    }
    for (let index = 0; index < 24; index++) {
      const id = generateId()
      await tx`insert into workspace (id, project_id, name, owner_id, billed_account_user_id) values (${id}, ${alphaId}, ${`Extension QA workspace ${index + 1}`}, ${owner}, ${owner})`
      await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type) values (${generateId()}, ${owner}, 'workspace', ${id}, 'admin')`
    }
    await tx`update workspace set created_at = '2020-01-01T00:00:00Z' where id = ${alphaId}`
    await tx`insert into workflow (id, user_id, workspace_id, name, last_synced, created_at, updated_at) values (${workflowId}, ${owner}, ${alphaId}, 'Extension QA workflow', now(), now(), now())`
    await tx`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${otherUserId}, 'Other extension QA user', ${`extension-other-${otherUserId}@example.test`}, false, now(), now())`
    await tx`insert into project (id, name, owner_id) values (${deniedId}, 'Inaccessible QA project', ${otherUserId})`
    await tx`insert into workspace (id, project_id, name, owner_id, billed_account_user_id) values (${deniedId}, ${deniedId}, 'Inaccessible QA workspace', ${otherUserId}, ${otherUserId})`
    await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type) values (${generateId()}, ${otherUserId}, 'workspace', ${deniedId}, 'admin')`
    await tx`insert into copilot_chats (id, user_id, workspace_id, type, title) values (${historyId}, ${owner}, ${alphaId}, 'mothership', 'Extension QA history')`
    for (let index = 0; index < 15; index++) {
      await tx`insert into copilot_chats (id, user_id, workspace_id, type, title) values (${generateId()}, ${owner}, ${alphaId}, 'mothership', ${`Extension QA conversation ${index + 1}`})`
    }
    const previousQuestion = {
      id: generateId(),
      role: 'user',
      content: 'QA previous question.',
      timestamp: new Date().toISOString(),
    }
    await tx`insert into copilot_messages (id, chat_id, message_id, role, content, seq) values (${generateId()}, ${historyId}, ${previousQuestion.id}, 'user', ${tx.json(previousQuestion)}, 0)`
    const content = `QA history response. <source>{"id":"qa:evidence"}</source>\n\n<workspace_resource>{"type":"workflow","id":"${workflowId}","title":"Extension QA workflow"}</workspace_resource>`
    const message = {
      id: historyMessageId,
      requestId: historyRequestId,
      role: 'assistant',
      content,
      timestamp: new Date().toISOString(),
      contentBlocks: [
        {
          type: 'tool',
          phase: 'call',
          toolCall: {
            id: generateId(),
            name: 'search_workspace',
            state: 'success',
            result: {
              success: true,
              output: {
                success: true,
                data: {
                  results: [
                    {
                      citationId: 'qa:evidence',
                      citationUrl: 'https://example.com/qa-evidence',
                      documentName: 'QA evidence',
                      content: 'A grounded QA citation.',
                    },
                  ],
                },
              },
            },
          },
        },
        { type: 'text', channel: 'final', content },
      ],
    }
    await tx`insert into copilot_messages (id, chat_id, message_id, role, content, seq) values (${generateId()}, ${historyId}, ${historyMessageId}, 'assistant', ${tx.json(message)}, 1)`
  })
}

async function seedViewerOrganization() {
  assert(userId)
  await sql`insert into organization (id, name, slug, created_at) values (${organizationId}, 'Extension QA organization', ${organizationId}, now())`
  await sql`insert into member (id, user_id, organization_id, role) values (${generateId()}, ${userId}, ${organizationId}, 'owner')`
}
async function seedOtherOrganization() {
  assert(userId)
  await sql`insert into organization (id, name, slug, created_at) values (${otherOrganizationId}, 'Other QA organization', ${otherOrganizationId}, now())`
  await sql`insert into member (id, user_id, organization_id, role) values (${generateId()}, ${otherUserId}, ${otherOrganizationId}, 'owner')`
  await sql`insert into copilot_chats (id, user_id, organization_id, type, title, config) values (${otherOrganizationChatId}, ${userId}, ${otherOrganizationId}, 'mothership', 'Other organization history', ${sql.json({ conversationMode: 'agent' })})`
}
async function seedHostedWorkspace() {
  assert(userId)
  await sql`insert into project (id, name, owner_id, organization_id) values (${hostProjectId}, 'Hosted QA project', ${otherUserId}, ${otherOrganizationId})`
  await sql`insert into workspace (id, project_id, organization_id, name, owner_id, billed_account_user_id) values (${hostedWorkspaceId}, ${hostProjectId}, ${otherOrganizationId}, 'Hosted QA workspace', ${otherUserId}, ${otherUserId})`
  await sql`insert into permissions (id, user_id, entity_type, entity_id, permission_type) values (${generateId()}, ${userId}, 'workspace', ${hostedWorkspaceId}, 'admin')`
}

try {
  await mkdir(dirname(report), { recursive: true })
  const extensionPath = resolve(temporary, 'extension')
  const build = spawnSync(process.execPath, ['scripts/build.ts', `--outdir=${extensionPath}`], {
    cwd: extensionRoot,
    env: { ...process.env, SIM_EXTENSION_ORIGIN: base.origin, SIM_EXTENSION_DEV: '1' },
    encoding: 'utf8',
    timeout: 120_000,
  })
  assert.equal(build.status, 0, build.stderr)
  const manifest = JSON.parse(await readFile(resolve(extensionPath, 'manifest.json'), 'utf8'))
  const fixtureOrigin = `http://localhost:${fixtureAddress.port}`
  // Only the synthetic page is pregranted; native permission prompts are a separate acceptance check.
  manifest.host_permissions.push(`${fixtureOrigin}/*`)
  await writeFile(resolve(extensionPath, 'manifest.json'), JSON.stringify(manifest))
  const launchBrowserContext = async () => {
    const opened = await chromium.launchPersistentContext(resolve(temporary, 'profile'), {
      channel: 'chromium',
      headless: process.env.EXTENSION_APP_E2E_HEADED !== '1',
      viewport: { width: 390, height: 844 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--use-fake-device-for-media-stream',
      ],
    })
    opened.on('request', (request) => {
      const url = new URL(request.url())
      if (
        url.origin !== base.origin ||
        url.pathname !== '/api/mothership/chat' ||
        request.method() !== 'POST'
      )
        return
      const body = toRecord(request.postDataJSON())
      const id = toStringOrNull(body.userMessageId)
      if (id && !chatTurns.has(id)) chatTurns.set(id, chatTurns.size + 1)
      let sender = 'unknown'
      try {
        sender = request.frame().page() === panel ? 'current-panel' : 'other-page'
      } catch {}
      chatAttempts.push({
        attempt: chatAttempts.length + 1,
        turn: id ? (chatTurns.get(id) ?? null) : null,
        check: currentCheck,
        scenario,
        phase,
        scope:
          body.organizationId === organizationId
            ? 'organization'
            : body.workspaceId === alphaId
              ? 'workspace'
              : 'other',
        sender,
      })
    })
    return opened
  }
  context = await launchBrowserContext()
  let browserContext = context
  context.setDefaultTimeout(30_000)
  context.setDefaultNavigationTimeout(120_000)
  let worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  const extensionId = worker.url().split('/')[2]
  const setPageViewport = async (page: Page, width: number, height: number) => {
    await page.setViewportSize({ width, height })
    const session = await browserContext.newCDPSession(page)
    try {
      const { windowId } = await session.send('Browser.getWindowForTarget')
      // OOPIF hit testing uses the native content bounds, including below the browser toolbar.
      await session.send('Browser.setContentsSize', { windowId, width, height })
    } finally {
      await session.detach()
    }
  }
  const openPage = async () => {
    const page = await browserContext.newPage()
    const viewport = page.viewportSize()
    assert(viewport, 'Browser fixture must declare its viewport')
    await setPageViewport(page, viewport.width, viewport.height)
    return page
  }
  const openPanel = async () => {
    const page = await openPage()
    await page.route('**/api/settings/voice', (route) =>
      route.fulfill({ json: { sttAvailable: true } })
    )
    page.on('pageerror', (error) => browserErrors.push(error.message))
    page.on('request', (request) => {
      pendingRequests.add(request)
      const url = new URL(request.url())
      if (url.origin === base.origin && url.pathname.startsWith('/api/files/uploads'))
        uploadRequests.push({
          event: 'request',
          stage: url.pathname.endsWith('/complete') ? 'complete' : 'session',
          method: request.method(),
        })
    })
    page.on('requestfinished', (request) => pendingRequests.delete(request))
    page.on('requestfailed', (request) => {
      pendingRequests.delete(request)
      failedRequests.push({
        path: new URL(request.url()).pathname,
        error: request.failure()?.errorText ?? null,
      })
    })
    page.on('response', (response) => {
      const url = new URL(response.url())
      if (url.origin === base.origin && url.pathname.startsWith('/api/files/uploads'))
        uploadRequests.push({
          event: 'response',
          stage: url.pathname.endsWith('/complete') ? 'complete' : 'session',
          method: response.request().method(),
          status: response.status(),
        })
      if (url.origin === base.origin && url.pathname === '/api/mothership/chat') {
        const entry: (typeof chatResponses)[number] = {
          status: response.status(),
          chatId: response.headers()[MOTHERSHIP_CHAT_ID_HEADER.toLowerCase()] ?? null,
          events: [],
        }
        chatResponses.push(entry)
        responseDiagnostics.push(
          response
            .text()
            .then((body) => {
              for (const line of body.split('\n')) {
                if (!line.startsWith('data: ')) continue
                const event = toRecord(JSON.parse(line.slice(6)))
                entry.events.push({
                  type: toStringOrNull(event.type),
                  seq: toNumberOrNull(event.seq),
                })
              }
            })
            .catch((error) => {
              entry.error = reportError(error)
            })
        )
      }
      if (url.origin === base.origin && response.status() >= 400)
        httpErrors.push({
          path: url.pathname,
          status: response.status(),
          injected: injectedRequests.has(response.request()),
        })
    })
    return page
  }
  panel = await openPanel()
  let shell = panel
  const setPanelViewport = (width: number, height: number) => setPageViewport(shell, width, height)
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  const frame = () => {
    const app = shell.frames().find((candidate) => candidate.url().startsWith(base.origin))
    assert(app, 'Hosted app frame is unavailable')
    return app
  }
  const navigate = async (url: string) => {
    const navigation = frame().waitForNavigation({ waitUntil: 'load' })
    await frame().evaluate((destination) => window.location.assign(destination), url)
    await navigation
  }
  await checkNavigation('Signed-out users get the real top-level Sim sign-in flow', async () => {
    await expect(frame().getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
    await screenshot('signed-out')
    const link = frame().getByRole('link', { name: 'Sign in', exact: true })
    const opened = browserContext.waitForEvent('page')
    await link.click()
    const login = await opened
    await login.waitForURL('**/login**')
    assert.equal(new URL(login.url()).origin, base.origin)
    await login.close()
    const draft = await openPage()
    try {
      await draft.goto(`${base.origin}/extension/create-link`)
      await expect(draft.getByRole('heading', { name: 'Sign in to create a link' })).toBeVisible()
      await screenshot('create-link-sign-in', draft)
    } finally {
      await draft.close()
    }
  })
  const signInAndSeed = async () => {
    const signup = await browserContext.request.post(`${base.origin}/api/auth/sign-up/email`, {
      headers: { origin: base.origin },
      data: {
        name: 'Extension QA',
        email: `extension-${generateId()}@example.test`,
        password: generateRandomHex(24),
      },
    })
    assert.equal(signup.status(), 200, `Sign-up failed: ${await signup.text()}`)
    const payload: unknown = await signup.json()
    const id = toRecord(toRecord(payload).user).id
    assert.equal(typeof id, 'string')
    userId = String(id)
    await seed()
  }
  let login: Page | null = null
  await checkNavigation(
    'Manual refresh recovers sign-in without focus or visibility changes',
    async () => {
      login = await openPage()
      await login.goto(`${base.origin}/login`)
      const recovery = await openPanel()
      try {
        const signedOutSession = recovery.waitForResponse(
          (response) => new URL(response.url()).pathname === '/api/auth/get-session'
        )
        await recovery.goto(`chrome-extension://${extensionId}/sidepanel.html`)
        const app = recovery.frames().find((candidate) => candidate.url().startsWith(base.origin))
        assert(app, 'Recovery panel must load the real app')
        await app.getByRole('heading', { name: 'Sign in to Sim', exact: true }).click()
        assert.equal(await (await signedOutSession).json(), null)
        await expect
          .poll(
            () =>
              [...pendingRequests].filter(
                (request) =>
                  request.frame().page() === recovery &&
                  new URL(request.url()).pathname === '/api/auth/get-session'
              ).length
          )
          .toBe(0)
        const events = await app.evaluateHandle(() => {
          let focus = 0
          let visibility = 0
          const focused = () => focus++
          const visible = () => visibility++
          window.addEventListener('focus', focused)
          document.addEventListener('visibilitychange', visible)
          return {
            snapshot: () => ({
              focus,
              visibility,
              focused: document.hasFocus(),
              visibilityState: document.visibilityState,
            }),
            dispose: () => {
              window.removeEventListener('focus', focused)
              document.removeEventListener('visibilitychange', visible)
            },
          }
        })
        try {
          await signInAndSeed()
          const beforeRefresh = await events.evaluate((observer) => observer.snapshot())
          signInRecoveryReceipts.push({ phase: 'before-refresh', ...beforeRefresh })
          assert.deepEqual(beforeRefresh, {
            focus: 0,
            visibility: 0,
            focused: true,
            visibilityState: 'visible',
          })
          await expect(
            app.getByRole('heading', { name: 'Sign in to Sim', exact: true })
          ).toBeVisible()
          await screenshot('sign-in-manual-refresh', recovery)
          const [response] = await Promise.all([
            app.waitForNavigation({ waitUntil: 'load' }),
            app.getByRole('button', { name: 'Refresh', exact: true }).click(),
          ])
          assert(response, 'Refresh must return a document response')
          assert.equal(response.status(), 200)
          assert(response.request().isNavigationRequest(), 'Refresh must reload the app document')
          await expect(
            app.getByRole('link', { name: 'Extension QA alpha', exact: true })
          ).toBeVisible()
          signInRecoveryReceipts.push({ phase: 'recovered', documentStatus: response.status() })
          await screenshot('sign-in-manual-recovered', recovery)
        } finally {
          await events.evaluate((observer) => observer.dispose()).catch(() => {})
          await events.dispose()
        }
      } finally {
        await recovery.close()
      }
    }
  )
  await checkNavigation('A real Better Auth session reaches the extension iframe', async () => {
    assert(login, 'The sign-in tab must remain open until returning to the original panel')
    await login.close()
    await shell.bringToFront()
    await expect(
      frame().getByRole('link', { name: 'Extension QA alpha', exact: true })
    ).toBeVisible()
    await screenshot('workspace-picker')
    const workspaceList = frame().getByRole('navigation', { name: 'Workspaces', exact: true })
    assert(
      await workspaceList.evaluate((list) => {
        const scroll = list.closest('main')
        return scroll !== null && scroll.scrollHeight > scroll.clientHeight
      }),
      'The workspace picker fixture does not overflow'
    )
    await workspaceList.getByRole('link').last().scrollIntoViewIfNeeded()
    await screenshot('workspace-picker-end')
    await frame().getByRole('link', { name: 'Extension QA alpha', exact: true }).click()
    await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toBeVisible({
      timeout: 120_000,
    })
  })
  if (group === 'access' || group === 'composer') await signInAndSeed()
  if (group === 'composer') {
    await navigate(`${base.origin}/extension/${alphaId}`)
    await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
  }
  let source = await openPage()
  await source.goto(`${fixtureOrigin}/page?private=QUERY_SECRET#FRAGMENT_SECRET`)
  const observeCaptureReceipts = () =>
    shell.evaluate((origin) => {
      let receipts = 0
      document.body.dataset.captureReceipts = '0'
      window.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (
          event.origin !== origin ||
          event.source !== document.querySelector('iframe')?.contentWindow ||
          typeof event.data !== 'object' ||
          event.data === null ||
          !('type' in event.data) ||
          event.data.type !== 'context-received'
        )
          return
        document.body.dataset.captureReceipts = String(++receipts)
        if ('sessionId' in event.data && typeof event.data.sessionId === 'string')
          document.body.dataset.captureSession = event.data.sessionId
      })
    }, base.origin)
  await observeCaptureReceipts()
  const capture = async (mode: 'page' | 'selection' | 'shortcut' = 'page') => {
    await source.bringToFront()
    const before = Number(await shell.locator('body').getAttribute('data-capture-receipts'))
    if (mode === 'shortcut') {
      await frame().getByRole('button', { name: 'Attach current page', exact: true }).press('Enter')
    } else {
      await frame().getByRole('button', { name: 'Add resources', exact: true }).press('Enter')
      await frame()
        .getByRole('menuitem', {
          name: mode === 'page' ? 'Current page' : 'Selected text',
          exact: true,
        })
        .press('Enter')
    }
    await expect(shell.locator('body')).toHaveAttribute('data-capture-receipts', String(before + 1))
  }
  const attachments = () => frame().getByRole('group', { name: 'Page attached to next message' })
  const isUploadCompletion = (url: URL) =>
    url.pathname.startsWith('/api/files/uploads/') && url.pathname.endsWith('/complete')
  const uploadFile = async (name: string, add: () => Promise<void>): Promise<string> => {
    const [response] = await Promise.all([
      shell.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && isUploadCompletion(new URL(response.url()))
      ),
      add(),
    ])
    assert.equal(response.status(), 200, await response.text())
    const body: unknown = await response.json()
    const { key } = toRecord(toRecord(toRecord(body).data).result)
    assert(typeof key === 'string')
    trackUploadedFile(key)
    await expect(frame().getByRole('button', { name: `Remove ${name}`, exact: true })).toBeEnabled()
    return key
  }
  const attachFile = (name = 'extension-notes.txt') =>
    uploadFile(name, () =>
      frame()
        .locator('input[type="file"]')
        .setInputFiles({
          name,
          mimeType: 'text/plain',
          buffer: Buffer.from('This synthetic file belongs only to extension QA.'),
        })
    )
  const screenshotFile = async () => {
    const name = 'drop-fixture.png'
    const png = resolve(temporary, name)
    await writeFile(
      png,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwWXX3PwAFzALLC/VkdQAAAABJRU5ErkJggg==',
        'base64'
      )
    )
    return { name, png }
  }
  const attachScreenshot = async (target: Locator, scope?: string) => {
    const { name, png } = await screenshotFile()
    return uploadFile(name, async () => {
      const receipt = await dropOnChat(shell, target, { files: [png] })
      if (scope) {
        dropReceipts.push({ scope, phase: 'recovery', receipt })
        assert(
          receipt.events.some(
            (event) =>
              event.type === 'drop' &&
              event.trusted &&
              event.files === 1 &&
              event.chatBody &&
              event.intendedTarget &&
              event.defaultPrevented
          ),
          `${scope}: the recovery file drop did not reach the chat body`
        )
      }
    })
  }
  const installCaptureGate = () =>
    shell.addInitScript((parentOrigin) => {
      if (window.parent === window) return
      let held: MessageEvent<unknown> | undefined
      let armed = false
      const receive = (event: MessageEvent<unknown>) => {
        const message = event.data
        if (
          !armed ||
          event.source !== window.parent ||
          event.origin !== parentOrigin ||
          typeof message !== 'object' ||
          message === null ||
          !('channel' in message) ||
          message.channel !== 'sim-extension' ||
          !('type' in message) ||
          message.type !== 'send-context'
        )
          return
        held = event
        document.documentElement.dataset.qaCaptureGate = 'held'
        event.stopImmediatePropagation()
      }
      const arm = () => {
        armed = true
        document.documentElement.dataset.qaCaptureGate = 'armed'
      }
      const release = () => {
        armed = false
        const received = held
        held = undefined
        if (received)
          window.dispatchEvent(
            new MessageEvent('message', {
              data: received.data,
              origin: received.origin,
              source: received.source,
              lastEventId: received.lastEventId,
              ports: [...received.ports],
            })
          )
        document.documentElement.dataset.qaCaptureGate = 'released'
      }
      const dispose = () => {
        armed = false
        held = undefined
        window.removeEventListener('message', receive, true)
        window.removeEventListener('sim-qa-arm-capture', arm)
        window.removeEventListener('sim-qa-release-capture', release)
        window.removeEventListener('sim-qa-dispose-capture', dispose)
      }
      // Window message listeners run in registration order, including capture listeners.
      window.addEventListener('message', receive, true)
      window.addEventListener('sim-qa-arm-capture', arm)
      window.addEventListener('sim-qa-release-capture', release)
      window.addEventListener('sim-qa-dispose-capture', dispose)
    }, `chrome-extension://${extensionId}`)
  const verifyPendingCaptureDrop = async (scope: 'workspace' | 'organization' | 'assistant') => {
    const app = frame()
    const input = app.getByRole('textbox', {
      name: scope === 'workspace' ? 'Message' : 'Ask Sim',
      exact: true,
    })
    await expect(input).toBeVisible()
    const editorElement = await input.elementHandle()
    assert(editorElement, 'The pending capture needs a mounted composer')
    await expect(attachments()).toHaveCount(0)
    const greeting = app.getByRole('heading', { name: 'How can I help?', exact: true })
    await expect(greeting).toBeVisible()
    const priorPreference = await worker.evaluate(() =>
      chrome.storage.local.get('referenceCurrentPage')
    )
    const endpoint = `${base.origin}/api/mothership/chat`
    const uploadEndpoint = `${base.origin}/api/files/uploads`
    const submitted: Record<string, unknown>[] = []
    let uploadAttempts = 0
    const interceptChat = (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue()
      submitted.push(toRecord(route.request().postDataJSON()))
      injectedRequests.add(route.request())
      return route.fulfill({ status: 403, json: { error: 'QA pending capture admission check' } })
    }
    const interceptUpload = (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue()
      uploadAttempts++
      injectedRequests.add(route.request())
      return route.fulfill({ status: 409, json: { error: 'QA unexpected pending upload' } })
    }
    await browserContext.route(endpoint, interceptChat)
    await browserContext.route(uploadEndpoint, interceptUpload)
    try {
      await app.getByRole('button', { name: 'Add resources', exact: true }).press('Enter')
      const preference = app.getByRole('menuitemcheckbox', { name: 'Reference current page' })
      await expect(preference).toBeVisible()
      if ((await preference.getAttribute('aria-checked')) !== 'true')
        await preference.press('Enter')
      else await preference.press('Escape')
      await expect(
        app.getByRole('button', { name: 'Attach current page', exact: true })
      ).toHaveText('Current page')
      const draft = `Preserve the original ${scope} send during a screenshot drop.`
      await input.fill(draft)
      await expect(attachments()).toHaveCount(0)
      await app.evaluate(() => window.dispatchEvent(new Event('sim-qa-arm-capture')))
      await expect(
        app.locator('html'),
        `${scope}: capture gate installed before app startup`
      ).toHaveAttribute('data-qa-capture-gate', 'armed')
      await source.bringToFront()
      await input.press('Enter')
      await expect(
        app.locator('html'),
        `${scope}: genuine send-context held before app delivery`
      ).toHaveAttribute('data-qa-capture-gate', 'held')
      const preparing = () =>
        editorElement.evaluate((element) => Boolean(element.closest('[inert][aria-busy="true"]')))
      await expect
        .poll(preparing, { message: `${scope}: held capture keeps the composer inert` })
        .toBe(true)
      assert.equal(
        submitted.length,
        0,
        `${scope}: the capture gate did not defer the original send`
      )
      const { name, png } = await screenshotFile()
      const pageCount = browserContext.pages().length
      const previousUrl = app.url()
      const receipt = await dropOnChat(shell, greeting, { files: [png] })
      dropReceipts.push({ scope, phase: 'held-capture', receipt })
      assert(
        receipt.events.some(
          (event) =>
            event.type === 'dragover' &&
            event.trusted &&
            event.types.includes('Files') &&
            event.intendedTarget &&
            event.chatBody &&
            event.defaultPrevented
        ),
        `${scope}: the held-capture file drag did not reach the intended chat body`
      )
      await app.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      )
      await screenshot(`pending-capture-drop-${scope}`)
      assert.equal(uploadAttempts, 0, `${scope}: a body drop started uploading during capture`)
      await expect.poll(() => editorElement.inputValue()).toBe(draft)
      await expect(app.getByRole('button', { name: `Remove ${name}`, exact: true })).toHaveCount(0)
      assert.equal(submitted.length, 0, `${scope}: the held capture committed early`)
      assert.equal(app.url(), previousUrl)
      assert.equal(browserContext.pages().length, pageCount)
      await expect
        .poll(preparing, { message: `${scope}: held capture keeps the composer inert` })
        .toBe(true)
      await app.evaluate(() => window.dispatchEvent(new Event('sim-qa-release-capture')))
      await expect.poll(() => submitted.length).toBe(1)
      const body = submitted[0]
      assert(String(body.message).startsWith(draft))
      assert.equal(
        body[scope === 'workspace' ? 'workspaceId' : 'organizationId'],
        scope === 'workspace' ? alphaId : organizationId
      )
      if (scope === 'assistant') assert.equal(body.mode, 'assistant')
      const pages = submittedPages(body)
      assert.equal(pages.length, 1)
      assert(pages[0].text.includes('ORCHID-482'))
      assert.equal(pages[0].url, `${fixtureOrigin}/page`)
      assert.equal(body.fileAttachments, undefined)
      await expect
        .poll(
          () => input.evaluate((element) => Boolean(element.closest('[inert][aria-busy="true"]'))),
          { message: `${scope}: the current composer resumes after capture` }
        )
        .toBe(false)
      await expect(
        app.getByText('Your draft changed while the page was being read. Send again to continue.', {
          exact: true,
        })
      ).toHaveCount(0)
      assert.equal(uploadAttempts, 0)
      await browserContext.unroute(uploadEndpoint, interceptUpload)
      const recoveryKey = await attachScreenshot(app.getByRole('main'), scope)
      await screenshot(`pending-capture-drop-${scope}-recovered`)
      await app.getByRole('button', { name: `Remove ${name}`, exact: true }).click()
      await expect(app.getByRole('button', { name: `Remove ${name}`, exact: true })).toHaveCount(0)
      const persistedMatches = async () => {
        const stored: unknown = await app.evaluate(() =>
          JSON.parse(localStorage.getItem('mothership-drafts:v1') ?? '{}')
        )
        const drafts = toRecord(toRecord(toRecord(stored).state).drafts)
        return Object.values(drafts).filter((draft) => {
          const files = toRecord(draft).fileAttachments
          return Array.isArray(files) && files.some((file) => toRecord(file).key === recoveryKey)
        }).length
      }
      draftRemovalReceipts.push({
        scope,
        phase: 'after-ui-removal',
        matches: await persistedMatches(),
      })
      await expect
        .poll(persistedMatches, {
          message: `${scope}: removed recovery file leaves persisted drafts`,
        })
        .toBe(0)
      draftRemovalReceipts.push({
        scope,
        phase: 'before-tab-close',
        matches: await persistedMatches(),
      })
      assert.equal(submitted.length, 1, `${scope}: recovering drops duplicated the turn`)
    } finally {
      await app
        .evaluate(() => window.dispatchEvent(new Event('sim-qa-release-capture')))
        .catch(() => {})
      await app
        .evaluate(() => window.dispatchEvent(new Event('sim-qa-dispose-capture')))
        .catch(() => {})
      await editorElement.dispose()
      await browserContext.unroute(endpoint, interceptChat)
      await browserContext.unroute(uploadEndpoint, interceptUpload)
      await worker.evaluate(async (previous) => {
        if ('referenceCurrentPage' in previous) await chrome.storage.local.set(previous)
        else await chrome.storage.local.remove('referenceCurrentPage')
      }, priorPreference)
    }
  }
  await checkNavigation(
    'Capture, preview, and removal support ten pages in the real composer',
    async () => {
      await capture()
      await expect(attachments()).toHaveCount(1)
      await expect(frame().getByRole('button', { name: 'Send message', exact: true })).toBeEnabled({
        timeout: 5_000,
      })
      await attachments()
        .first()
        .getByRole('button', { name: /^Review page context:/ })
        .click()
      const preview = frame().getByRole('dialog', { name: 'Page context', exact: true })
      await expect(preview.locator('pre')).toHaveText(
        captureText.replace('QA_PRIVATE_PAGE_MARKER:', 'Delivery plan\nQA_PRIVATE_PAGE_MARKER:')
      )
      await screenshot('page-preview')
      const focusSession = await shell.locator('body').getAttribute('data-capture-session')
      assert(focusSession, 'The real capture did not acknowledge its session')
      const focusObserver = await shell.evaluateHandle(
        ({ origin, sessionId }) => {
          let focused = 0
          let processed = 0
          document.body.dataset.composerFocused = '0'
          document.body.dataset.focusProcessed = '0'
          const receive = (event: MessageEvent<unknown>) => {
            if (
              event.origin !== origin ||
              event.source !== document.querySelector('iframe')?.contentWindow ||
              typeof event.data !== 'object' ||
              event.data === null ||
              !('sessionId' in event.data) ||
              event.data.sessionId !== sessionId ||
              !('type' in event.data)
            )
              return
            if (event.data.type === 'composer-focused')
              document.body.dataset.composerFocused = String(++focused)
            if (event.data.type === 'e2e-focus-processed')
              document.body.dataset.focusProcessed = String(++processed)
          }
          window.addEventListener('message', receive)
          return () => window.removeEventListener('message', receive)
        },
        { origin: base.origin, sessionId: focusSession }
      )
      const focusBarrier = await frame().evaluateHandle(
        ({ origin, sessionId }) => {
          const receive = (event: MessageEvent<unknown>) => {
            if (
              event.origin !== origin ||
              event.source !== parent ||
              typeof event.data !== 'object' ||
              event.data === null ||
              !('sessionId' in event.data) ||
              event.data.sessionId !== sessionId ||
              !('type' in event.data) ||
              event.data.type !== 'focus-composer'
            )
              return
            parent.postMessage({ type: 'e2e-focus-processed', sessionId }, origin)
          }
          window.addEventListener('message', receive)
          return () => window.removeEventListener('message', receive)
        },
        { origin: `chrome-extension://${extensionId}`, sessionId: focusSession }
      )
      const requestComposerFocus = async (processed: number) => {
        await shell.evaluate(
          ({ origin, sessionId }) =>
            document
              .querySelector('iframe')
              ?.contentWindow?.postMessage(
                { channel: 'sim-extension', version: 1, type: 'focus-composer', sessionId },
                origin
              ),
          { origin: base.origin, sessionId: focusSession }
        )
        await expect(shell.locator('body')).toHaveAttribute(
          'data-focus-processed',
          String(processed)
        )
      }
      try {
        await shell.bringToFront()
        const close = preview.getByRole('button', { name: 'Close', exact: true })
        await close.focus()
        await expect(close).toBeFocused()
        assert(await frame().evaluate(() => document.hasFocus()))
        await requestComposerFocus(1)
        assert.equal(
          await shell.locator('body').getAttribute('data-composer-focused'),
          '0',
          'An app dialog must not acknowledge composer focus'
        )
        await expect(close).toBeFocused()
        await close.press('Tab')
        assert(await preview.evaluate((element) => element.contains(document.activeElement)))
        await requestComposerFocus(2)
        assert.equal(await shell.locator('body').getAttribute('data-composer-focused'), '0')
        await screenshot('focus-deferred-by-page-preview')
        await close.click()
        await expect(preview).toHaveCount(0)
        await requestComposerFocus(3)
        const editor = frame().getByRole('textbox', { name: 'Message', exact: true })
        await expect(editor).toBeFocused()
        await expect(shell.locator('body')).toHaveAttribute('data-composer-focused', '1')
        await shell.keyboard.type('Keyboard input belongs to the composer.')
        await expect(editor).toHaveValue('Keyboard input belongs to the composer.')
        await screenshot('focus-confirmed-in-composer')
        await editor.fill('')
      } finally {
        await focusBarrier.evaluate((stop) => stop())
        await focusObserver.evaluate((stop) => stop())
        await focusBarrier.dispose()
        await focusObserver.dispose()
      }
      for (let count = 2; count <= 10; count++) {
        await capture()
        await expect(attachments()).toHaveCount(count)
      }
      await expect(frame().getByRole('alert').filter({ hasText: 'Remove a page' })).toHaveCount(0)
      await screenshot('many-pages')
      for (let count = 10; count > 2; count--) {
        await attachments().first().getByRole('button', { name: 'Remove page context' }).click()
        await expect(attachments()).toHaveCount(count - 1)
      }
      await expect(attachments()).toHaveCount(2)
      const stored = await frame().evaluate(() => JSON.stringify(localStorage))
      assert(
        !stored.includes('QA_PRIVATE_PAGE_MARKER'),
        'Unsent page bytes entered app localStorage'
      )
    }
  )
  await checkNavigation(
    'Toolbar and authenticated chat align at 320/390 pixels in light and dark themes',
    async () => {
      for (const theme of ['light', 'dark'] as const) {
        const settings = await browserContext.request.patch(
          `${base.origin}/api/users/me/settings`,
          { data: { theme } }
        )
        assert.equal(settings.status(), 200)
        await navigate(`${base.origin}/extension/${alphaId}`)
        await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
        for (const width of [320, 390]) {
          await setPanelViewport(width, 844)
          await expect
            .poll(() =>
              shell.evaluate(
                () =>
                  getComputedStyle(document.querySelector('main') ?? document.body).backgroundColor
              )
            )
            .toBe(
              await frame().evaluate(
                () =>
                  getComputedStyle(document.querySelector('main') ?? document.body).backgroundColor
              )
            )
          for (const surface of [shell, frame()]) {
            const dimensions = await surface.evaluate(async () => {
              await document.fonts.ready
              return {
                width: innerWidth,
                scroll: document.documentElement.scrollWidth,
                font: getComputedStyle(document.body).fontFamily,
              }
            })
            assert(dimensions.scroll <= dimensions.width + 1, `Horizontal overflow at ${width}px`)
            assert(
              /season/i.test(dimensions.font),
              `Season font is not applied in ${surface === shell ? 'shell' : 'app'}: ${dimensions.font}`
            )
          }
          await expect(attachments()).toHaveCount(0)
          await screenshot(`${theme}-${width}`)
          await capture()
          await expect(attachments()).toHaveCount(1)
          await expect
            .poll(() =>
              frame()
                .getByRole('button', { name: 'Send message', exact: true })
                .evaluate((button) => {
                  const bounds = button.getBoundingClientRect()
                  return bounds.top >= 0 && bounds.bottom <= innerHeight
                })
            )
            .toBe(true)
          if (width === 320) {
            const chip = attachments().first()
            const visible = await chip.screenshot({ animations: 'disabled' })
            const withoutEdgeMask = await chip.screenshot({
              animations: 'disabled',
              style:
                'div:has(> div > [aria-label="Page attached to next message"]) { mask-image: none !important; }',
            })
            assert(
              visible.equals(withoutEdgeMask),
              'The attachment strip faded a fully visible chip'
            )
          }
          await screenshot(`${theme}-${width}-attached`)
          if (theme === 'light' && width === 320) {
            await frame()
              .getByRole('button', { name: 'Add resources', exact: true })
              .evaluate((button) => (button as HTMLButtonElement).click())
            await screenshot('capture-menu')
            await frame()
              .getByRole('menuitem', { name: 'Page access', exact: true })
              .evaluate((button) => (button as HTMLElement).click())
            const access = shell.getByRole('dialog', { name: 'Page access', exact: true })
            await expect(
              access.getByRole('button', { name: 'Allow across websites', exact: true })
            ).toBeVisible()
            await expect(
              frame().getByRole('menuitem', { name: 'Page access', exact: true })
            ).toHaveCount(0)
            await screenshot('site-options')
            await access.getByRole('button', { name: 'Close', exact: true }).click()
          }
          await shell.bringToFront()
          await attachments().getByRole('button', { name: 'Remove page context' }).click()
          await expect(attachments()).toHaveCount(0)
        }
      }
    }
  )
  await checkNavigation(
    'Workspace and conversation navigation clear pending page context',
    async () => {
      await capture()
      await expect(attachments()).toHaveCount(1)
      await frame().getByRole('button', { name: 'Extension QA alpha', exact: true }).click()
      await screenshot('workspace-menu')
      await expect(
        frame().getByRole('menuitem', { name: 'Extension QA alpha', exact: true })
      ).toBeDisabled()
      await frame().getByRole('menuitem', { name: 'Extension QA beta', exact: true }).click()
      await expect(
        frame().getByRole('button', { name: 'Extension QA beta', exact: true })
      ).toBeVisible()
      await expect(attachments()).toHaveCount(0)
      await navigate(`${base.origin}/extension/${alphaId}`)
      await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
      await capture()
      await frame().getByRole('button', { name: 'Chat history' }).click()
      await screenshot('chat-history')
      await frame().getByRole('menu').press('End')
      await screenshot('chat-history-end')
      await frame().getByRole('menuitem', { name: 'Extension QA history' }).click()
      await expect(attachments()).toHaveCount(0)
      await expect(frame().getByText('QA history response.', { exact: false })).toBeVisible()
    }
  )
  await checkNavigation(
    'Page chips protect draft history and support page-only Enter at the HTTP boundary',
    async () => {
      const editor = frame().getByRole('textbox', { name: 'Message', exact: true })
      await capture()
      await editor.press('ArrowUp')
      await expect(editor).toHaveValue('', { timeout: 5_000 })
      await attachments().first().getByRole('button', { name: 'Remove page context' }).click()
      await editor.press('ArrowUp')
      await expect(editor).toHaveValue('QA previous question.')
      await editor.fill('')
      await capture()
      const endpoint = `${base.origin}/api/mothership/chat`
      await browserContext.route(endpoint, (route) =>
        route.fulfill({
          status: 403,
          json: { error: 'QA intentionally declines admission after observing the request.' },
        })
      )
      try {
        const request = browserContext.waitForEvent('request', {
          predicate: (entry) => entry.url() === endpoint && entry.method() === 'POST',
          timeout: 10_000,
        })
        await editor.press('Enter')
        const payload = toRecord((await request).postDataJSON())
        assert.equal(typeof payload.message, 'string')
        assert.equal(String(payload.message).trim(), '@Page')
        const contexts = chatContextsSchema.parse(payload.contexts)
        const pageContext = contexts.find((entry) => entry.kind === 'browser_page')
        if (!pageContext?.snapshot) throw new Error('Page-only submission lost its snapshot')
        assert(
          pageContext.snapshot.text.includes('QA_PRIVATE_PAGE_MARKER'),
          'Page-only submission lost its snapshot'
        )
        const savedContexts = [
          { kind: 'browser_page', label: pageContext.label, snapshot: pageContext.snapshot },
        ]
        await sql`update copilot_messages set content = jsonb_set(jsonb_set(content, '{contexts}', ${sql.json(savedContexts)}), '{content}', ${sql.json('QA previous question. @Page')}) where chat_id = ${historyId} and role = 'user'`
        await expect(attachments()).toHaveCount(0)
        await expect(
          frame().getByText('QA intentionally declines admission after observing the request.', {
            exact: false,
          })
        ).toBeVisible()
        await screenshot('submission-error')
      } finally {
        await browserContext.unroute(endpoint)
      }
      await navigate(`${base.origin}/extension/${alphaId}?chat=${historyId}`)
      await expect(frame().getByText('QA history response.', { exact: false })).toBeVisible()
    }
  )
  await browserContext.route('**/__extension-qa-recorder.js', (route) =>
    route.fulfill({
      path: resolve(dirname(require.resolve('posthog-js')), 'posthog-recorder.js'),
      contentType: 'application/javascript',
    })
  )
  await checkNavigation(
    'Saved page previews stay out of session replay in the full app',
    async () => {
      const opened = browserContext.waitForEvent('page')
      await frame().getByRole('link', { name: 'Open in Sim', exact: true }).click()
      const app = await opened
      try {
        await app.waitForURL(`${base.origin}/workspace/${alphaId}/chat/${historyId}`)
        await app.getByRole('button', { name: 'Review page context: Extension QA page' }).click()
        const preview = app.getByRole('dialog', { name: 'Page context', exact: true })
        await expect(preview).toBeVisible()
        await expect(preview.getByText(captureText, { exact: false })).toBeVisible()
        await app.evaluate(() => {
          const control = document.createElement('p')
          control.textContent = 'QA_PUBLIC_REPLAY_CONTROL'
          document.body.append(control)
        })
        const recorded = await recordSnapshot(app)
        assert(recorded.includes('"type":2'), 'Recorder did not produce a full DOM snapshot')
        assert(recorded.includes('QA_PUBLIC_REPLAY_CONTROL'), 'Ordinary page text was not recorded')
        assert(!recorded.includes('QA_PRIVATE_PAGE_MARKER'), 'Page text entered session replay')
        assert(!recorded.includes('Extension QA page'), 'Page title entered session replay')
        assert(!recorded.includes(fixtureOrigin), 'Page URL entered session replay')
        await app
          .getByText('QA_PUBLIC_REPLAY_CONTROL', { exact: true })
          .evaluate((element) => element.remove())
        const path = `${report}.full-app-page-preview.png`
        await app.screenshot({ path, fullPage: true, animations: 'disabled' })
        screenshots.push(path)
      } finally {
        await app.close()
      }
    }
  )
  await checkComposer(
    'The ordinary web composer accepts text selections and rejects links and remote images',
    async () => {
      const app = await openPage()
      const remote = new URL('/ordinary-drop-image.png', fixtureOrigin)
      const navigationAttempts: string[] = []
      await browserContext.route(remote.href, (route) => {
        navigationAttempts.push(route.request().url())
        return route.abort()
      })
      try {
        await app.goto(`${base.origin}/workspace/${alphaId}/chat/${historyId}`)
        const input = app.getByRole('textbox', { name: 'Message', exact: true })
        await input.fill('Keep the ordinary draft')
        const drop = await app.evaluateHandle(() => {
          let received: DragEvent | undefined
          document.addEventListener(
            'drop',
            (event) => {
              received = event
            },
            { capture: true, once: true }
          )
          return () => received?.defaultPrevented
        })
        const pageCount = browserContext.pages().length
        const image = { text: remote.href, html: `<img src="${remote.href}">`, uri: remote.href }
        await dropOnChat(
          app,
          app.getByRole('button', { name: 'Add resources', exact: true }),
          image
        )
        assert.equal(await drop.evaluate((prevented) => prevented()), true)
        for (const payload of [
          image,
          { text: 'Image caption', html: `<img src="${remote.href}" alt="Image caption">` },
          { text: 'Link caption', html: `<a href="${remote.href}">Link caption</a>` },
          {
            text: 'Selected text',
            html: `<strong>${' '.repeat(PASTE_RENDER_THRESHOLDS.ENHANCED_TEXT_CHARACTERS)}Selected text</strong>`,
          },
        ]) {
          await dropOnChat(app, input, payload)
          await expect(input).toHaveValue('Keep the ordinary draft')
        }
        assert.equal(browserContext.pages().length, pageCount)
        assert.deepEqual(navigationAttempts, [])
        for (const payload of [
          { text: 'Plain text from another app' },
          { text: 'Selected text', html: '<p>Selected <strong>text</strong></p>' },
        ]) {
          await input.fill('')
          await dropOnChat(app, input, payload)
          await expect(input).toHaveValue(payload.text)
        }
      } finally {
        await browserContext.unroute(remote.href)
        await app.close()
      }
    }
  )
  await checkNavigation(
    'Sources and resource actions preserve their real destinations',
    async () => {
      await frame().getByRole('button', { name: '1 source', exact: true }).click()
      await frame().getByRole('button', { name: 'View all sources' }).click()
      const dialog = frame().getByRole('dialog', { name: 'Cited sources' })
      await expect(dialog).toBeVisible()
      await screenshot('sources')
      await expect(dialog.getByRole('link', { name: 'QA evidence' })).toHaveAttribute(
        'href',
        'https://example.com/qa-evidence'
      )
      await shell.bringToFront()
      await dialog.getByRole('button', { name: 'Actions for QA evidence' }).click()
      await frame().getByRole('menuitem', { name: 'Copy link', exact: true }).click()
      await expect(dialog.getByRole('button', { name: 'Link copied', exact: true })).toBeVisible()
      await screenshot('source-link-copied')
      const recorded = await recordSnapshot(frame())
      assert(recorded.includes('"type":2'), 'Recorder did not produce a full DOM snapshot')
      assert(!recorded.includes('QA evidence'), 'Portaled citation content entered session replay')
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect.poll(() => new URL(frame().url()).searchParams.get('source-message')).toBeNull()
      await navigate(
        `${base.origin}/extension/${alphaId}?chat=${historyId}&source-message=live-assistant:${historyRequestId}&source-request=${historyRequestId}`
      )
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('link', { name: 'QA evidence' })).toHaveAttribute(
        'href',
        'https://example.com/qa-evidence'
      )
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      const popup = browserContext.waitForEvent('page')
      await frame().getByRole('button', { name: 'Extension QA workflow', exact: true }).click()
      const resource = await popup
      await resource.waitForURL(`${base.origin}/workspace/${alphaId}/w/${workflowId}`)
      assert.equal(await resource.evaluate(() => window.opener), null)
      await resource.close()
      await frame().getByRole('button', { name: 'New chat', exact: true }).click()
      await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('')
    }
  )
  await checkNavigation(
    'A sanitized link draft saves in the current organization and opens its destination',
    async () => {
      let draft = await openPage()
      await setPageViewport(draft, 1280, 900)
      const endpoint = `/api/organizations/${organizationId}/sim-links`
      let writes = 0
      draft.on('request', (request) => {
        if (new URL(request.url()).pathname === endpoint && request.method() === 'POST') writes++
      })
      try {
        await draft.goto(`${base.origin}/extension/create-link`)
        await expect(
          draft.getByRole('heading', { name: 'Links unavailable', exact: true })
        ).toBeVisible()
        await screenshot('create-link-unavailable', draft)
        await draft.close()
        await seedViewerOrganization()
        draft = await openPage()
        await setPageViewport(draft, 1280, 900)
        draft.on('request', (request) => {
          if (new URL(request.url()).pathname === endpoint && request.method() === 'POST') writes++
        })
        const destination = `${fixtureOrigin}/page`
        const hash = new URLSearchParams({
          url: `${destination}?private=QUERY_SECRET#FRAGMENT_SECRET`,
        })
        await draft.goto(`${base.origin}/extension/create-link#${hash}`)
        const dialog = draft.getByRole('dialog', { name: 'New link', exact: true })
        await expect(
          dialog.getByRole('textbox', { name: 'Destination URL', exact: true })
        ).toHaveValue(destination)
        await expect.poll(() => new URL(draft.url()).hash).toBe('')
        await screenshot('create-link-draft', draft)
        await dialog.getByRole('button', { name: 'Create', exact: true }).click()
        await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveAttribute(
          'aria-invalid',
          'true'
        )
        assert.equal(writes, 0, 'An invalid draft reached the create boundary')
        await screenshot('create-link-validation', draft)
        await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('qa-draft')
        const saved = draft.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === endpoint && response.request().method() === 'POST'
        )
        await dialog.getByRole('button', { name: 'Create', exact: true }).click()
        assert.equal((await saved).status(), 200)
        await draft.waitForURL(`${base.origin}/o/${organizationId}/links`)
        const [row] =
          await sql`select name, url from sim_link where organization_id=${organizationId}`
        assert.equal(row?.name, 'qa-draft')
        assert.equal(row?.url, destination)
        const link = draft.getByRole('row').filter({ hasText: 'qa-draft' })
        await expect(link).toBeVisible()
        await screenshot('create-link-saved', draft)
        const opened = browserContext.waitForEvent('page')
        await link.click()
        const resolved = await opened
        try {
          await resolved.waitForURL(destination)
        } finally {
          await resolved.close()
        }
      } catch (error) {
        if (!draft.isClosed()) await screenshot('create-link-failure', draft).catch(() => {})
        throw error
      } finally {
        await draft.close()
        await sql`delete from organization where id=${organizationId}`
      }
    }
  )
  await checkComposer(
    'Voice input cancels startup, recovers permission, and preserves drafts through Send or restart',
    async () => {
      const input = frame().getByRole('textbox', { name: 'Message', exact: true })
      const mic = frame().getByRole('button', { name: 'Voice input', exact: true })
      const stop = frame().getByRole('button', { name: 'Stop listening', exact: true })
      const sessions: { socket: WebSocketRoute; chunks: number; closed: boolean }[] = []
      const connectionGate = createDeferred<void>()
      const tokenGate = createDeferred<void>()
      let holdToken = false
      let tokenRequested = false
      await shell.route('**/api/speech/token', async (route) => {
        injectedRequests.add(route.request())
        if (holdToken) {
          tokenRequested = true
          await tokenGate.promise
        }
        return route.fulfill({ json: { token: 'synthetic-extension-voice' } })
      })
      await shell.routeWebSocket(
        'wss://api.elevenlabs.io/v1/speech-to-text/realtime*',
        async (socket) => {
          const session = { socket, chunks: 0, closed: false }
          sessions.push(session)
          socket.onMessage((message) => {
            const data = toRecord(JSON.parse(String(message)))
            if (typeof data.audio_base_64 === 'string' && data.audio_base_64.length > 0) {
              assert.equal(data.sample_rate, 16000)
              assert(Buffer.from(data.audio_base_64, 'base64').length > 0)
              session.chunks++
            }
          })
          socket.onClose(async () => {
            await socket.close()
            session.closed = true
          })
          if (sessions.length === 1) await connectionGate.promise
        }
      )
      type VoiceCaptureWindow = typeof window & {
        __voiceCaptureProbe?: {
          getUserMedia: MediaDevices['getUserMedia']
          WebSocket: typeof WebSocket
          tracks: MediaStreamTrack[]
          sockets: WebSocket[]
        }
      }
      await frame().evaluate(() => {
        const probe = {
          getUserMedia: navigator.mediaDevices.getUserMedia,
          WebSocket: window.WebSocket,
          tracks: [] as MediaStreamTrack[],
          sockets: [] as WebSocket[],
        }
        ;(window as VoiceCaptureWindow).__voiceCaptureProbe = probe
        navigator.mediaDevices.getUserMedia = async (constraints) => {
          const stream = await probe.getUserMedia.call(navigator.mediaDevices, constraints)
          probe.tracks.push(...stream.getTracks())
          return stream
        }
        window.WebSocket = class extends probe.WebSocket {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols)
            probe.sockets.push(this)
          }
        }
      })
      const captureState = () =>
        frame().evaluate(() => {
          const probe = (window as VoiceCaptureWindow).__voiceCaptureProbe
          return {
            tracks: probe?.tracks.map((track) => track.readyState) ?? [],
            sockets: probe?.sockets.map((socket) => socket.readyState) ?? [],
          }
        })
      const microphone = await browserContext.newCDPSession(shell)
      const setMicrophonePermission = async (setting: 'granted' | 'denied') => {
        await microphone.send('Browser.setPermission', {
          permission: { name: 'microphone' },
          setting,
          origin: `chrome-extension://${extensionId}`,
          embeddedOrigin: base.origin,
        })
        const state = await frame().evaluate(
          async () =>
            (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state
        )
        voiceDiagnostics.push({ event: 'permission', setting, state })
        assert.equal(state, setting)
      }
      const submitted: Record<string, unknown>[] = []
      await shell.route('**/api/mothership/chat', (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        submitted.push(toRecord(route.request().postDataJSON()))
        injectedRequests.add(route.request())
        return route.fulfill({ status: 403, json: { error: 'QA admission rejected' } })
      })
      try {
        await expect(mic).toBeVisible()
        await input.fill('Keep my draft')
        assert.equal(sessions.length, 0, 'Voice started before an explicit click')
        await screenshot('microphone-ready')
        await setMicrophonePermission('denied')
        await mic.click()
        const settings = frame().getByRole('button', { name: 'Open settings', exact: true })
        await expect(settings).toBeVisible()
        await expect(input).toHaveValue('Keep my draft')
        assert.equal(sessions.length, 0, 'Denied microphone started transcription')
        await screenshot('microphone-blocked')
        const opened = browserContext.waitForEvent('page')
        await settings.click()
        const settingsPage = await opened
        await settingsPage.waitForURL('chrome://settings/content/microphone')
        await settingsPage.close()
        await shell.bringToFront()
        const viewport = shell.viewportSize()
        assert(viewport)
        await setPanelViewport(viewport.width, viewport.height)
        await setMicrophonePermission('granted')
        await mic.click()
        await expect.poll(() => sessions.length).toBe(1)
        await expect.poll(captureState).toEqual({ tracks: ['live'], sockets: [0] })
        await screenshot('microphone-connecting')
        await frame()
          .getByRole('button', { name: /^(Voice input|Stop listening)$/ })
          .click()
        await expect.poll(captureState).toEqual({ tracks: ['ended'], sockets: [3] })
        await expect.poll(() => sessions[0].closed).toBe(true)
        voiceDiagnostics.push({ event: 'cancel-connecting', ...(await captureState()) })
        connectionGate.resolve()
        await expect(mic).toBeVisible()
        await expect(input).toHaveValue('Keep my draft')
        assert.equal(sessions[0].chunks, 0, 'Cancelled startup sent audio')

        holdToken = true
        await mic.click()
        await expect.poll(() => tokenRequested).toBe(true)
        await stop.click()
        tokenGate.resolve()
        holdToken = false
        await expect(mic).toBeVisible()
        await expect(input).toHaveValue('Keep my draft')
        await mic.click()
        await expect(stop).toBeVisible()
        await expect.poll(() => sessions[1]?.chunks ?? 0).toBeGreaterThan(0)
        assert.equal(sessions.length, 2, 'Cancelled token request started another session')
        assert.deepEqual((await captureState()).tracks, ['ended', 'live'])
        sessions[1].socket.send(
          JSON.stringify({ message_type: 'partial_transcript', text: 'first thought' })
        )
        await expect(input).toHaveValue('Keep my draft first thought')
        await screenshot('microphone-listening')
        await stop.click()
        await expect(mic).toBeVisible()
        await mic.click()
        await expect(stop).toBeVisible()
        await expect.poll(() => sessions.length).toBe(3)
        sessions[1].socket.send(
          JSON.stringify({ message_type: 'partial_transcript', text: 'stale thought' })
        )
        await expect.poll(() => sessions[1].closed).toBe(true)
        await expect(stop).toBeVisible()
        await expect(input).toHaveValue('Keep my draft first thought')
        const chunks = sessions[2].chunks
        await expect.poll(() => sessions[2].chunks).toBeGreaterThan(chunks)
        sessions[2].socket.send(
          JSON.stringify({ message_type: 'partial_transcript', text: 'second thought' })
        )
        await expect(input).toHaveValue('Keep my draft first thought second thought')
        await input.press('Enter')
        await expect.poll(() => submitted.length).toBe(1)
        assert.equal(submitted[0].message, 'Keep my draft first thought second thought')
        await expect(input).toHaveValue('')
        await expect(mic).toBeVisible()
        await expect.poll(() => sessions[2].closed).toBe(true)
        await expect(
          frame().getByRole('button', { name: 'Send message', exact: true })
        ).toBeVisible()
        await input.fill('Another draft')
        await mic.click()
        await expect(stop).toBeVisible()
        await expect.poll(() => sessions[3]?.chunks ?? 0).toBeGreaterThan(0)
        sessions[3].socket.send(
          JSON.stringify({ message_type: 'partial_transcript', text: 'ready to send' })
        )
        await expect(input).toHaveValue('Another draft ready to send')
        await screenshot('microphone-dictated-draft')
        await stop.click()
        await input.press('Enter')
        await expect(input).toHaveValue('')
        assert.equal(sessions[3].closed, false, 'Final-transcript grace must still be open')
        sessions[3].socket.send(
          JSON.stringify({ message_type: 'partial_transcript', text: 'late words' })
        )
        await expect.poll(() => sessions[3].closed).toBe(true)
        await expect(input).toHaveValue('')
        assert.equal(submitted.length, 2, 'Dictation submitted a message without Send')
        await screenshot('microphone-after-send')
      } finally {
        voiceDiagnostics.push({ event: 'capture-finally', ...(await captureState()) })
        connectionGate.resolve()
        tokenGate.resolve()
        await frame().evaluate(() => {
          const probeWindow = window as VoiceCaptureWindow
          const probe = probeWindow.__voiceCaptureProbe
          if (!probe) return
          navigator.mediaDevices.getUserMedia = probe.getUserMedia
          window.WebSocket = probe.WebSocket
          probe.tracks.forEach((track) => track.stop())
          probeWindow.__voiceCaptureProbe = undefined
        })
        voiceDiagnostics.push({
          event: 'finally',
          sessions: sessions.map(({ chunks, closed }) => ({ chunks, closed })),
        })
        await shell.unroute('**/api/speech/token')
        await shell.unroute('**/api/mothership/chat')
        await microphone.send('Browser.resetPermissions')
        await microphone.detach()
      }
    }
  )
  await checkComposer(
    'Files and pages share the attachment row, remove independently, and reach the submission boundary together',
    async () => {
      await capture()
      await attachFile()
      await setPanelViewport(320, 844)
      await capture()
      await capture()
      const geometry = await attachments()
        .first()
        .evaluate((chip) => {
          const strip = chip.parentElement?.parentElement
          if (!strip) throw new Error('Missing attachment strip')
          return { height: strip.clientHeight, contentHeight: strip.scrollHeight }
        })
      assert(geometry.contentHeight > 102, 'The fixture did not exercise multiple attachment rows')
      assert(
        geometry.contentHeight <= geometry.height + 1,
        'Desktop attachments require nested scrolling'
      )
      await screenshot('mixed-attachments')
      const device = await browserContext.newCDPSession(frame())
      try {
        await device.send('Emulation.setTouchEmulationEnabled', {
          enabled: true,
          maxTouchPoints: 1,
        })
        await expect
          .poll(() => frame().evaluate(() => matchMedia('(pointer: coarse)').matches))
          .toBe(true)
        const touchGeometry = await attachments()
          .first()
          .evaluate((chip) => {
            const strip = chip.parentElement?.parentElement
            if (!strip) throw new Error('Missing attachment strip')
            const style = getComputedStyle(strip)
            const padding =
              Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
            return {
              height: strip.clientHeight,
              contentHeight: strip.scrollHeight,
              usableHeight: strip.clientHeight - padding,
            }
          })
        assert.equal(
          touchGeometry.usableHeight,
          102,
          'Two 48px attachment rows and their gap must fit on touch'
        )
        assert(
          touchGeometry.contentHeight > touchGeometry.height,
          'Touch overflow fixture did not wrap'
        )
        await screenshot('touch-attachments')
      } finally {
        await device.send('Emulation.setTouchEmulationEnabled', { enabled: false })
        await device.detach()
      }
      await attachments().last().getByRole('button', { name: 'Remove page context' }).click()
      await attachments().last().getByRole('button', { name: 'Remove page context' }).click()
      await setPanelViewport(390, 844)
      await attachments().first().getByRole('button', { name: 'Remove page context' }).click()
      await expect(
        frame().getByRole('button', { name: 'Remove extension-notes.txt', exact: true })
      ).toBeEnabled()
      await capture()
      await frame().getByRole('button', { name: 'Remove extension-notes.txt', exact: true }).click()
      await expect(attachments()).toHaveCount(1)
      await attachFile()
      const endpoint = `${base.origin}/api/mothership/chat`
      await browserContext.route(endpoint, (route) =>
        route.fulfill({ status: 403, json: { error: 'QA mixed attachment admission check' } })
      )
      try {
        const request = browserContext.waitForEvent('request', {
          predicate: (entry) => entry.url() === endpoint && entry.method() === 'POST',
        })
        await frame()
          .getByRole('textbox', { name: 'Message', exact: true })
          .fill('Use the attached page and file.')
        await shell.bringToFront()
        await frame().getByRole('button', { name: 'Send message', exact: true }).press('Enter')
        const payload = toRecord((await request).postDataJSON())
        assert(
          Array.isArray(payload.fileAttachments) && payload.fileAttachments.length === 1,
          'File attachment was lost'
        )
        assert.equal(toRecord(payload.fileAttachments[0]).filename, 'extension-notes.txt')
        assert(
          Array.isArray(payload.contexts) && payload.contexts.length === 1,
          'Page attachment was lost'
        )
        assert(
          pageSnapshotSchema
            .parse(toRecord(payload.contexts[0]).snapshot)
            .text.includes('QA_PRIVATE_PAGE_MARKER')
        )
        await expect(
          frame().getByText('QA mixed attachment admission check', { exact: false })
        ).toBeVisible()
      } finally {
        await browserContext.unroute(endpoint)
      }
      await navigate(`${base.origin}/extension/${alphaId}`)
      await expect(attachments()).toHaveCount(0)
    }
  )
  await checkComposer(
    'Selected text attaches only the selected excerpt through the shared plus menu',
    async () => {
      await source.evaluate(() => {
        const text = document.querySelector('p')?.firstChild
        if (!text) throw new Error('Selection fixture is missing')
        const range = document.createRange()
        const start = text.textContent?.indexOf('The launch code') ?? -1
        if (start < 0) throw new Error('Selection fixture is missing')
        range.setStart(text, start)
        range.setEnd(text, start + 'The launch code is ORCHID-482.'.length)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      })
      await capture('selection')
      await expect(attachments()).toHaveCount(1)
      await attachments()
        .first()
        .getByRole('button', { name: /^Review page context:/ })
        .click()
      const preview = frame().getByRole('dialog', { name: 'Page context', exact: true })
      await expect(preview.locator('pre')).toHaveText('The launch code is ORCHID-482.')
      await screenshot('selection-preview')
      await preview.getByRole('button', { name: 'Close', exact: true }).click()
      await attachments().first().getByRole('button', { name: 'Remove page context' }).click()
      await source.evaluate(() => window.getSelection()?.removeAllRanges())
    }
  )
  const verifyLiveChat = async (scope: {
    name: string
    url: string
    inputLabel: string
    draftKey: string
    organizationId?: string
  }) => {
    await navigate(scope.url)
    const captureScreenshot = (name: string) => screenshot(`${scope.name}-${name}`)
    const input = frame().getByLabel(scope.inputLabel, { exact: true })
    await expect(input).toBeVisible()
    await expect(
      frame().getByRole('button', { name: 'Reasoning effort', exact: true })
    ).toBeVisible()

    await expect(frame().getByRole('button', { name: 'Model', exact: true })).toHaveCount(0)
    const fastMode = frame().getByRole('button', { name: 'Fast mode', exact: true })
    if (await fastMode.count()) {
      await fastMode.press('Enter')
      await expect(fastMode).toHaveAttribute('aria-pressed', 'true')
      await captureScreenshot('fast-mode')
      await fastMode.press('Enter')
      await expect(fastMode).toHaveAttribute('aria-pressed', 'false')
    }
    await frame().getByRole('button', { name: 'Reasoning effort', exact: true }).press('Enter')
    await captureScreenshot('reasoning-menu')
    await frame().getByRole('menuitemradio', { name: 'Low', exact: true }).press('Enter')
    await capture()
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    releaseHeldRequest = release
    const submitted: unknown[] = []
    await shell.route('**/api/mothership/chat', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      submitted.push(route.request().postDataJSON())
      await gate
      await route.continue()
    })
    await input.fill(
      'Using only the attached page, reply with the launch code and delivery day. Do not use tools.'
    )
    await input.press('Enter')
    await expect.poll(() => submitted.length).toBe(1)
    await capture()
    await attachFile()
    await input.fill('Reply only QUEUE_OK using this queued page context.')
    await input.press('Enter')
    await expect(frame().getByRole('button', { name: 'Edit queued message' })).toBeVisible()
    await captureScreenshot('queued-message')
    await frame().getByRole('button', { name: 'Edit queued message' }).click()
    await expect(input).toHaveValue(/QUEUE_OK/)
    await expect(input).toBeFocused()
    await input.fill(`Updated: ${await input.inputValue()}`)
    await input.press('Escape')
    await expect
      .poll(() =>
        frame().evaluate((key) => {
          const persisted = JSON.parse(localStorage.getItem('mothership-drafts:v1') ?? '{}')
          return persisted.state?.drafts?.[key]?.text ?? ''
        }, scope.draftKey)
      )
      .toContain('Updated: ')
    const persisted = await frame().evaluate(() =>
      JSON.parse(localStorage.getItem('mothership-drafts:v1') ?? '{}')
    )
    const drafts = toRecord(toRecord(toRecord(persisted).state).drafts)
    const restored = toRecord(drafts[scope.draftKey])
    assert(
      String(restored.text).includes('Updated: '),
      'Restoring a queued page discarded the ordinary text draft'
    )
    assert(
      Array.isArray(restored.fileAttachments) && restored.fileAttachments.length === 1,
      'Restoring a queued page discarded the file attachment draft'
    )
    await captureScreenshot('editing-queued-message')
    assert(
      !(await frame().evaluate(() => JSON.stringify(localStorage))).includes(
        'QA_PRIVATE_PAGE_MARKER'
      ),
      'Restored queued page bytes entered draft storage'
    )
    await input.press('Enter')
    await capture()
    await input.fill('FOLLOW_UP_DRAFT_SURVIVES_ADMISSION')
    const pendingEditor = await input.elementHandle()
    assert(pendingEditor)
    release()
    await expect
      .poll(() => new URL(frame().url()).searchParams.get('chat'), { timeout: 120_000 })
      .toBeTruthy()
    await expect(input).toHaveValue('FOLLOW_UP_DRAFT_SURVIVES_ADMISSION')
    assert(
      await pendingEditor.evaluate((element) => element.isConnected),
      'Admission replaced the active composer'
    )
    await expect(attachments()).toHaveCount(1)
    const chatId = new URL(frame().url()).searchParams.get('chat')
    assert(chatId)
    const contexts = toRecord(submitted[0]).contexts
    assert(
      Array.isArray(contexts) && contexts.length === 1,
      'Page context was not sent exactly once'
    )
    const sent = pageSnapshotSchema.parse(toRecord(contexts[0]).snapshot)
    assert(sent.text.includes('ORCHID-482') && !sent.url.includes('QUERY_SECRET'))
    await expect(
      frame()
        .getByText(/ORCHID-482/)
        .filter({ visible: true })
        .first()
    ).toBeVisible({ timeout: 180_000 })
    await expect
      .poll(
        async () => {
          const rows =
            await sql`select content from copilot_messages where chat_id=${chatId} and role='assistant' order by seq limit 1`
          return String(toRecord(rows[0]?.content).content ?? '')
        },
        { timeout: 180_000 }
      )
      .toMatch(/ORCHID-482[\s\S]*Friday|Friday[\s\S]*ORCHID-482/i)
    const [saved] =
      await sql`select content from copilot_messages where chat_id=${chatId} and role='user' order by seq limit 1`
    const savedContexts = toRecord(saved?.content).contexts
    assert(Array.isArray(savedContexts))
    assert.deepEqual(pageSnapshotSchema.parse(toRecord(savedContexts[0]).snapshot), sent)
    await expect.poll(() => submitted.length, { timeout: 120_000 }).toBe(2)
    const queuedContexts = toRecord(submitted[1]).contexts
    assert(
      Array.isArray(queuedContexts) && queuedContexts.length === 1,
      'Queued page context was dropped or duplicated'
    )
    const queuedFiles = toRecord(submitted[1]).fileAttachments
    assert(
      Array.isArray(queuedFiles) && queuedFiles.length === 1,
      'Queued file attachment was lost'
    )
    const queued = pageSnapshotSchema.parse(toRecord(queuedContexts[0]).snapshot)
    assert.notEqual(queued.id, sent.id)
    assert.equal(queued.text, sent.text)
    await expect(frame().getByText('QUEUE_OK', { exact: true })).toBeVisible({
      timeout: 120_000,
    })
    await shell.unroute('**/api/mothership/chat')
    await captureScreenshot('grounded-response')
    if (scope.organizationId) {
      assert(userId)
      const permissionGroupId = generateId()
      await shell.bringToFront()
      await sql`insert into permission_group (id, organization_id, name, config, created_by, is_default)
        values (${permissionGroupId}, ${scope.organizationId}, 'Revoked Build access',
        ${sql.json({ disableWorkspaceCreation: true })}, ${userId}, true)`
      try {
        await expect(frame().getByText('This chat is unavailable.')).toBeVisible({
          timeout: ACCESS_REVALIDATION_TIMEOUT_MS,
        })
        await expect(
          frame().getByRole('textbox', { name: scope.inputLabel, exact: true })
        ).toHaveCount(0)
        await expect(attachments()).toHaveCount(0)
        await captureScreenshot('admitted-build-access-revoked')
        const [savedChat] = await sql`select config from copilot_chats where id=${chatId}`
        assert.equal(toRecord(savedChat.config).conversationMode, 'agent')
        await frame().getByRole('button', { name: 'Back to chat', exact: true }).click()
        await expect(
          frame().getByRole('button', { name: 'Attach image', exact: true })
        ).toBeVisible()
        await expect.poll(() => new URL(frame().url()).searchParams.get('chat')).toBeNull()
        await expect(attachments()).toHaveCount(0)
        await captureScreenshot('assistant-after-build-revocation')
      } finally {
        await sql`delete from permission_group where id=${permissionGroupId}`
      }
    }
    await navigate(`${scope.url}?chat=${chatId}`)
    await expect(frame().getByRole('textbox', { name: scope.inputLabel, exact: true })).toHaveValue(
      'FOLLOW_UP_DRAFT_SURVIVES_ADMISSION'
    )
    await expect(
      frame()
        .getByText(/ORCHID-482/)
        .first()
    ).toBeVisible()
    await expect(attachments()).toHaveCount(0)
    await frame()
      .getByRole('button', { name: 'Fork in new chat', exact: true })
      .last()
      .press('Enter')
    await expect.poll(() => new URL(frame().url()).searchParams.get('chat')).not.toBe(chatId)
    const forkUrl = new URL(frame().url())
    assert.equal(
      forkUrl.pathname,
      new URL(scope.url).pathname,
      'Fork escaped the extension surface'
    )
    const forkId = forkUrl.searchParams.get('chat')
    assert(forkId)
    const [forkOwner] =
      await sql`select organization_id, workspace_id from copilot_chats where id=${forkId}`
    assert.equal(forkOwner.organization_id, scope.organizationId ?? null)
    assert.equal(forkOwner.workspace_id, scope.organizationId ? null : alphaId)
    const forkMessages =
      await sql`select content from copilot_messages where chat_id=${forkId} and role='user'`
    for (const row of forkMessages) {
      const files = toRecord(row.content).fileAttachments
      if (Array.isArray(files))
        for (const file of files) {
          const key = toRecord(file).key
          if (typeof key === 'string') trackUploadedFile(key)
        }
    }
    await expect(frame().getByRole('textbox', { name: scope.inputLabel, exact: true })).toHaveValue(
      ''
    )
    await captureScreenshot('forked-chat')
    await frame().getByRole('button', { name: 'New chat', exact: true }).click()
    await expect(frame().getByRole('textbox', { name: scope.inputLabel, exact: true })).toHaveValue(
      ''
    )
    const [owner] =
      await sql`select organization_id, workspace_id from copilot_chats where id=${chatId}`
    assert.equal(owner.organization_id, scope.organizationId ?? null)
    assert.equal(owner.workspace_id, scope.organizationId ? null : alphaId)
    assert.equal(toRecord(submitted[0]).organizationId, scope.organizationId)
    assert.equal(toRecord(submitted[0]).workspaceId, scope.organizationId ? undefined : alphaId)
  }
  if (liveChat) {
    await checkComposer(
      'Workspace live admission preserves queued pages, files, and the active draft',
      () =>
        verifyLiveChat({
          name: 'workspace',
          url: `${base.origin}/extension/${alphaId}`,
          inputLabel: 'Message',
          draftKey: `extension:${userId}:${alphaId}:new`,
        })
    )
  } else if (group === 'all' || group === 'native' || group === 'composer')
    checks.push({ name: 'Live Mothership send and admission', status: 'skipped', durationMs: 0 })
  await checkComposer(
    'Another user’s existing workspace fails closed and returns to an authorized workspace',
    async () => {
      await navigate(`${base.origin}/extension/${deniedId}`)
      await expect(frame().getByText('This workspace is unavailable.')).toBeVisible()
      await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0)
      await frame().getByRole('link', { name: 'Choose another workspace' }).click()
      await frame().getByRole('link', { name: 'Extension QA alpha', exact: true }).click()
      await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
    }
  )
  await checkComposer(
    'Organization default landing binds page-only submissions to the organization',
    async () => {
      await seedViewerOrganization()
      await navigate(`${base.origin}/extension`)
      await expect
        .poll(() => new URL(frame().url()).pathname)
        .toBe(`/extension/o/${organizationId}`)
      await expect(frame().getByRole('textbox', { name: 'Ask Sim', exact: true })).toBeVisible()
      await expect(frame().getByRole('button', { name: 'Voice input', exact: true })).toBeVisible()
      await screenshot('organization-new-chat')
      await setPanelViewport(320, 844)
      await screenshot('organization-microphone-320')
      await setPanelViewport(390, 844)
      await capture()
      await expect(attachments()).toHaveCount(1)
      let submitted: unknown
      await shell.route('**/api/mothership/chat', async (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        submitted = route.request().postDataJSON()
        injectedRequests.add(route.request())
        await route.fulfill({ status: 403, json: { error: 'QA admission rejected' } })
      })
      try {
        await frame().getByRole('textbox', { name: 'Ask Sim', exact: true }).press('Enter')
        await expect.poll(() => submitted).toBeTruthy()
        const payload = toRecord(submitted)
        assert.equal(payload.organizationId, organizationId)
        assert.equal(payload.workspaceId, undefined)
        assert.equal(payload.mode, 'agent')
        assert(Array.isArray(payload.contexts) && payload.contexts.length === 1)
        assert(
          pageSnapshotSchema
            .parse(toRecord(payload.contexts[0]).snapshot)
            .text.includes('ORCHID-482')
        )
        await expect(attachments()).toHaveCount(0)
      } finally {
        await shell.unroute('**/api/mothership/chat')
      }
      await seedOtherOrganization()
      await navigate(
        `${base.origin}/extension/o/${otherOrganizationId}?chat=${otherOrganizationChatId}`
      )
      await expect(frame().getByText('This organization is unavailable.')).toBeVisible()
      for (const chatId of [historyId, otherOrganizationChatId]) {
        await navigate(`${base.origin}/extension/o/${organizationId}?chat=${chatId}`)
        await expect(frame().getByText('This chat is unavailable.')).toBeVisible()
        await expect(frame().getByRole('textbox', { name: 'Ask Sim', exact: true })).toHaveCount(0)
      }
      await screenshot('organization-wrong-scope-history')
    }
  )
  const setActiveOrganization = async () => {
    const active = await browserContext.request.post(
      `${base.origin}/api/auth/organization/set-active`,
      {
        headers: { origin: base.origin },
        data: { organizationId },
      }
    )
    assert.equal(active.status(), 200)
  }
  await checkComposer(
    'A shared workspace returns to the viewer’s own organization chat',
    async () => {
      await seedHostedWorkspace()
      await setActiveOrganization()
      await navigate(`${base.origin}/extension`)
      await expect
        .poll(() => new URL(frame().url()).pathname)
        .toBe(`/extension/o/${organizationId}`)
      await navigate(`${base.origin}/extension/${hostedWorkspaceId}`)
      await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
      await capture()
      await frame()
        .getByRole('textbox', { name: 'Message', exact: true })
        .fill('Workspace-specific draft')
      await frame().getByRole('button', { name: 'Hosted QA workspace', exact: true }).click()
      await frame().getByRole('menuitem', { name: 'Organization chat', exact: true }).click()
      await expect
        .poll(() => new URL(frame().url()).pathname)
        .toBe(`/extension/o/${organizationId}`)
      await expect(frame().getByRole('textbox', { name: 'Ask Sim', exact: true })).toHaveValue('')
      await expect(attachments()).toHaveCount(0)
      await screenshot('shared-workspace-organization-navigation')
    }
  )
  await checkComposer(
    'A delayed extension handshake lets ordinary and manually attached messages through',
    async () => {
      const endpoint = `${base.origin}/api/mothership/chat`
      const received: Record<string, unknown>[] = []
      let holdHandshake: Awaited<ReturnType<Page['addInitScript']>> | undefined
      const openScenario = async () => {
        await holdHandshake?.dispose()
        // Rejected sends can recover from this tab's session when the next scenario navigates.
        await shell.close()
        panel = await openPanel()
        shell = panel
        holdHandshake = await shell.addInitScript(() => {
          if (window.parent === window) return
          window.addEventListener(
            'message',
            (event) => {
              const type = event.data?.type
              if (
                event.source !== window.parent ||
                (type !== 'connected' && type !== 'reference-preference')
              )
                return
              const state = document.documentElement.dataset
              if (type === 'connected') state.heldSession = event.data.sessionId
              if (state.release === type) state.delivered = type
              else event.stopImmediatePropagation()
            },
            true
          )
        })
        await shell.goto(`chrome-extension://${extensionId}/sidepanel.html`)
        await observeCaptureReceipts()
        await navigate(`${base.origin}/extension/${betaId}`)
        await expect(frame().locator('html')).toHaveAttribute('data-held-session', /.+/)
      }
      await browserContext.route(endpoint, (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        received.push(toRecord(route.request().postDataJSON()))
        injectedRequests.add(route.request())
        return route.fulfill({ status: 403, json: { error: 'QA admission rejected' } })
      })
      const input = () => frame().getByRole('textbox', { name: 'Message', exact: true })
      const release = async (type: 'connected' | 'reference-preference') => {
        await frame().evaluate(
          ({ origin, type }) => {
            const state = document.documentElement.dataset
            state.release = type
            parent.postMessage(
              { channel: 'sim-extension', version: 1, type: 'ready', sessionId: state.heldSession },
              origin
            )
          },
          { type, origin: `chrome-extension://${extensionId}` }
        )
        await expect(frame().locator('html')).toHaveAttribute('data-delivered', type)
      }
      try {
        for (const enabled of [false, true]) {
          await worker.evaluate(
            (value) => chrome.storage.local.set({ referenceCurrentPage: value }),
            enabled
          )
          await openScenario()
          const draft = enabled ? 'This draft needs its page' : 'An ordinary question'
          await input().fill(draft)
          if (!enabled) {
            await release('reference-preference')
            await input().press('Enter')
            await expect.poll(() => received.length).toBe(1)
            assert.equal(received[0].message, draft)
            assert.equal(submittedPages(received[0]).length, 0)
            continue
          }
          const expectDraftHeld = async () => {
            await input().press('Enter')
            await expect(
              frame().getByText('Connecting to Sim. Try again in a moment.').first()
            ).toBeVisible()
            await expect(input()).toHaveValue(draft)
            assert.equal(received.length, 1)
          }
          await expectDraftHeld()
          await release('reference-preference')
          await expectDraftHeld()

          await source.bringToFront()
          await frame().evaluate((origin) => {
            parent.postMessage(
              {
                channel: 'sim-extension',
                version: 1,
                type: 'action',
                action: 'capture-page',
                sessionId: document.documentElement.dataset.heldSession,
              },
              origin
            )
          }, `chrome-extension://${extensionId}`)
          await expect(attachments()).toHaveCount(1)
          await input().press('Enter')
          await expect.poll(() => received.length).toBe(2)
          const pages = submittedPages(received[1])
          assert.equal(pages.length, 1)
          assert(pages[0].text.includes('ORCHID-482'))
        }
        await openScenario()
        await release('connected')
        await input().fill('A question from an older extension')
        await input().press('Enter')
        await expect.poll(() => received.length).toBe(3)
        assert.equal(received[2].message, 'A question from an older extension')
        assert.equal(submittedPages(received[2]).length, 0)
      } finally {
        await holdHandshake?.dispose()
        await worker.evaluate(() => chrome.storage.local.remove('referenceCurrentPage'))
        await browserContext.unroute(endpoint)
      }
    }
  )
  await checkComposer(
    'Reference current page captures the active tab only on Send and preserves denied drafts in both composers',
    async () => {
      const endpoint = `${base.origin}/api/mothership/chat`
      const received: Record<string, unknown>[] = []
      const second = await openPage()
      await second.goto(`${fixtureOrigin}/reference-second?private=DO_NOT_SEND#private`)
      await second.locator('article p').evaluate((el) => {
        el.textContent = 'Second active tab: JADE-231.'
      })
      const restricted = await openPage()
      await restricted.goto(`http://ungranted.localhost:${fixtureAddress.port}/denied`)
      await browserContext.route(endpoint, (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        received.push(toRecord(route.request().postDataJSON()))
        injectedRequests.add(route.request())
        return route.fulfill({ status: 403, json: { error: 'QA admission rejected' } })
      })
      const preference = () =>
        frame().getByRole('menuitemcheckbox', { name: 'Reference current page' })
      const setReference = async (enabled: boolean) => {
        await frame().getByRole('button', { name: 'Add resources', exact: true }).press('Enter')
        await expect(preference()).toBeVisible()
        if ((await preference().getAttribute('aria-checked')) !== String(enabled)) {
          await preference().press('Enter')
        } else await preference().press('Escape')
        const globe = frame().getByRole('button', { name: 'Attach current page', exact: true })
        if (enabled) await expect(globe).toHaveText('Current page')
        else await expect(globe).not.toHaveText('Current page')
      }
      const openScenario = async (target: string, name: string) => {
        scenario = name
        phase = 'opening'
        await shell.close()
        panel = await openPanel()
        shell = panel
        await setPanelViewport(320, 844)
        await shell.goto(`chrome-extension://${extensionId}/sidepanel.html`)
        await observeCaptureReceipts()
        await navigate(base.origin + target)
        await expect(
          frame().getByRole('heading', { name: 'How can I help?', exact: true })
        ).toBeVisible()
        await setReference(true)
      }
      try {
        for (const org of [false, true]) {
          const target = org ? `/extension/o/${organizationId}` : `/extension/${alphaId}`
          const input = () =>
            frame().getByRole('textbox', { name: org ? 'Ask Sim' : 'Message', exact: true })
          await openScenario(target, `${org ? 'organization' : 'workspace'}-reference`)
          await expect(input()).toBeVisible()
          await input().fill('Summarize the current page')
          const submit = frame().getByRole('button', {
            name: org ? 'Send' : 'Send message',
            exact: true,
          })
          await submit.click({ trial: true })
          await screenshot(`reference-${org ? 'organization' : 'workspace'}-enabled-320`)
          await second.bringToFront()
          let count = received.length
          phase = 'send'
          await input().press('Enter')
          await expect.poll(() => received.length).toBe(count + 1)
          const pages = submittedPages(received[count])
          assert.equal(pages.length, 1)
          assert.equal(pages[0].url, `${fixtureOrigin}/reference-second`)
          assert(pages[0].text.includes('JADE-231') && !pages[0].text.includes('ORCHID-482'))
          assert.equal(
            received[count][org ? 'organizationId' : 'workspaceId'],
            org ? organizationId : alphaId
          )

          await openScenario(target, `${org ? 'organization' : 'workspace'}-manual`)
          await expect(input()).toBeVisible()
          await capture()
          await second.bringToFront()
          await input().fill('Compare the attached snapshot')
          count = received.length
          phase = 'send'
          await input().press('Enter')
          await expect.poll(() => received.length).toBe(count + 1)
          const manual = submittedPages(received[count])
          assert.equal(manual.length, 1)
          assert(manual[0].text.includes('ORCHID-482') && !manual[0].text.includes('JADE-231'))

          for (const gesture of ['keyboard', 'mouse'] as const) {
            await openScenario(target, `${org ? 'organization' : 'workspace'}-denied-${gesture}`)
            await expect(input()).toBeVisible()
            await restricted.bringToFront()
            const draft = 'Keep this draft if access is unavailable'
            await input().fill(draft)
            count = received.length
            phase = `denied-${gesture}-send`
            if (gesture === 'keyboard') await input().press('Enter')
            else
              await frame()
                .getByRole('button', { name: org ? 'Send' : 'Send message', exact: true })
                .click()
            await expect(
              shell.getByRole('button', { name: 'Allow across websites', exact: true })
            ).toBeEnabled()
            await expect(input()).toHaveValue(draft)
            await expect
              .poll(() => input().evaluate((element) => Boolean(element.closest('[inert]'))))
              .toBe(false)
            assert.equal(received.length, count)
            assert(
              await frame().evaluate(() => document.hasFocus()),
              `The denied ${gesture} send must keep the chat document focused`
            )
            await expect(input()).toBeFocused()
            await shell.keyboard.type(' Continue typing after the denied capture.')
            await expect(input()).toHaveValue(`${draft} Continue typing after the denied capture.`)
            assert.equal(received.length, count)
            await screenshot(`reference-${org ? 'organization' : 'workspace'}-denied-${gesture}`)
            const accessNotice = await shell
              .getByRole('status')
              .first()
              .evaluate((status) => status.firstChild?.textContent?.trim())
            assert(accessNotice)
            assert.equal(
              await frame().getByText(accessNotice, { exact: true }).count(),
              0,
              'Access guidance covered the composer twice'
            )
            await setReference(false)
            phase = 'opt-out-send'
            await input().press('Enter')
            await expect.poll(() => received.length).toBe(count + 1)
            assert.equal(submittedPages(received[count]).length, 0)
          }
        }
      } finally {
        await browserContext.unroute(endpoint)
        await restricted.close()
        await second.close()
        await setPanelViewport(390, 844)
        await source.bringToFront()
      }
    }
  )
  await checkComposer(
    'Pending page reference freezes body file drops in workspace and organization chat',
    async () => {
      for (const scope of ['workspace', 'organization'] as const) {
        await shell.close()
        panel = await openPanel()
        shell = panel
        const captureGate = await installCaptureGate()
        try {
          await shell.goto(`chrome-extension://${extensionId}/sidepanel.html`)
          await observeCaptureReceipts()
          await navigate(
            `${base.origin}/extension/${scope === 'workspace' ? alphaId : `o/${organizationId}`}`
          )
          await verifyPendingCaptureDrop(scope)
        } finally {
          await captureGate.dispose()
        }
      }
    }
  )
  await checkComposer(
    'A screenshot dropped on the workspace or organization chat body uploads once and can be sent by itself',
    async () => {
      // A previous rejected send can be restored from tab session storage on navigation.
      await shell.close()
      panel = await openPanel()
      shell = panel
      await shell.goto(`chrome-extension://${extensionId}/sidepanel.html`)
      const remote = new URL('/external-drop.png', fixtureOrigin)
      const remoteRequests: Request[] = []
      await browserContext.route(remote.href, (route) => {
        remoteRequests.push(route.request())
        return route.abort()
      })
      const endpoint = `${base.origin}/api/mothership/chat`
      const submitted: unknown[] = []
      await browserContext.route(endpoint, (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        submitted.push(route.request().postDataJSON())
        injectedRequests.add(route.request())
        return route.fulfill({ status: 403, json: { error: 'QA screenshot admission check' } })
      })
      try {
        for (const surface of ['workspace', 'organization'] as const) {
          const org = surface === 'organization'
          await navigate(`${base.origin}/extension/${org ? `o/${organizationId}` : alphaId}`)
          const greeting = frame().getByRole('heading', { name: 'How can I help?', exact: true })
          await expect(greeting).toBeVisible()
          await expect(
            frame().getByRole('button', { name: /^Remove (?!page context$)/ }),
            `${surface}: screenshot scenario starts without a previous file draft`
          ).toHaveCount(0)
          let release = () => {}
          const gate = new Promise<void>((resolve) => {
            release = resolve
          })
          await browserContext.route(isUploadCompletion, async (route) => {
            await gate
            await route.continue()
          })
          const input = frame().getByRole('textbox', {
            name: org ? 'Ask Sim' : 'Message',
            exact: true,
          })
          await input.fill('')
          const count = submitted.length
          const verifyPending = async () => {
            try {
              await shell.waitForRequest(
                (request) =>
                  request.method() === 'POST' && isUploadCompletion(new URL(request.url()))
              )
              await input.press('Enter')
              await expect(
                frame().getByRole('button', { name: org ? 'Send' : 'Send message', exact: true })
              ).toBeDisabled()
              assert.equal(submitted.length, count, 'A pending upload triggered a chat send')
            } finally {
              release()
            }
          }
          const [key] = await Promise.all([attachScreenshot(greeting), verifyPending()]).finally(
            () => {
              release()
              return browserContext.unroute(isUploadCompletion)
            }
          )
          await screenshot(org ? 'organization-dropped-screenshot' : 'workspace-dropped-screenshot')
          await dropOnChat(shell, input, {
            text: remote.href,
            html: `<img src="${remote.href}">`,
            uri: remote.href,
          })
          await expect(input).toHaveValue('')
          await input.press('Enter')
          await expect.poll(() => submitted.length).toBe(count + 1)
          const body = toRecord(submitted[count])
          assert.equal(body.message, '')
          assert.equal(body[org ? 'organizationId' : 'workspaceId'], org ? organizationId : alphaId)
          assert(Array.isArray(body.fileAttachments) && body.fileAttachments.length === 1)
          assert.equal(toRecord(body.fileAttachments[0]).key, key)
          assert.equal(toRecord(body.fileAttachments[0]).media_type, 'image/png')
        }
        assert.equal(remoteRequests.length, 0, 'Dropping a web image URL fetched its source')
      } finally {
        await browserContext.unroute(remote.href)
        await browserContext.unroute(endpoint)
      }
    }
  )
  await checkComposer(
    'A first-open toolbar capture survives authenticated organization landing',
    async () => {
      await source.bringToFront()
      await shell.goto('about:blank')
      const intent = await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (tab.id === undefined || !tab.url) throw new Error('Missing source tab')
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tab.url))
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [0] },
          func: () => null,
        })
        return {
          tabId: tab.id,
          windowId: tab.windowId,
          kind: 'page',
          createdAt: Date.now(),
          documentId: result.documentId,
          urlDigest: Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, '0')
          ).join(''),
        }
      })
      await worker.evaluate(async (pending) => {
        await chrome.storage.session.set({
          [`captureIntent:${pending.windowId}:first-open`]: pending,
        })
      }, intent)
      await shell.goto(`chrome-extension://${extensionId}/sidepanel.html`)
      await observeCaptureReceipts()
      await expect
        .poll(() => new URL(frame().url()).pathname)
        .toBe(`/extension/o/${organizationId}`)
      await expect(attachments()).toHaveCount(1)
      await screenshot('organization-first-open-capture')
    }
  )
  await checkComposer('The current-page shortcut attaches in both shared composers', async () => {
    for (const path of [`/extension/${alphaId}`, `/extension/o/${organizationId}`]) {
      await navigate(`${base.origin}${path}`)
      await expect(attachments()).toHaveCount(0)
      await capture('shortcut')
      await expect(attachments()).toHaveCount(1)
      await attachments()
        .first()
        .getByRole('button', { name: /^Review page context:/ })
        .click()
      const preview = frame().getByRole('dialog', { name: 'Page context', exact: true })
      await expect(preview.locator('pre')).toContainText(captureText)
      await preview.getByRole('button', { name: 'Close', exact: true }).click()
      await frame().getByRole('button', { name: 'Attach current page', exact: true }).hover()
      await expect(frame().getByRole('tooltip', { name: 'Attach current page' })).toBeVisible()
      await screenshot(path.includes('/o/') ? 'shortcut-organization-agent' : 'shortcut-workspace')
      await attachments().first().getByRole('button', { name: 'Remove page context' }).click()
    }
  })
  await checkComposer(
    'Large attachment stacks keep the composer reachable without nested desktop scrolling',
    async () => {
      const names = Array.from(
        { length: 20 },
        (_, index) => `extension-qa-long-attachment-name-${index + 1}.txt`
      )
      const endpoint = `${base.origin}/api/mothership/chat`
      for (const [name, path, inputLabel, sendLabel] of [
        ['workspace-new', `/extension/${alphaId}`, 'Message', 'Send message'],
        ['workspace-history', `/extension/${alphaId}?chat=${historyId}`, 'Message', 'Send message'],
        ['organization-new', `/extension/o/${organizationId}`, 'Ask Sim', 'Send'],
      ] as const) {
        await navigate(`${base.origin}${path}`)
        await setPanelViewport(320, 844)
        await capture('shortcut')
        for (const filename of names) await attachFile(filename)
        const geometry = await attachments()
          .first()
          .evaluate((chip) => {
            const strip = chip.parentElement?.parentElement
            if (!strip) throw new Error('Missing attachment strip')
            return { height: strip.clientHeight, contentHeight: strip.scrollHeight }
          })
        assert(geometry.contentHeight > 844, 'The fixture did not exceed the panel height')
        assert(
          geometry.contentHeight <= geometry.height + 1,
          'Desktop attachments gained nested scrolling'
        )
        await shell.bringToFront()
        await shell.mouse.move(160, 760)
        await expect
          .poll(() =>
            attachments()
              .first()
              .evaluate((chip) => chip.getBoundingClientRect().top)
          )
          .toBeGreaterThanOrEqual(0)
        await screenshot(`large-attachments-${name}-top`)
        await shell.mouse.wheel(0, 2000)
        const send = frame().getByRole('button', { name: sendLabel, exact: true })
        await expect
          .poll(
            () =>
              send.evaluate((button) => {
                const rect = button.getBoundingClientRect()
                return (
                  rect.top >= 0 &&
                  rect.bottom <= innerHeight &&
                  button.contains(
                    document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
                  )
                )
              }),
            { message: `${name}: scrolling must expose Send inside the panel` }
          )
          .toBe(true)
        const editor = frame().getByRole('textbox', { name: inputLabel, exact: true })
        assert(
          await editor.evaluate((element) => {
            const rect = element.getBoundingClientRect()
            return (
              rect.top >= 0 &&
              rect.bottom <= innerHeight &&
              element.contains(
                document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
              )
            )
          }),
          `${name}: the editor is clipped`
        )
        assert(
          await frame()
            .getByRole('button', { name: 'New chat', exact: true })
            .evaluate((button) => {
              const rect = button.getBoundingClientRect()
              return rect.top >= 0 && rect.bottom <= innerHeight
            }),
          `${name}: scrolling hid the extension header`
        )
        await screenshot(`large-attachments-${name}-bottom`)
        await browserContext.route(endpoint, (route) =>
          route.fulfill({ status: 403, json: { error: 'QA attachment capacity admission check' } })
        )
        try {
          const request = browserContext.waitForEvent('request', {
            predicate: (entry) => entry.url() === endpoint && entry.method() === 'POST',
          })
          await editor.fill('Use all attached context.')
          await send.click()
          const payload = toRecord((await request).postDataJSON())
          assert(Array.isArray(payload.fileAttachments), 'Missing file attachments')
          assert.deepEqual(
            payload.fileAttachments.map((file) => toRecord(file).filename).sort(),
            [...names].sort()
          )
          assert(
            Array.isArray(payload.contexts) && payload.contexts.length === 1,
            'The attached page was lost'
          )
          await expect(
            frame().getByText('QA attachment capacity admission check', { exact: false })
          ).toBeVisible()
        } finally {
          await browserContext.unroute(endpoint)
        }
      }
      await setPanelViewport(390, 844)
      await navigate(`${base.origin}/extension/o/${organizationId}`)
    }
  )
  if (liveChat) {
    await checkComposer(
      'Organization live admission preserves queued pages, files, and the admitted conversation mode',
      () =>
        verifyLiveChat({
          name: 'organization',
          url: `${base.origin}/extension/o/${organizationId}`,
          inputLabel: 'Ask Sim',
          draftKey: `extension:${userId}:organization:${organizationId}:home`,
          organizationId,
        })
    )
  }
  await checkComposer(
    'Page controls stay reachable above a long organization workspace list',
    async () => {
      assert(userId)
      const projectId = generateId()
      await sql`insert into project (id, name, owner_id, organization_id)
      values (${projectId}, 'Menu QA project', ${userId}, ${organizationId})`
      try {
        const workspaces =
          await sql`update workspace set organization_id = ${organizationId}, project_id = ${projectId}
        where project_id = ${alphaId} and name like 'Extension QA workspace %' returning id`
        assert.equal(workspaces.length, 24)
        await setPanelViewport(320, 640)
        await navigate(`${base.origin}/extension/o/${organizationId}`)
        await frame().getByRole('button', { name: 'Add resources', exact: true }).click()
        const rows = frame().getByRole('menuitem', { name: /^Extension QA workspace / })
        await expect(rows).toHaveCount(workspaces.length)
        const toggle = frame().getByRole('menuitemcheckbox', { name: 'Reference current page' })
        await expect(toggle).toBeInViewport({ ratio: 1 })
        await rows.last().scrollIntoViewIfNeeded()
        await expect(rows.first()).not.toBeInViewport()
        await expect(toggle).toBeInViewport({ ratio: 1 })
        await screenshot('page-controls-many-workspaces')
        const checked = (await toggle.getAttribute('aria-checked')) === 'true'
        await toggle.click()
        await frame().getByRole('button', { name: 'Add resources', exact: true }).click()
        await expect(toggle).toHaveAttribute('aria-checked', String(!checked))
        const search = frame().getByPlaceholder('Search resources')
        await search.press('ArrowDown')
        await expect(
          frame().getByRole('menuitem', { name: 'Current page', exact: true })
        ).toBeFocused()
        await shell.keyboard.press('ArrowDown')
        await expect(
          frame().getByRole('menuitem', { name: 'Selected text', exact: true })
        ).toBeFocused()
        await shell.keyboard.press('ArrowDown')
        await expect(toggle).toBeFocused()
        await shell.keyboard.press('Tab')
        await expect(toggle).not.toBeVisible()
        await setPanelViewport(320, 240)
        await frame().getByRole('button', { name: 'Add resources', exact: true }).click()
        await expect(toggle).toHaveAttribute('aria-checked', String(checked))
        await rows.last().scrollIntoViewIfNeeded()
        await expect(rows.last()).toBeInViewport({ ratio: 1 })
        await screenshot('page-controls-short-panel')
        await rows.last().press('Escape')
      } finally {
        await sql`update workspace set organization_id = null, project_id = ${alphaId} where project_id = ${projectId}`
        await sql`delete from project where id = ${projectId}`
        await setPanelViewport(390, 844)
      }
    }
  )
  if (group === 'access') {
    await seedViewerOrganization()
    await seedOtherOrganization()
    await seedHostedWorkspace()
    await setActiveOrganization()
  }
  if ((group === 'all' || group === 'access') && !liveChat) {
    // Install timers before app code in a fresh context; live provider checks keep native timing.
    await browserContext.close()
    context = await launchBrowserContext()
    browserContext = context
    browserContext.setDefaultTimeout(30_000)
    browserContext.setDefaultNavigationTimeout(120_000)
    worker =
      browserContext.serviceWorkers()[0] ?? (await browserContext.waitForEvent('serviceworker'))
    assert.equal(worker.url().split('/')[2], extensionId)
    panel = await openPanel()
    shell = panel
    await shell.clock.install()
    await browserContext.addInitScript(() => {
      const animate = Element.prototype.animate
      Element.prototype.animate = function (
        this: Element,
        ...args: Parameters<Element['animate']>
      ) {
        const animation = animate.apply(this, args)
        // Callers set startTime synchronously from the advanced clock, ahead of the native timeline.
        queueMicrotask(() => {
          if (
            animation.playState === 'running' &&
            Number.isFinite(animation.effect?.getComputedTiming().endTime)
          )
            animation.finish()
        })
        return animation
      }
    })
    source = await openPage()
    await source.goto(`${fixtureOrigin}/page?private=QUERY_SECRET#FRAGMENT_SECRET`)
    await shell.goto(`chrome-extension://${extensionId}/sidepanel.html`)
    await observeCaptureReceipts()
  }
  const revalidationTimeout = liveChat
    ? ACCESS_REVALIDATION_TIMEOUT_MS
    : ACCESS_REVALIDATION_TIMEOUT_MS - ACCESS_POLL_INTERVAL_MS
  const advanceAccessRevalidation = async () => {
    if (liveChat) return
    await shell.clock.fastForward(ACCESS_POLL_INTERVAL_MS)
    // Capture timestamps come from Chromium's isolated world, outside Playwright's clock.
    await shell.clock.setSystemTime(Date.now())
  }
  for (const allowRequests of [false, true]) {
    await checkAccess(
      `Workspace Chat policy revocation and regrant work with access requests ${allowRequests ? 'enabled' : 'disabled'}`,
      async () => {
        assert(userId)
        const permissionGroupId = generateId()
        await sql`insert into organization_access_request_settings (organization_id, allow_requests)
          values (${otherOrganizationId}, ${allowRequests})
          on conflict (organization_id) do update set allow_requests=excluded.allow_requests`
        try {
          await navigate(`${base.origin}/extension/${hostedWorkspaceId}`)
          const input = frame().getByRole('textbox', { name: 'Message', exact: true })
          await expect(input).toBeVisible()
          await capture()
          await input.fill('Keep text, but discard the page when Chat access is revoked.')
          await expect(attachments()).toHaveCount(1)
          await shell.bringToFront()
          const discovery = await browserContext.request.get(
            `${base.origin}/api/access-requests/discovery?kind=workspace&workspaceId=${hostedWorkspaceId}&targetKind=feature`
          )
          assert.equal(discovery.status(), 200)
          assert.equal(toRecord(await discovery.json()).enabled, allowRequests)
          await sql`insert into permission_group (id, organization_id, name, config, created_by, is_default)
            values (${permissionGroupId}, ${otherOrganizationId}, 'Revoked Chat access',
            ${sql.json({ hideCopilot: true })}, ${otherUserId}, true)`
          const policy = await browserContext.request.get(
            `${base.origin}/api/permission-groups/user?workspaceId=${hostedWorkspaceId}`
          )
          assert.equal(policy.status(), 200)
          assert.equal(toRecord(toRecord(await policy.json()).config).hideCopilot, true)
          await advanceAccessRevalidation()
          await expect(input).toHaveCount(0, { timeout: revalidationTimeout })
          await expect(attachments()).toHaveCount(0)
          await expect(frame().getByText('Access required', { exact: true })).toBeVisible()
          await screenshot(`workspace-chat-revoked-requests-${allowRequests}`)
          await sql`delete from permission_group where id=${permissionGroupId}`
          await advanceAccessRevalidation()
          await expect(input).toBeVisible({ timeout: revalidationTimeout })
          await expect(input).toHaveValue(
            'Keep text, but discard the page when Chat access is revoked.'
          )
          await expect(attachments()).toHaveCount(0)
          await screenshot(`workspace-chat-regranted-requests-${allowRequests}`)
          await sql`insert into permission_group (id, organization_id, name, config, created_by, is_default)
            values (${permissionGroupId}, ${otherOrganizationId}, 'Revoked Chat access',
            ${sql.json({ hideCopilot: true })}, ${otherUserId}, true)`
          await navigate(`${base.origin}/extension/${hostedWorkspaceId}`)
          await expect(frame().getByText('Access required', { exact: true })).toBeVisible()
          await expect(input).toHaveCount(0)
          await expect(attachments()).toHaveCount(0)
          await screenshot(`workspace-chat-initial-denial-requests-${allowRequests}`)
          await frame().getByRole('link', { name: 'Back to chat', exact: true }).click()
          await expect
            .poll(() => new URL(frame().url()).pathname)
            .toBe(`/extension/o/${organizationId}`)
          await expect(frame().getByRole('textbox', { name: 'Ask Sim', exact: true })).toBeVisible()
          await expect(attachments()).toHaveCount(0)
        } finally {
          await sql`delete from permission_group where id=${permissionGroupId}`
          await sql`delete from organization_access_request_settings where organization_id=${otherOrganizationId}`
        }
      }
    )
  }
  await checkAccess(
    'Organization permission changes switch a new chat to Assistant without losing its draft',
    async () => {
      assert(userId)
      await navigate(`${base.origin}/extension/o/${organizationId}`)
      const input = frame().getByRole('textbox', { name: 'Ask Sim', exact: true })
      await expect(input).toBeVisible()
      await expect(frame().getByRole('button', { name: 'Attach file', exact: true })).toBeVisible()
      await capture()
      await input.fill('Keep this draft when Build access changes.')
      await attachFile()
      await shell.bringToFront()
      await sql`insert into permission_group (id, organization_id, name, config, created_by, is_default)
      values (${generateId()}, ${organizationId}, 'Search only',
      ${sql.json({ disableWorkspaceCreation: true })}, ${userId}, true)`
      await advanceAccessRevalidation()
      await expect(frame().getByRole('button', { name: 'Attach image', exact: true })).toBeVisible({
        timeout: revalidationTimeout,
      })
      await expect(input).toHaveValue('Keep this draft when Build access changes.')
      await expect(attachments()).toHaveCount(1)
      await input.press('Enter')
      await expect(frame().getByText(/Remove unsupported files/)).toBeVisible()
      await expect(input).toHaveValue('Keep this draft when Build access changes.')
      await expect(attachments()).toHaveCount(1)
      await screenshot('organization-mode-file-recovery')
      await frame().getByRole('button', { name: 'Remove extension-notes.txt', exact: true }).click()
      await expect(frame().getByText(/Remove unsupported files/)).not.toBeVisible()
      await attachments().first().getByRole('button', { name: 'Remove page context' }).click()
      await capture('shortcut')
      await expect(attachments()).toHaveCount(1)
      const droppedImage = !liveChat
        ? await attachScreenshot(
            frame().getByRole('heading', { name: 'How can I help?', exact: true })
          )
        : undefined
      await expect(frame().getByRole('button', { name: 'Voice input', exact: true })).toBeVisible()
      await screenshot('organization-assistant-page')
      await setPanelViewport(320, 844)
      await screenshot('assistant-microphone-320')
      await setPanelViewport(390, 844)
      if (!liveChat)
        await shell.route('**/api/mothership/chat', (route) =>
          route.fulfill({ status: 403, json: { error: 'QA submission boundary' } })
        )
      const submitted = shell.waitForRequest(
        (request) =>
          new URL(request.url()).pathname === '/api/mothership/chat' && request.method() === 'POST'
      )
      await input.fill(
        'Using only the attached page, reply with the launch code and delivery day. Do not use tools.'
      )
      await input.press('Enter')
      const body = toRecord((await submitted).postDataJSON())
      if (droppedImage) {
        assert(Array.isArray(body.fileAttachments) && body.fileAttachments.length === 1)
        assert.equal(toRecord(body.fileAttachments[0]).key, droppedImage)
      }
      assert.equal(body.mode, 'assistant')
      assert.equal(body.organizationId, organizationId)
      assert.equal(body.workspaceId, undefined)
      assert(Array.isArray(body.contexts) && body.contexts.length === 1)
      assert(
        pageSnapshotSchema.parse(toRecord(body.contexts[0]).snapshot).text.includes('ORCHID-482')
      )
      if (liveChat) {
        await expect
          .poll(() => new URL(frame().url()).searchParams.get('chat'), { timeout: 120_000 })
          .toBeTruthy()
        await expect(
          frame()
            .getByText(/ORCHID-482/)
            .filter({ visible: true })
        ).toBeVisible({ timeout: 120_000 })
        await expect(
          frame()
            .getByText(/Friday/)
            .filter({ visible: true })
        ).toBeVisible({ timeout: 120_000 })
        const chatId = new URL(frame().url()).searchParams.get('chat')
        assert(chatId)
        const [chat] =
          await sql`select organization_id, workspace_id, config from copilot_chats where id=${chatId}`
        assert.equal(chat.organization_id, organizationId)
        assert.equal(chat.workspace_id, null)
        assert.equal(toRecord(chat.config).conversationMode, 'assistant')
        await expect(
          frame().getByRole('button', { name: 'Copy message', exact: true })
        ).toBeVisible({ timeout: 120_000 })
        await screenshot('organization-assistant-response')
      } else await shell.unroute('**/api/mothership/chat')
    }
  )
  await checkAccess(
    'Restricted Assistant freezes body file drops while a page reference is pending',
    async () => {
      await shell.close()
      panel = await openPanel()
      shell = panel
      if (!liveChat) await shell.clock.install()
      const captureGate = await installCaptureGate()
      try {
        await shell.goto(`chrome-extension://${extensionId}/sidepanel.html`)
        await observeCaptureReceipts()
        await navigate(`${base.origin}/extension/o/${organizationId}`)
        await expect(
          frame().getByRole('button', { name: 'Attach image', exact: true })
        ).toBeVisible()
        await verifyPendingCaptureDrop('assistant')
      } finally {
        await captureGate.dispose()
      }
    }
  )
  await checkAccess(
    'Revoking organization membership removes the live composer and pending captures',
    async () => {
      assert(userId)
      await navigate(`${base.origin}/extension/o/${organizationId}`)
      await expect(frame().getByRole('textbox', { name: 'Ask Sim', exact: true })).toBeVisible()
      await capture()
      await expect(attachments()).toHaveCount(1)
      await shell.bringToFront()
      await Promise.all([
        shell.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === `/api/organizations/${organizationId}` &&
            [401, 403, 404].includes(response.status()),
          { timeout: revalidationTimeout }
        ),
        sql`delete from member where organization_id=${organizationId} and user_id=${userId}`.then(
          advanceAccessRevalidation
        ),
      ])
      await expect(frame().getByText('This organization is unavailable.')).toBeVisible()
      await expect(frame().getByRole('textbox', { name: 'Ask Sim', exact: true })).toHaveCount(0)
      await expect(attachments()).toHaveCount(0)
      await screenshot('organization-membership-revoked')
      await navigate(`${base.origin}/extension/${alphaId}`)
      await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
    }
  )
  await checkAccess(
    'Revoking workspace access removes the live composer and pending captures',
    async () => {
      assert(userId)
      await capture()
      await expect(attachments()).toHaveCount(1)
      await shell.bringToFront()
      try {
        await Promise.all([
          shell.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === `/api/workspaces/${alphaId}/host-context` &&
              response.status() === 403,
            { timeout: revalidationTimeout }
          ),
          sql`delete from permissions where user_id=${userId} and entity_type='workspace' and entity_id=${alphaId}`.then(
            advanceAccessRevalidation
          ),
        ])
        await expect(frame().getByText('This workspace is unavailable.')).toBeVisible()
        await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0)
        await expect(attachments()).toHaveCount(0)
        await screenshot('workspace-membership-revoked')
      } finally {
        await sql`insert into permissions (id, user_id, entity_type, entity_id, permission_type) values (${generateId()}, ${userId}, 'workspace', ${alphaId}, 'admin')`
      }
      await navigate(`${base.origin}/extension/${alphaId}`)
      await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
    }
  )
  const reconnect = async () => {
    await frame().evaluate(() => {
      window.dispatchEvent(new Event('offline'))
      window.dispatchEvent(new Event('online'))
    })
  }
  const workspaceListUrl = (url: URL) =>
    url.origin === base.origin && url.pathname === '/api/workspaces'
  for (const [status, name] of [
    [503, 'A transient workspace-list refetch preserves the mounted picker and scroll position'],
    [401, 'An expired workspace-list session replaces cached choices with sign-in recovery'],
    [403, 'A forbidden workspace-list refetch removes cached choices'],
    [404, 'A missing workspace-list refetch removes cached choices'],
    [400, 'An invalid workspace-list request removes cached choices'],
  ] as const) {
    await checkAccess(name, async () => {
      await navigate(`${base.origin}/extension`)
      const choices = frame().getByRole('navigation', { name: 'Workspaces', exact: true })
      await expect(choices).toBeVisible()
      const original = await choices.elementHandle()
      assert(original)
      const scroller = frame().getByRole('main')
      await scroller.evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      const scrollTop = await scroller.evaluate((element) => element.scrollTop)
      assert(scrollTop > 0, 'Workspace picker fixture did not overflow')
      const failures: Request[] = []
      await browserContext.route(workspaceListUrl, async (route) => {
        injectedRequests.add(route.request())
        await route.fulfill({ status, json: { error: 'QA workspace-list failure' } })
        failures.push(route.request())
      })
      try {
        await shell.clock.setFixedTime(Date.now() + 360_000)
        await reconnect()
        await expect.poll(() => failures.length).toBe(2)
        await Promise.all(
          failures.map(async (request) => {
            const response = await request.response()
            assert(response)
            await response.finished()
          })
        )
        await frame().evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            )
        )
        if (status === 503) {
          assert(
            await original.evaluate((element) => element.isConnected),
            'A transient workspace-list refetch unmounted the picker'
          )
          assert.equal(await scroller.evaluate((element) => element.scrollTop), scrollTop)
          await expect(choices.getByRole('link').last()).toHaveAttribute(
            'href',
            `/extension/${alphaId}`
          )
          await screenshot('workspace-picker-refetch-outage')
          await choices.getByRole('link', { name: 'Extension QA alpha', exact: true }).click()
          await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
        } else {
          await expect(choices).toHaveCount(0)
          if (status === 401)
            await expect(frame().getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
          else
            await expect(
              frame().getByRole('button', { name: 'Retry loading workspaces', exact: true })
            ).toBeVisible()
          await screenshot(`workspace-picker-refetch-${status}`)
        }
      } finally {
        await original.dispose()
        await browserContext.unroute(workspaceListUrl)
        await shell.clock.setFixedTime(Date.now())
      }
    })
  }
  await checkAccess(
    'An initial workspace-list 401 recovers when the same user returns',
    async () => {
      await browserContext.route(workspaceListUrl, async (route) => {
        injectedRequests.add(route.request())
        await route.fulfill({ status: 401, json: { error: 'QA workspace-list session expired' } })
      })
      try {
        await navigate(`${base.origin}/extension`)
        await expect(frame().getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
        await expect(
          frame().getByRole('navigation', { name: 'Workspaces', exact: true })
        ).toHaveCount(0)
        await screenshot('workspace-picker-initial-session-expired')
      } finally {
        await browserContext.unroute(workspaceListUrl)
      }
      const returnedFrom = await openPage()
      try {
        await returnedFrom.goto(`${fixtureOrigin}/page`)
        await returnedFrom.bringToFront()
      } finally {
        await returnedFrom.close()
      }
      await shell.bringToFront()
      const choices = frame().getByRole('navigation', { name: 'Workspaces', exact: true })
      await expect(choices).toBeVisible()
      await screenshot('workspace-picker-session-restored')
      await choices.getByRole('link', { name: 'Extension QA alpha', exact: true }).click()
      await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
    }
  )
  await checkAccess(
    'Transient session, workspace, and permission-policy refetch failures preserve the mounted composer and page draft',
    async () => {
      for (const [path, attempts, scope] of [
        ['/api/auth/get-session', 1, 'session'],
        [`/api/workspaces/${alphaId}/host-context`, 2, 'workspace'],
        ['/api/permission-groups/user', 4, 'permission-policy'],
      ] as const) {
        await navigate(`${base.origin}/extension/${alphaId}`)
        const editor = frame().getByRole('textbox', { name: 'Message', exact: true })
        await expect(editor).toBeVisible()
        await capture()
        await editor.fill('Keep this draft through a temporary network failure.')
        const original = await editor.elementHandle()
        assert(original)
        const endpoint = `${base.origin}${path}`
        let failures = 0
        await browserContext.route(`${endpoint}*`, async (route) => {
          injectedRequests.add(route.request())
          await route.fulfill({
            status: 503,
            json: { message: 'QA temporary outage', error: 'QA temporary outage' },
          })
          failures++
        })
        try {
          await shell.clock.setFixedTime(Date.now() + 360_000)
          await reconnect()
          await expect.poll(() => failures).toBe(attempts)
          await frame().evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
              )
          )
          assert(
            await original.evaluate((element) => element.isConnected),
            'A transient refetch unmounted the composer'
          )
          await expect(editor).toHaveValue('Keep this draft through a temporary network failure.')
          await expect(attachments()).toHaveCount(1)
          await screenshot(`${scope}-refetch-outage`)
        } finally {
          await browserContext.unroute(`${endpoint}*`)
          await shell.clock.setFixedTime(Date.now())
        }
      }
      await navigate(`${base.origin}/extension/${alphaId}`)
    }
  )
  await checkAccess(
    'Explicit session, workspace, and permission-policy failures clear captured context after refetch',
    async () => {
      for (const [path, status, scope] of [
        ['/api/auth/get-session', 401, 'session'],
        ['/api/auth/get-session', 403, 'session'],
        [`/api/workspaces/${alphaId}/host-context`, 403, 'workspace'],
        [`/api/workspaces/${alphaId}/host-context`, 404, 'workspace'],
        ['/api/permission-groups/user', 401, 'permission-policy'],
        ['/api/permission-groups/user', 403, 'permission-policy'],
        ['/api/permission-groups/user', 404, 'permission-policy'],
        ['/api/permission-groups/user', 200, 'permission-policy'],
      ] as const) {
        await navigate(`${base.origin}/extension/${alphaId}`)
        await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
        await capture()
        const endpoint = `${base.origin}${path}`
        await browserContext.route(`${endpoint}*`, async (route) => {
          injectedRequests.add(route.request())
          await route.fulfill({
            status,
            json: { message: 'QA access revoked', error: 'QA access revoked' },
          })
        })
        try {
          await shell.clock.setFixedTime(Date.now() + 360_000)
          await reconnect()
          if (scope === 'session')
            await expect(frame().getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
          else if (scope === 'workspace')
            await expect(frame().getByText('This workspace is unavailable.')).toBeVisible()
          else
            await expect(frame().getByText('Unable to check access', { exact: true })).toBeVisible()
          await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(
            0
          )
          await expect(attachments()).toHaveCount(0)
          await screenshot(`${scope}-revoked-${status}`)
        } finally {
          await browserContext.unroute(`${endpoint}*`)
          await shell.clock.setFixedTime(Date.now())
        }
      }
      await navigate(`${base.origin}/extension/${alphaId}`)
      await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
    }
  )
  await checkAccess('An initial permission-policy outage keeps chat inaccessible', async () => {
    const endpoint = `${base.origin}/api/permission-groups/user*`
    await browserContext.route(endpoint, async (route) => {
      injectedRequests.add(route.request())
      await route.fulfill({ status: 503, json: { error: 'QA initial policy outage' } })
    })
    try {
      await navigate(`${base.origin}/extension/${alphaId}`)
      await expect(frame().getByText('Unable to check access', { exact: true })).toBeVisible()
      await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0)
      await screenshot('permission-policy-initial-outage')
    } finally {
      await browserContext.unroute(endpoint)
    }
    await navigate(`${base.origin}/extension/${alphaId}`)
    await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
  })
  await checkAccess(
    'Signing out removes authenticated chat and captured page context',
    async () => {
      await capture()
      const response = await browserContext.request.post(`${base.origin}/api/auth/sign-out`, {
        headers: { origin: base.origin },
        data: {},
      })
      assert.equal(response.status(), 200)
      await shell.clock.setFixedTime(Date.now() + 360_000)
      await reconnect()
      await expect(frame().getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
      await screenshot('expired-session')
      await expect(attachments()).toHaveCount(0)
      await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0)
    }
  )
  assert(
    checks.some((entry) => entry.status === 'passed'),
    'The selected group ran no acceptance checks'
  )
  assert.deepEqual(browserErrors, [], 'Browser raised uncaught application errors')
  assert.deepEqual(
    httpErrors.filter((entry) => entry.status >= 500 && !entry.injected),
    [],
    'App returned a server error'
  )
} catch (error) {
  if (!checks.some((entry) => entry.status === 'failed'))
    checks.push({
      name: 'Suite setup',
      status: 'failed',
      durationMs: 0,
      error: reportError(error),
    })
  logger.error('Browser acceptance failed', { error: reportError(error) })
  pendingAtFailure = [...pendingRequests].map((request) => ({
    path: new URL(request.url()).pathname,
    method: request.method(),
    resourceType: request.resourceType(),
  }))
  failureState = await Promise.all(
    (panel?.frames() ?? []).map(async (frame) => ({
      path: new URL(frame.url()).pathname,
      chatId: new URL(frame.url()).searchParams.get('chat'),
      text: await frame
        .locator('body')
        .innerText({ timeout: 1_000 })
        .catch(() => ''),
    }))
  )
  await screenshot('failure').catch(() => {})
  process.exitCode = 1
} finally {
  releaseHeldRequest()
  await context?.close()
  await Promise.all(responseDiagnostics)
  for (const path of uploadedPaths) await rm(path, { force: true })
  fixture.closeAllConnections()
  fixture.close()
  const cleanupFixtures = async () => {
    if (!userId) return
    const owner = userId
    await sql.begin(async (tx) => {
      await tx`delete from workspace where id=${hostedWorkspaceId}`
      await tx`delete from project where id=${hostProjectId}`
      await tx`delete from organization where id in (${organizationId}, ${otherOrganizationId})`
      for (const id of [owner, otherUserId]) {
        await tx`delete from workspace where owner_id=${id}`
        await tx`delete from project where owner_id=${id}`
        await tx`delete from "user" where id=${id}`
      }
    })
    const remaining = await sql`select id from "user" where id=${owner}`
    assert.equal(remaining.length, 0)
  }
  const cleanup =
    group === 'access'
      ? cleanupFixtures()
      : check(
          group === 'navigation' ? 'navigation' : 'composer',
          'Disposable database fixtures are removed',
          cleanupFixtures
        )
  await cleanup.catch((error) => {
    if (group === 'access')
      checks.push({
        name: 'Fixture cleanup',
        status: 'failed',
        durationMs: 0,
        error: reportError(error),
      })
    logger.error('Fixture cleanup failed', { error: reportError(error) })
    process.exitCode = 1
  })
  await sql.end()
  await writeFile(
    report,
    JSON.stringify(
      {
        suite: 'browser-extension-real-app',
        group,
        liveChat,
        checks,
        screenshots,
        browserErrors,
        voiceDiagnostics,
        signInRecoveryReceipts,
        failedRequests,
        pendingRequests: pendingAtFailure,
        failureState,
        httpErrors,
        chatResponses,
        chatAttempts,
        dropReceipts,
        uploadRequests,
        draftRemovalReceipts,
      },
      null,
      2
    )
  )
  await rm(temporary, { recursive: true, force: true })
}
