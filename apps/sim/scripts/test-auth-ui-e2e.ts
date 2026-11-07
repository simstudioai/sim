import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { build } from 'esbuild'
import postcss from 'postcss'
import loadPostcssConfig from 'postcss-load-config'

/**
 * Browser regression coverage for the real consent renderer, OAuth hooks and Auth controls.
 * Fixture HTTP endpoints own deterministic responses; server OAuth authorization is outside scope.
 * Requires AUTH_UI_E2E_REPORT_PATH; writes its report, screenshots and trace beside that path.
 */
const logger = createLogger('AuthUiE2E')
const reportValue = process.env.AUTH_UI_E2E_REPORT_PATH
assert(reportValue, 'AUTH_UI_E2E_REPORT_PATH must be explicitly provided')
const reportPath = resolve(reportValue)
const artifacts = `${reportPath}.artifacts`
const appRoot = resolve(import.meta.dirname, '..')
const work = await mkdtemp(join(tmpdir(), 'sim-auth-ui-e2e-'))
const checks: Array<{
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  error?: string
}> = []
const requests: Array<{ path: string; body: unknown }> = []
const pageErrors: string[] = []
let rejectConsent = false

async function run() {
  const postcssConfig = await loadPostcssConfig({}, appRoot)
  await mkdir(artifacts, { recursive: true })
  await build({
    entryPoints: [join(appRoot, 'scripts/auth-ui-e2e/fixture.tsx')],
    outdir: work,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    external: ['node:async_hooks'],
    tsconfig: join(appRoot, 'tsconfig.json'),
    loader: { '.module.css': 'local-css', '.woff2': 'file' },
    define: {
      'process.env': JSON.stringify({ NODE_ENV: 'development', SKIP_ENV_VALIDATION: 'true' }),
    },
    plugins: [
      {
        name: 'auth-postcss',
        setup(builder) {
          builder.onLoad({ filter: /\/auth\.css$/ }, async ({ path }) => {
            const result = await postcss(postcssConfig.plugins).process(
              await readFile(path, 'utf8'),
              { from: path }
            )
            return { contents: result.css, loader: 'css', resolveDir: dirname(path) }
          })
        },
      },
    ],
  })

  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    try {
      if (pathname.startsWith('/api/auth/')) {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        requests.push({ path: pathname, body })
        response.setHeader('Content-Type', 'application/json')
        if (pathname.endsWith('/public-client-prelogin')) {
          response.end(JSON.stringify({ client_id: 'codex', client_name: 'Codex' }))
        } else if (pathname.endsWith('/consent')) {
          if (rejectConsent) {
            response.statusCode = 400
            response.end(JSON.stringify({ message: 'The authorization could not be completed.' }))
          } else {
            const accepted =
              typeof body === 'object' && body !== null && 'accept' in body && body.accept === true
            response.end(JSON.stringify({ url: `/return?decision=${accepted ? 'allow' : 'deny'}` }))
          }
        } else if (pathname.endsWith('/sign-out')) {
          response.end(JSON.stringify({ success: true }))
        } else {
          response.statusCode = 404
          response.end(JSON.stringify({ message: 'Unknown fixture endpoint' }))
        }
        return
      }
      if (pathname === '/return') {
        response.setHeader('Content-Type', 'text/html')
        response.end('<!doctype html><title>Returned</title><p>Returned to the client</p>')
        return
      }
      if (pathname.endsWith('.js') || pathname.endsWith('.css') || pathname.endsWith('.woff2')) {
        assert(!pathname.includes('..'))
        const file = join(work, pathname.slice(1))
        const mime = pathname.endsWith('.js')
          ? 'text/javascript'
          : pathname.endsWith('.css')
            ? 'text/css'
            : 'font/woff2'
        response.setHeader('Content-Type', mime)
        response.end(await readFile(file))
        return
      }
      response.setHeader('Content-Type', 'text/html')
      response.end(
        '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>'
      )
    } catch (error) {
      response.statusCode = 500
      response.end(getErrorMessage(error))
    }
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  assert(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  const browser = await chromium.launch({ headless: true }).catch(async (error: unknown) => {
    await new Promise<void>((done) => server.close(() => done()))
    throw error
  })
  const context = await browser.newContext()
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
  const page = await context.newPage()
  page.on('pageerror', (error) => pageErrors.push(error.message))

  async function check(name: string, run: () => Promise<void>) {
    const started = performance.now()
    try {
      await run()
      checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) })
    } catch (error) {
      checks.push({
        name,
        status: 'failed',
        durationMs: Math.round(performance.now() - started),
        error: getErrorMessage(error),
      })
      await page
        .screenshot({ path: join(artifacts, `failure-${checks.length}.png`), fullPage: true })
        .catch(() => {})
    }
  }

  try {
    for (const width of [320, 390, 768, 1440]) {
      await check(`consent rhythm and containment at ${width}px`, async () => {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(`${origin}/consent?client_id=codex`)
        await expect(page.getByRole('heading', { name: 'Authorize Codex' })).toBeVisible()
        await page.evaluate(() => document.fonts.ready)
        const permissions = await page.getByRole('list').boundingBox()
        const destination = await page.getByText('Returns to this computer.').boundingBox()
        const allow = await page.getByRole('button', { name: 'Allow', exact: true }).boundingBox()
        assert(permissions && destination && allow)
        const gap = width < 768 ? 24 : 20
        assert(
          Math.abs(destination.y - permissions.y - permissions.height - gap) < 1,
          'Permissions and destination must retain the section gap'
        )
        assert(
          Math.abs(allow.y - destination.y - destination.height - gap) < 1,
          'Destination and actions must retain the section gap'
        )
        assert(
          allow.height >= (width < 768 ? 44 : 32),
          'Actions retain their responsive touch target'
        )
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          'No horizontal page overflow'
        )
        await page.screenshot({ path: join(artifacts, `consent-${width}.png`), fullPage: true })
      })
    }

    await check('long identity wraps without horizontal overflow', async () => {
      await page.setViewportSize({ width: 320, height: 900 })
      await page.goto(`${origin}/consent?client_id=codex&stress=1`)
      await expect(page.getByRole('button', { name: 'Allow', exact: true })).toBeVisible()
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    })

    await check('account menu dismisses and returns keyboard focus', async () => {
      await page.goto(`${origin}/consent?client_id=codex`)
      const account = page.getByRole('button', { name: /Signed in as/ })
      await account.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('menuitem', { name: 'Use another account' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(account).toBeFocused()
    })

    for (const choice of ['Allow', 'Deny'] as const) {
      await check(`${choice} submits the real OAuth client decision and returns`, async () => {
        await page.goto(`${origin}/consent?client_id=codex`)
        await page.getByRole('button', { name: choice, exact: true }).click()
        await expect(page).toHaveURL(`${origin}/return?decision=${choice.toLowerCase()}`)
        const last = requests.filter((request) => request.path.endsWith('/consent')).at(-1)
        assert(last && typeof last.body === 'object' && last.body !== null && 'accept' in last.body)
        assert.equal(last.body.accept, choice === 'Allow')
      })
    }

    await check('failed consent retains recovery actions', async () => {
      rejectConsent = true
      await page.goto(`${origin}/consent?client_id=codex`)
      await page.getByRole('button', { name: 'Allow', exact: true }).click()
      await expect(page.getByRole('alert')).toContainText(
        'The authorization could not be completed.'
      )
      await expect(page.getByRole('button', { name: 'Allow', exact: true })).toBeEnabled()
      rejectConsent = false
    })

    await check('filterable choice handles empty results, selection and dismissal', async () => {
      await page.goto(`${origin}/controls`)
      const workspace = page.getByRole('combobox', { name: 'Workspace' })
      await workspace.click()
      const search = page.getByRole('combobox', { name: 'Search' })
      await search.fill('missing option')
      await expect(page.getByText('No matching options')).toBeVisible()
      await search.fill('Design')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      await expect(workspace).toContainText('Design')
      await workspace.click()
      await expect(page.getByRole('listbox')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(workspace).toBeFocused()
      await expect(page.getByRole('listbox')).toBeHidden()
    })

    await check('select keyboard skips disabled choices', async () => {
      await page.goto(`${origin}/controls`)
      const provider = page.getByRole('combobox', { name: 'Provider' })
      await provider.focus()
      await page.keyboard.press('ArrowDown')
      await expect(page.getByRole('listbox')).toBeVisible()
      await expect(page.getByRole('option', { name: 'Google', exact: true })).toBeFocused()
      await page.keyboard.press('End')
      await expect(page.getByRole('option', { name: 'Microsoft', exact: true })).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(provider).toContainText('Microsoft')
      await expect(provider).toBeFocused()
    })

    await check('password reveal preserves input, focus paint and OTP submission', async () => {
      await page.goto(`${origin}/controls`)
      const password = page.getByLabel('Password', { exact: true })
      const before = await password.evaluate((input) => {
        const surface = input.parentElement
        if (!surface) throw new Error('Missing input surface')
        const style = getComputedStyle(surface)
        return [style.borderColor, style.boxShadow]
      })
      await password.focus()
      const focused = await password.evaluate((input) => {
        const style = getComputedStyle(input.parentElement ?? input)
        return [style.borderColor, style.boxShadow]
      })
      assert.deepEqual(focused, before)
      await page.getByRole('button', { name: 'Show password' }).click()
      await expect(password).toHaveAttribute('type', 'text')
      await expect(password).toHaveValue('fixture-password')
      await page.getByRole('textbox', { name: 'Verification code' }).fill('123456')
      await page.getByRole('button', { name: 'Verify email' }).click()
      await expect(page.getByRole('status')).toHaveText('Verification submitted')
    })

    await check('auth remains light in a dark environment', async () => {
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
      await page.goto(`${origin}/consent?client_id=codex`)
      await expect(page.locator('[data-auth-root]')).toHaveCSS('color-scheme', 'light')
      await expect(page.getByRole('heading', { name: 'Authorize Codex' })).toBeVisible()
      await page.screenshot({
        path: join(artifacts, 'consent-dark-environment.png'),
        fullPage: true,
      })
    })
    await check('browser has no unhandled runtime errors', async () =>
      assert.deepEqual(pageErrors, [])
    )
  } finally {
    await context.tracing.stop({ path: join(artifacts, 'trace.zip') })
    await browser.close()
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done()))
    )
    await writeFile(reportPath, JSON.stringify({ checks, requests, pageErrors }, null, 2))
    await rm(work, { recursive: true, force: true })
  }
  const failures = checks.filter((check) => check.status === 'failed')
  logger.info('Auth browser checks complete', {
    passed: checks.length - failures.length,
    failed: failures.length,
    reportPath,
  })
  if (failures.length) process.exitCode = 1
}

try {
  await run()
} catch (error) {
  checks.push({
    name: 'suite setup or cleanup',
    status: 'failed',
    durationMs: 0,
    error: getErrorMessage(error),
  })
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks, requests, pageErrors }, null, 2))
  await rm(work, { recursive: true, force: true })
  logger.error('Auth browser suite could not finish', { error: getErrorMessage(error), reportPath })
  process.exitCode = 1
}
