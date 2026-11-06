import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type BrowserContext, chromium, expect, type Page } from '@playwright/test'
import { recentPagesSchema, recentsStatusSchema } from '@sim/browser-extension-protocol'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const logger = createLogger('BrowserExtensionRecentsE2E')
const reportPath = process.env.EXTENSION_RECENTS_REPORT_PATH
if (!reportPath)
  throw new Error('Set EXTENSION_RECENTS_REPORT_PATH to the output JSON report path.')
const output = resolve(root, reportPath)
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const serverRequests: string[] = []

const fixture = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    serverRequests.push(`${request.url} ${request.headers.get('referer') ?? ''}`)
    return new Response('<!doctype html><title>Sim fixture</title><h1>Sim</h1>', {
      headers: { 'content-type': 'text/html' },
    })
  },
})

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

async function check(name: string, run: () => Promise<void>) {
  const started = performance.now()
  logger.info(`Checking ${name}`)
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) })
  } catch (error) {
    process.exitCode = 1
    checks.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: getErrorMessage(error),
    })
  }
}

const temporary = await mkdtemp(resolve(tmpdir(), 'sim-extension-recents-'))
const origin = `http://127.0.0.1:${fixture.port}`
const otherOrigin = `http://localhost:${fixture.port}`

/** A context on the packaged extension; `pregrant` moves the optional permissions to required, which skips the prompt no automation can answer. */
async function launch(name: string, pregrant: boolean) {
  const extensionPath = resolve(temporary, `extension-${name}`)
  const built = spawnSync(process.execPath, ['scripts/build.ts', `--outdir=${extensionPath}`], {
    cwd: root,
    env: { ...process.env, SIM_EXTENSION_ORIGIN: origin, SIM_EXTENSION_DEV: '1' },
    encoding: 'utf8',
  })
  assert(built.status === 0, `Extension build failed: ${built.stderr}`)
  const manifestPath = resolve(extensionPath, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (pregrant) {
    manifest.permissions.push(...manifest.optional_permissions)
    manifest.optional_permissions = undefined
  }
  await writeFile(manifestPath, JSON.stringify(manifest))
  const context = await chromium.launchPersistentContext(resolve(temporary, `profile-${name}`), {
    channel: 'chromium',
    headless: true,
    args: [
      '--no-proxy-server',
      '--enable-unsafe-extension-debugging',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  })
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  context.setDefaultTimeout(15_000)
  return { context, worker, extensionId: worker.url().split('/')[2], manifest }
}

/** What the web page does: an answer, or undefined with `chrome.runtime` absent or nobody listening. */
function send(page: Page, extensionId: string, message: unknown) {
  return page.evaluate(
    ([id, body]) =>
      new Promise<{ available: boolean; response?: unknown }>((settle) => {
        const runtime = (window as unknown as { chrome?: { runtime?: typeof chrome.runtime } })
          .chrome?.runtime
        if (!runtime?.sendMessage) return settle({ available: false })
        runtime.sendMessage(id as string, body, (response: unknown) => {
          void runtime.lastError
          settle({ available: true, response })
        })
      }),
    [extensionId, message] as const
  )
}

const envelope = { channel: 'sim-extension', version: 1 } as const
const status = { ...envelope, type: 'recents-status' } as const
const pages = { ...envelope, type: 'recent-pages', limit: 20 } as const

const VISITS = [
  'https://public.example.com/article',
  'https://public.example.com/article?utm_source=mail',
  'https://shop.example.com/item?id=7',
  'http://localhost:9000/private',
  'http://192.168.1.10/router',
  'http://go/payroll',
  'https://accounts.example.com/signin',
  'https://other.example.com/login',
  `${origin}/workspace/secret`,
  'https://public.example.com/next#section',
]

let context: BrowserContext | undefined
try {
  const unconsented = await launch('unconsented', false)
  context = unconsented.context
  const { worker, extensionId, manifest } = unconsented

  await check('History is optional, and only the exact Sim origin can connect', async () => {
    assert(!manifest.permissions.includes('history'), 'History became a required permission')
    assert(
      manifest.optional_permissions.includes('history'),
      'History is not an optional permission'
    )
    assert(manifest.optional_permissions.includes('favicon'), 'Favicon is not optional')
    assert(!manifest.web_accessible_resources, 'A resource was exposed to web pages')
    assert(
      JSON.stringify(manifest.externally_connectable.matches) === JSON.stringify([`${origin}/*`]),
      'externally_connectable is wider than the Sim origin'
    )
  })

  const sim = await context.newPage()
  await sim.goto(`${origin}/home`)

  await check('Another origin cannot reach the extension at all', async () => {
    const other = await unconsented.context.newPage()
    await other.goto(`${otherOrigin}/home`)
    const reply = await send(other, extensionId, pages)
    assert(!reply.available, 'chrome.runtime was exposed to another origin')
    await other.close()
  })

  await check('Before opting in, the Sim page learns only that it is not on', async () => {
    const reply = await send(sim, extensionId, status)
    expect(recentsStatusSchema.parse(reply.response)).toEqual({
      permission: 'not_granted',
      enabled: false,
    })
    const read = await send(sim, extensionId, pages)
    expect(recentPagesSchema.parse(read.response).pages).toEqual([])
  })

  await check('A preference without the permission reads nothing', async () => {
    await worker.evaluate(() => chrome.storage.local.set({ recentPagesEnabled: true }))
    const read = await send(sim, extensionId, pages)
    expect(recentPagesSchema.parse(read.response).pages).toEqual([])
    await worker.evaluate(() => chrome.storage.local.remove('recentPagesEnabled'))
  })

  await check('Malformed and unknown messages get no answer', async () => {
    for (const message of [
      { ...envelope, type: 'recent-pages', limit: 1000 },
      { ...envelope, type: 'recents-status', extra: true },
      { ...envelope, version: 2, type: 'recents-status' },
      { ...envelope, type: 'set-enabled', enabled: true },
    ]) {
      const reply = await send(sim, extensionId, message)
      assert(reply.response === undefined, `Answered ${JSON.stringify(message)}`)
    }
  })

  await check('The Sim page can open setup, but cannot turn it on', async () => {
    const opened = unconsented.context.waitForEvent('page')
    await send(sim, extensionId, { ...envelope, type: 'open-recents-setup' })
    const setup = await opened
    await expect(setup).toHaveURL(`chrome-extension://${extensionId}/recents.html`)
    await expect(setup.getByRole('heading', { name: 'Recent pages on Sim Home' })).toBeVisible()
    const stored = await worker.evaluate(() => chrome.storage.local.get('recentPagesEnabled'))
    assert(stored.recentPagesEnabled === undefined, 'Opening setup turned recents on')
    const wrapped = await setup.evaluate(() => {
      const requests: unknown[] = []
      ;(window as unknown as { requests: unknown[] }).requests = requests
      chrome.permissions.request = ((permissions: unknown) => {
        requests.push(permissions)
        return Promise.resolve(false)
      }) as typeof chrome.permissions.request
      return true
    })
    assert(wrapped, 'Could not observe the permission request')
    await setup.getByRole('button', { name: 'Turn on' }).click()
    await expect(setup.getByRole('status')).toContainText('nothing changed')
    const requested = await setup.evaluate(
      () => (window as unknown as { requests: unknown[] }).requests
    )
    expect(requested).toEqual([{ permissions: ['history', 'favicon'] }])
    const declined = await worker.evaluate(() => chrome.storage.local.get('recentPagesEnabled'))
    assert(declined.recentPagesEnabled === undefined, 'Declining turned recents on')
    await setup.close()
  })
  await unconsented.context.close()
  context = undefined

  const consented = await launch('consented', true)
  context = consented.context
  const page = await context.newPage()
  await page.goto(`${origin}/home`)
  await consented.worker.evaluate(async (urls) => {
    for (const url of urls) await chrome.history.addUrl({ url })
  }, VISITS)

  await check('With the permission but no opt-in, nothing is read', async () => {
    const read = await send(page, consented.extensionId, pages)
    expect(recentPagesSchema.parse(read.response).pages).toEqual([])
  })

  await consented.worker.evaluate(() => chrome.storage.local.set({ recentPagesEnabled: true }))

  await check('Opted in, only safe pages come back, without their query or fragment', async () => {
    const read = await send(page, consented.extensionId, pages)
    const urls = recentPagesSchema.parse(read.response).pages.map((entry) => entry.url)
    expect([...urls].sort()).toEqual([
      'https://public.example.com/article',
      'https://public.example.com/next',
    ])
  })

  await check('Icons reach the page as image data, from the worker', async () => {
    const read = await send(page, consented.extensionId, pages)
    const icons = recentPagesSchema.parse(read.response).pages.map((entry) => entry.iconUrl)
    for (const icon of icons) {
      assert(icon?.startsWith('data:image/'), `Expected an inline icon, got ${icon}`)
    }
  })

  await check('Nothing about a visited page is stored or sent to the Sim origin', async () => {
    const stored = await consented.worker.evaluate(async () =>
      JSON.stringify([await chrome.storage.local.get(null), await chrome.storage.session.get(null)])
    )
    assert(!stored.includes('example.com'), `A visited address was stored: ${stored}`)
    const leaked = serverRequests.filter((request) => request.includes('example.com'))
    assert(leaked.length === 0, `A visited address reached the server: ${leaked.join(', ')}`)
  })
} catch (error) {
  process.exitCode = 1
  checks.push({
    name: 'Suite setup',
    status: 'failed',
    durationMs: 0,
    error: getErrorMessage(error),
  })
} finally {
  await context?.close()
  fixture.stop(true)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify({ suite: 'browser-extension-recents', checks }, null, 2))
  await rm(temporary, { recursive: true, force: true })
}
for (const entry of checks)
  logger.info(`${entry.status}: ${entry.name}${entry.error ? ` (${entry.error})` : ''}`)
process.exit(process.exitCode ?? 0)
