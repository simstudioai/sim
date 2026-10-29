import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { type BrowserContext, expect as browserExpect, chromium, type Page } from '@playwright/test'
import { pageSnapshotSchema } from '@sim/browser-extension-protocol'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { generateRandomHex } from '@sim/utils/random'
import postgres from 'postgres'

/** Authenticated packaged-browser acceptance against a real local Sim app and disposable Postgres. */
const logger = createLogger('BrowserExtensionAppE2E')
const expect = browserExpect.configure({ timeout: 30_000 })
function required(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}
const base = new URL(required('EXTENSION_APP_E2E_BASE_URL'))
const database = new URL(required('EXTENSION_APP_E2E_DATABASE_URL'))
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
assert(
  loopback.includes(database.hostname) &&
    ['postgres:', 'postgresql:'].includes(database.protocol) &&
    /(?:^|[_-])test(?:[_-]|$)/i.test(database.pathname.slice(1)),
  'Use a disposable local test database'
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
const httpErrors: { path: string; status: number }[] = []
let context: BrowserContext | undefined
let panel: Page | undefined
let userId: string | undefined
let releaseHeldRequest = () => {}
const alphaId = generateId()
const betaId = generateId()
const deniedId = generateId()
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
  const path = `${report}.${name}.png`
  await panel.screenshot({ path, fullPage: true, animations: 'disabled' })
  screenshots.push(path)
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
  const build = spawnSync(process.execPath, ['scripts/build.ts'], {
    cwd: extensionRoot,
    env: { ...process.env, SIM_EXTENSION_ORIGIN: base.origin, SIM_EXTENSION_DEV: '1' },
    encoding: 'utf8',
    timeout: 120_000,
  })
  assert.equal(build.status, 0, build.stderr)
  const extensionPath = resolve(temporary, 'extension')
  await cp(resolve(extensionRoot, 'dist'), extensionPath, { recursive: true })
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
  panel.on('response', (response) => {
    const url = new URL(response.url())
    if (url.origin === base.origin && response.status() >= 400)
      httpErrors.push({ path: url.pathname, status: response.status() })
  })
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  const frame = () => {
    const app = shell.frames().find((candidate) => candidate.url().startsWith(base.origin))
    assert(app, 'Hosted app frame is unavailable')
    return app
  }
  const navigate = async (url: string) => {
    const navigation = frame().waitForNavigation({ waitUntil: 'domcontentloaded' })
    await frame().evaluate((destination) => window.location.assign(destination), url)
    await navigation
  }
  await check('Signed-out users get the real top-level Sim sign-in flow', async () => {
    await expect(frame().getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
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
    await frame().getByRole('link', { name: 'Extension QA alpha', exact: true }).click()
    await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
  })
  const source = await context.newPage()
  await source.goto(`${fixtureOrigin}/page?private=QUERY_SECRET#FRAGMENT_SECRET`)
  const capture = async () => {
    await source.bringToFront()
    await shell.getByRole('button', { name: 'Attach page', exact: true }).evaluate(
      (button) =>
        new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            window.removeEventListener('message', receive)
            reject(new Error('The app did not acknowledge the page attachment'))
          }, 30_000)
          function receive(event: MessageEvent<unknown>) {
            if (
              event.source !== document.querySelector('iframe')?.contentWindow ||
              typeof event.data !== 'object' ||
              event.data === null ||
              !('type' in event.data) ||
              event.data.type !== 'context-received'
            )
              return
            window.clearTimeout(timeout)
            window.removeEventListener('message', receive)
            resolve()
          }
          window.addEventListener('message', receive)
          const trigger = button as HTMLButtonElement
          trigger.click()
        })
    )
  }
  const attachments = () => frame().getByRole('region', { name: 'Page attached to next message' })
  await check(
    'Capture, preview, removal, and the three-page cap use the real composer',
    async () => {
      await capture()
      await expect(attachments()).toHaveCount(1)
      await attachments()
        .first()
        .getByRole('button', { name: /^Review page context:/ })
        .click()
      const preview = frame().getByRole('dialog', { name: 'Page context', exact: true })
      await expect(preview.locator('pre')).toHaveText(
        captureText.replace('QA_PRIVATE_PAGE_MARKER:', 'Delivery plan\nQA_PRIVATE_PAGE_MARKER:')
      )
      await preview.getByRole('button', { name: 'Close', exact: true }).click()
      await capture()
      await capture()
      await capture()
      await expect(attachments()).toHaveCount(3)
      await expect(frame().getByRole('alert').filter({ hasText: 'Remove one' })).toBeVisible()
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
            await shell
              .getByRole('button', { name: 'Extension options', exact: true })
              .dispatchEvent('pointerdown', { button: 0, ctrlKey: false, pointerType: 'mouse' })
            await expect(
              shell.getByRole('menuitem', { name: 'Remove access to localhost', exact: true })
            ).toBeVisible()
            await screenshot('site-options')
            await shell.keyboard.press('Escape')
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
    await frame().getByRole('menuitem', { name: 'Extension QA history' }).click()
    await expect(attachments()).toHaveCount(0)
    await expect(frame().getByText('QA history response.', { exact: false })).toBeVisible()
  })
  await check('Sources and resource actions preserve their real destinations', async () => {
    await frame().getByRole('button', { name: '1 source', exact: true }).click()
    await frame().getByRole('button', { name: 'View all sources' }).click()
    const dialog = frame().getByRole('dialog', { name: 'Cited sources' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('link', { name: 'QA evidence' })).toHaveAttribute(
      'href',
      'https://example.com/qa-evidence'
    )
    await shell.bringToFront()
    await dialog.getByRole('button', { name: 'Actions for QA evidence' }).click()
    await frame().getByRole('menuitem', { name: 'Copy link', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Link copied', exact: true })).toBeVisible()
    await shell.route('**/__extension-qa-recorder.js', (route) =>
      route.fulfill({
        path: resolve(dirname(require.resolve('posthog-js')), 'posthog-recorder.js'),
        contentType: 'application/javascript',
      })
    )
    await frame().addScriptTag({ url: `${base.origin}/__extension-qa-recorder.js` })
    const recorded = await frame().evaluate(() => {
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
    assert(recorded.includes('"type":2'), 'Recorder did not produce a full DOM snapshot')
    assert(!recorded.includes('QA evidence'), 'Portaled citation content entered session replay')
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    assert.equal(new URL(frame().url()).searchParams.get('source-message'), null)
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
  if (liveChat) {
    await check(
      'Page context reaches Mothership, streams a grounded answer, and preserves the follow-up draft through admission',
      async () => {
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
        const input = frame().getByLabel('Message', { exact: true })
        await input.fill(
          'Using only the attached page, reply with the launch code and delivery day. Do not use tools.'
        )
        await input.press('Enter')
        await expect.poll(() => submitted.length).toBe(1)
        await capture()
        await input.fill('Reply only QUEUE_OK using this queued page context.')
        await input.press('Enter')
        await expect(frame().getByRole('button', { name: 'Edit queued message' })).toBeVisible()
        await frame().evaluate(() => {
          const original = Storage.prototype.setItem
          Storage.prototype.setItem = function (key, value) {
            original.call(this, key, value)
            if (key === 'mothership-drafts:v1')
              document.body.dataset.qaDraftSaves = String(
                Number(document.body.dataset.qaDraftSaves ?? '0') + 1
              )
          }
        })
        await frame().getByRole('button', { name: 'Edit queued message' }).click()
        await expect(input).toHaveValue(/QUEUE_OK/)
        await input.evaluate((element) => (element as HTMLTextAreaElement).setSelectionRange(0, 0))
        await input.pressSequentially('Updated: ')
        await input.press('Escape')
        await expect
          .poll(() => frame().evaluate(() => Number(document.body.dataset.qaDraftSaves ?? '0')))
          .toBeGreaterThan(0)
        assert(
          !(await frame().evaluate(() => JSON.stringify(localStorage))).includes(
            'QA_PRIVATE_PAGE_MARKER'
          ),
          'Restored queued page bytes entered draft storage'
        )
        await input.press('Enter')
        await capture()
        await input.fill('FOLLOW_UP_DRAFT_SURVIVES_ADMISSION')
        release()
        await expect
          .poll(() => new URL(frame().url()).searchParams.get('chat'), { timeout: 120_000 })
          .toBeTruthy()
        await expect(input).toHaveValue('FOLLOW_UP_DRAFT_SURVIVES_ADMISSION')
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
        const queued = pageSnapshotSchema.parse(toRecord(queuedContexts[0]).snapshot)
        assert.notEqual(queued.id, sent.id)
        assert.equal(queued.text, sent.text)
        await expect(frame().getByText('QUEUE_OK', { exact: true })).toBeVisible({
          timeout: 120_000,
        })
        await shell.unroute('**/api/mothership/chat')
        await screenshot('grounded-response')
        await navigate(`${base.origin}/extension/${alphaId}?chat=${chatId}`)
        await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
          'FOLLOW_UP_DRAFT_SURVIVES_ADMISSION'
        )
        await expect(
          frame()
            .getByText(/ORCHID-482/)
            .first()
        ).toBeVisible()
        await frame().getByRole('button', { name: 'New chat', exact: true }).click()
        await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('')
      }
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
  await check('Signing out removes authenticated chat and captured page context', async () => {
    await capture()
    const response = await browserContext.request.post(`${base.origin}/api/auth/sign-out`, {
      headers: { origin: base.origin },
      data: {},
    })
    assert.equal(response.status(), 200)
    await navigate(`${base.origin}/extension/${alphaId}`)
    await expect(frame().getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
    await expect(attachments()).toHaveCount(0)
    await expect(frame().getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0)
  })
  assert.deepEqual(browserErrors, [], 'Browser raised uncaught application errors')
  assert.deepEqual(
    httpErrors.filter((entry) => entry.status >= 500),
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
  await screenshot('failure').catch(() => {})
  process.exitCode = 1
} finally {
  releaseHeldRequest()
  await context?.close()
  fixture.closeAllConnections()
  fixture.close()
  await check('Disposable database fixtures are removed', async () => {
    if (!userId) return
    const owner = userId
    await sql.begin(async (tx) => {
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
        httpErrors,
      },
      null,
      2
    )
  )
  await rm(temporary, { recursive: true, force: true })
}
