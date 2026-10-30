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
  type Page,
  type Request,
} from '@playwright/test'
import { pageSnapshotSchema } from '@sim/browser-extension-protocol'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { generateRandomHex } from '@sim/utils/random'
import postgres from 'postgres'
import { chatContextsSchema } from '@/lib/api/contracts/mothership-chat-context'

/** Authenticated packaged-browser acceptance against a real local Sim app and disposable Postgres. */
const logger = createLogger('BrowserExtensionAppE2E')
const expect = browserExpect.configure({ timeout: 30_000 })
const ACCESS_REVALIDATION_TIMEOUT_MS = 35_000
function required(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}
const base = new URL(required('EXTENSION_APP_E2E_BASE_URL'))
const database = assertDisposableTestDatabaseUrl(required('EXTENSION_APP_E2E_DATABASE_URL'))
const report = resolve(required('EXTENSION_APP_E2E_REPORT_PATH'))
const liveChat = process.env.EXTENSION_APP_E2E_LIVE_CHAT === '1'
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
const httpErrors: { path: string; status: number; injected: boolean }[] = []
const injectedRequests = new WeakSet<Request>()
const pendingRequests = new Set<Request>()
const failedRequests: { path: string; error: string | null }[] = []
let failureState: { path: string; text: string }[] = []
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

async function check(name: string, run: () => Promise<void>) {
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
      error: getErrorMessage(error),
    })
    throw error
  }
}
async function screenshot(name: string) {
  if (!panel) return
  for (const frame of panel.frames()) {
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
  await panel.screenshot({ path, fullPage: true, animations: 'disabled' })
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
  context = await chromium.launchPersistentContext(resolve(temporary, 'profile'), {
    channel: 'chromium',
    headless: process.env.EXTENSION_APP_E2E_HEADED !== '1',
    viewport: { width: 390, height: 844 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--use-fake-device-for-media-stream',
    ],
  })
  const browserContext = context
  context.setDefaultTimeout(30_000)
  context.setDefaultNavigationTimeout(120_000)
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  const extensionId = worker.url().split('/')[2]
  panel = await context.newPage()
  const shell = panel
  await shell.route('**/api/settings/voice', (route) =>
    route.fulfill({ json: { sttAvailable: true } })
  )
  panel.on('pageerror', (error) => browserErrors.push(error.message))
  panel.on('request', (request) => pendingRequests.add(request))
  panel.on('requestfinished', (request) => pendingRequests.delete(request))
  panel.on('requestfailed', (request) => {
    pendingRequests.delete(request)
    failedRequests.push({
      path: new URL(request.url()).pathname,
      error: request.failure()?.errorText ?? null,
    })
  })
  panel.on('response', (response) => {
    const url = new URL(response.url())
    if (url.origin === base.origin && response.status() >= 400)
      httpErrors.push({
        path: url.pathname,
        status: response.status(),
        injected: injectedRequests.has(response.request()),
      })
  })
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
  await check('Signed-out users get the real top-level Sim sign-in flow', async () => {
    await expect(frame().getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
    await screenshot('signed-out')
    const link = frame().getByRole('link', { name: 'Sign in', exact: true })
    const opened = browserContext.waitForEvent('page')
    await link.click()
    const login = await opened
    await login.waitForURL('**/login**')
    assert.equal(new URL(login.url()).origin, base.origin)
    await login.close()
  })
  await check('A real Better Auth session reaches the extension iframe', async () => {
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
    await shell.reload()
    await expect(
      frame().getByRole('link', { name: 'Extension QA alpha', exact: true })
    ).toBeVisible()
    await screenshot('workspace-picker')
    await frame().getByRole('link', { name: 'Extension QA alpha', exact: true }).click()
    await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toBeVisible({
      timeout: 120_000,
    })
  })
  const source = await context.newPage()
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
      })
    }, base.origin)
  await observeCaptureReceipts()
  const capture = async (mode: 'page' | 'selection' = 'page') => {
    await source.bringToFront()
    const before = Number(await shell.locator('body').getAttribute('data-capture-receipts'))
    await frame().getByRole('button', { name: 'Add resources', exact: true }).press('Enter')
    await frame()
      .getByRole('menuitem', {
        name: mode === 'page' ? 'Current page' : 'Selected text',
        exact: true,
      })
      .press('Enter')
    await expect(shell.locator('body')).toHaveAttribute('data-capture-receipts', String(before + 1))
  }
  const attachments = () => frame().getByRole('group', { name: 'Page attached to next message' })
  const attachFile = async () => {
    const completion = shell.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.startsWith('/api/files/uploads/') &&
        new URL(response.url()).pathname.endsWith('/complete')
    )
    await frame()
      .locator('input[type="file"]')
      .setInputFiles({
        name: 'extension-notes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('This synthetic file belongs only to extension QA.'),
      })
    const response = await completion
    assert.equal(response.status(), 200, await response.text())
    const body: unknown = await response.json()
    const asset = toRecord(toRecord(toRecord(body).data).result)
    assert.equal(typeof asset.key, 'string')
    trackUploadedFile(String(asset.key))
    await expect(
      frame().getByRole('button', { name: 'Remove extension-notes.txt', exact: true })
    ).toBeEnabled()
  }
  await check(
    'Capture, preview, removal, and the three-page cap use the real composer',
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
      await preview.getByRole('button', { name: 'Close', exact: true }).click()
      await capture()
      await capture()
      await capture()
      await expect(attachments()).toHaveCount(3)
      await expect(frame().getByRole('alert').filter({ hasText: 'Remove one' })).toBeVisible()
      await screenshot('page-limit')
      await attachments().first().getByRole('button', { name: 'Remove page context' }).click()
      await expect(attachments()).toHaveCount(2)
      const stored = await frame().evaluate(() => JSON.stringify(localStorage))
      assert(
        !stored.includes('QA_PRIVATE_PAGE_MARKER'),
        'Unsent page bytes entered app localStorage'
      )
    }
  )
  await check(
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
          await shell.setViewportSize({ width, height: 844 })
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
          await screenshot(`${theme}-${width}`)
          await capture()
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
          await screenshot(`${theme}-${width}-attached`)
          if (theme === 'light' && width === 320) {
            await frame()
              .getByRole('button', { name: 'Add resources', exact: true })
              .evaluate((button) => (button as HTMLButtonElement).click())
            await screenshot('capture-menu')
            await frame()
              .getByRole('menuitem', { name: 'Site access', exact: true })
              .evaluate((button) => (button as HTMLElement).click())
            const access = shell.getByRole('dialog', { name: 'Site access', exact: true })
            await expect(
              access.getByRole('button', { name: 'Remove access to localhost', exact: true })
            ).toBeVisible()
            await expect(
              frame().getByRole('menuitem', { name: 'Site access', exact: true })
            ).toHaveCount(0)
            await screenshot('site-options')
            await access.getByRole('button', { name: 'Close', exact: true }).click()
          }
          await attachments().first().getByRole('button', { name: 'Remove page context' }).click()
        }
      }
    }
  )
  await check('Workspace and conversation navigation clear pending page context', async () => {
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
  })
  await check(
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
  await check('Saved page previews stay out of session replay in the full app', async () => {
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
  })
  await check('Sources and resource actions preserve their real destinations', async () => {
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
  })
  await check(
    'The extension blocks microphone capture even when the Sim origin has permission',
    async () => {
      await browserContext.grantPermissions(['microphone'], { origin: base.origin })
      const denied = await frame().evaluate(async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          stream.getTracks().forEach((track) => track.stop())
          return false
        } catch (error) {
          return error instanceof DOMException && error.name === 'NotAllowedError'
        }
      })
      assert(denied, 'Microphone capture escaped the extension permissions policy')
      await expect(frame().getByRole('button', { name: 'Voice input', exact: true })).toHaveCount(0)
      await browserContext.clearPermissions()
    }
  )
  await check(
    'Files and pages share the attachment row, remove independently, and reach the submission boundary together',
    async () => {
      await capture()
      await attachFile()
      await screenshot('mixed-attachments')
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
  await check(
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
    await check(
      'Workspace live admission preserves queued pages, files, and the active draft',
      () =>
        verifyLiveChat({
          name: 'workspace',
          url: `${base.origin}/extension/${alphaId}`,
          inputLabel: 'Message',
          draftKey: `extension:${userId}:${alphaId}:new`,
        })
    )
  } else
    checks.push({ name: 'Live Mothership send and admission', status: 'skipped', durationMs: 0 })
  await check(
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
  await check(
    'Organization default landing binds page-only submissions to the organization',
    async () => {
      assert(userId)
      await sql`insert into organization (id, name, slug, created_at) values (${organizationId}, 'Extension QA organization', ${organizationId}, now())`
      await sql`insert into member (id, user_id, organization_id, role) values (${generateId()}, ${userId}, ${organizationId}, 'owner')`
      await navigate(`${base.origin}/extension`)
      await expect
        .poll(() => new URL(frame().url()).pathname)
        .toBe(`/extension/o/${organizationId}`)
      await expect(frame().getByRole('textbox', { name: 'Ask Sim', exact: true })).toBeVisible()
      await screenshot('organization-new-chat')
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
      await sql`insert into organization (id, name, slug, created_at) values (${otherOrganizationId}, 'Other QA organization', ${otherOrganizationId}, now())`
      await sql`insert into member (id, user_id, organization_id, role) values (${generateId()}, ${otherUserId}, ${otherOrganizationId}, 'owner')`
      await sql`insert into copilot_chats (id, user_id, organization_id, type, title, config) values (${otherOrganizationChatId}, ${userId}, ${otherOrganizationId}, 'mothership', 'Other organization history', ${sql.json({ conversationMode: 'agent' })})`
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
  await check(
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
  if (liveChat) {
    await check(
      'Organization live admission preserves queued pages and files without a workspace',
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
  await check('Search-only organization members can attach a page in Assistant', async () => {
    assert(userId)
    await sql`insert into permission_group (id, organization_id, name, config, created_by, is_default)
      values (${generateId()}, ${organizationId}, 'Search only',
      ${sql.json({ disableWorkspaceCreation: true })}, ${userId}, true)`
    await navigate(`${base.origin}/extension`)
    await expect.poll(() => new URL(frame().url()).pathname).toBe(`/extension/o/${organizationId}`)
    await expect(frame().getByRole('button', { name: 'Attach image', exact: true })).toBeVisible()
    await capture()
    await screenshot('organization-assistant-page')
    if (!liveChat)
      await shell.route('**/api/mothership/chat', (route) =>
        route.fulfill({ status: 403, json: { error: 'QA submission boundary' } })
      )
    const submitted = shell.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === '/api/mothership/chat' && request.method() === 'POST'
    )
    const input = frame().getByRole('textbox', { name: 'Ask Sim', exact: true })
    await input.fill(
      'Using only the attached page, reply with the launch code and delivery day. Do not use tools.'
    )
    await input.press('Enter')
    const body = toRecord((await submitted).postDataJSON())
    assert.equal(body.mode, 'assistant')
    assert.equal(body.organizationId, organizationId)
    assert.equal(body.workspaceId, undefined)
    assert(Array.isArray(body.contexts) && body.contexts.length === 1)
    assert(
      pageSnapshotSchema.parse(toRecord(body.contexts[0]).snapshot).text.includes('ORCHID-482')
    )
    if (liveChat) {
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
      await screenshot('organization-assistant-response')
    } else await shell.unroute('**/api/mothership/chat')
  })
  await check(
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
          { timeout: ACCESS_REVALIDATION_TIMEOUT_MS }
        ),
        sql`delete from member where organization_id=${organizationId} and user_id=${userId}`,
      ])
      await expect(frame().getByText('This organization is unavailable.')).toBeVisible()
      await expect(frame().getByRole('textbox', { name: 'Ask Sim', exact: true })).toHaveCount(0)
      await expect(attachments()).toHaveCount(0)
      await screenshot('organization-membership-revoked')
      await navigate(`${base.origin}/extension/${alphaId}`)
      await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
    }
  )
  await check(
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
            { timeout: ACCESS_REVALIDATION_TIMEOUT_MS }
          ),
          sql`delete from permissions where user_id=${userId} and entity_type='workspace' and entity_id=${alphaId}`,
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
  // Clock APIs replace animation timing, so native streaming checks must run first.
  const reconnect = async () => {
    await frame().evaluate(() => {
      window.dispatchEvent(new Event('offline'))
      window.dispatchEvent(new Event('online'))
    })
  }
  await check(
    'Transient session and workspace refetch failures preserve the mounted composer and page draft',
    async () => {
      for (const [path, attempts] of [
        ['/api/auth/get-session', 1],
        [`/api/workspaces/${alphaId}/host-context`, 2],
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
          await screenshot(
            path.includes('get-session') ? 'session-refetch-outage' : 'workspace-refetch-outage'
          )
        } finally {
          await browserContext.unroute(`${endpoint}*`)
          await shell.clock.setFixedTime(Date.now())
        }
      }
      await navigate(`${base.origin}/extension/${alphaId}`)
    }
  )
  await check(
    'Explicit session and workspace access failures clear captured context after refetch',
    async () => {
      for (const [path, status] of [
        ['/api/auth/get-session', 401],
        ['/api/auth/get-session', 403],
        [`/api/workspaces/${alphaId}/host-context`, 403],
        [`/api/workspaces/${alphaId}/host-context`, 404],
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
          if (path.includes('get-session'))
            await expect(frame().getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
          else await expect(frame().getByText('This workspace is unavailable.')).toBeVisible()
          await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(
            0
          )
          await expect(attachments()).toHaveCount(0)
          await screenshot(
            `${path.includes('get-session') ? 'session' : 'workspace'}-revoked-${status}`
          )
        } finally {
          await browserContext.unroute(`${endpoint}*`)
          await shell.clock.setFixedTime(Date.now())
        }
      }
      await navigate(`${base.origin}/extension/${alphaId}`)
      await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
    }
  )
  await check('Signing out removes authenticated chat and captured page context', async () => {
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
  })
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
      error: getErrorMessage(error),
    })
  logger.error('Browser acceptance failed', { error: getErrorMessage(error) })
  pendingAtFailure = [...pendingRequests].map((request) => ({
    path: new URL(request.url()).pathname,
    method: request.method(),
    resourceType: request.resourceType(),
  }))
  failureState = await Promise.all(
    (panel?.frames() ?? []).map(async (frame) => ({
      path: new URL(frame.url()).pathname,
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
  for (const path of uploadedPaths) await rm(path, { force: true })
  fixture.closeAllConnections()
  fixture.close()
  await check('Disposable database fixtures are removed', async () => {
    if (!userId) return
    const owner = userId
    await sql.begin(async (tx) => {
      await tx`delete from organization where id in (${organizationId}, ${otherOrganizationId})`
      for (const id of [owner, otherUserId]) {
        await tx`delete from workspace where owner_id=${id}`
        await tx`delete from project where owner_id=${id}`
        await tx`delete from "user" where id=${id}`
      }
    })
    const remaining = await sql`select id from "user" where id=${owner}`
    assert.equal(remaining.length, 0)
  }).catch((error) => {
    logger.error('Fixture cleanup failed', { error: getErrorMessage(error) })
    process.exitCode = 1
  })
  await sql.end()
  await writeFile(
    report,
    JSON.stringify(
      {
        suite: 'browser-extension-real-app',
        liveChat,
        checks,
        screenshots,
        browserErrors,
        failedRequests,
        pendingRequests: pendingAtFailure,
        failureState,
        httpErrors,
      },
      null,
      2
    )
  )
  await rm(temporary, { recursive: true, force: true })
}
