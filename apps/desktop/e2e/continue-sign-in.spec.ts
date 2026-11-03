import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test'
import type { SimDesktopApi } from '@sim/desktop-bridge'
import { recordCheck } from './check-report'

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))
const SCOPE = 'continue-sign-in-fixture'

/**
 * "Continue in Chrome" through the real preload, IPC table, and browser session.
 *
 * The shell runs with an empty home directory, so no browser profile exists and
 * nothing here can launch the developer's browser or reach their Keychain. That
 * is also the unsupported case the web app must hide the feature for. The
 * import-back half against a real Chrome profile needs a Keychain item and is
 * covered by the importer's fixture-database tests instead.
 */
test.describe('continue a sign-in in another browser', () => {
  let server: Server
  let origin: string
  let site: string
  let home: string
  let userData: string
  let app: ElectronApplication | undefined

  test.beforeAll(async () => {
    server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname
      if (path === '/api/auth/get-session') {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({ user: { id: 'fixture-user' }, session: { id: 'fixture-session' } })
        )
        return
      }
      if (path.startsWith('/api/')) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end('{}')
        return
      }
      if (request.headers.host?.startsWith('localhost')) {
        response.writeHead(200, { 'Content-Type': 'text/html' })
        response.end('<!doctype html><title>Sign in</title><h1>Sign in</h1>')
        return
      }
      response.writeHead(200, {
        'Content-Type': 'text/html',
        'Set-Cookie': 'better-auth.session_token=fixture; HttpOnly; SameSite=Lax; Path=/',
      })
      response.end(`<!doctype html><title>Sim fixture</title><h1>Continue fixture</h1>
<button id="open">Open</button><button id="continue">Continue</button><button id="back">Back</button>
<script>
  const api = globalThis.simDesktop
  const scope = ${JSON.stringify(SCOPE)}
  const record = (key) => (value) => { globalThis[key] = value }
  document.getElementById('open').onclick = () =>
    api.browserAgent.openUrl(location.origin.replace('127.0.0.1', 'localhost') + '/login', scope)
      .then(record('opened'))
  document.getElementById('continue').onclick = () =>
    api.browserImport.continueSignIn('chrome:Default', scope).then(record('continued'))
  document.getElementById('back').onclick = () =>
    api.browserImport.bringSignInBack(scope).then(record('broughtBack'))
</script>`)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    origin = `http://127.0.0.1:${address.port}`
    site = `http://localhost:${address.port}`
  })

  test.beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'sim-continue-home-'))
    userData = mkdtempSync(join(tmpdir(), 'sim-continue-e2e-'))
    app = await electron.launch({
      args: [process.env.SIM_DESKTOP_E2E_MAIN ?? '.'],
      cwd: DESKTOP_DIR,
      env: {
        ...process.env,
        HOME: home,
        SIM_DESKTOP_ORIGIN: origin,
        SIM_DESKTOP_USER_DATA: userData,
      },
    })
    const page = await app.firstWindow()
    await expect(page.getByRole('heading')).toHaveText('Continue fixture')
    await page.evaluate(async (scope) => {
      const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
      await api.browserAgent.activateScope(scope)
      api.browserAgent.setPanelBounds({ x: 0, y: 120, width: 800, height: 400 }, null, scope)
    }, SCOPE)
  })

  test.afterEach(async () => {
    const testInfo = test.info()
    recordCheck(process.env.CONTINUE_SIGN_IN_REPORT_PATH, 'continue-sign-in', {
      name: testInfo.title,
      status: testInfo.status ?? 'unknown',
      durationMs: testInfo.duration,
      retry: testInfo.retry,
    })
    await app?.close()
    app = undefined
    rmSync(userData, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  test.afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  })

  test('advertises the capability, but offers no browser when none is installed', async () => {
    const page = await app?.firstWindow()
    const surface = await page?.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
      return {
        continueSignIn: typeof api.browserImport?.continueSignIn,
        bringSignInBack: typeof api.browserImport?.bringSignInBack,
        pending: await api.browserImport?.getPendingSignIn?.('continue-sign-in-fixture'),
        profiles: await api.browserImport?.listChromeProfiles(),
      }
    })

    expect(surface).toEqual({
      continueSignIn: 'function',
      bringSignInBack: 'function',
      pending: null,
      profiles: [],
    })
  })

  test('refuses page script that acts without the user', async () => {
    const page = await app?.firstWindow()
    const results = await page?.evaluate(async (scope) => {
      const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
      return {
        continued: await api.browserImport?.continueSignIn?.('chrome:Default', scope),
        broughtBack: await api.browserImport?.bringSignInBack?.(scope),
      }
    }, SCOPE)

    expect(results).toEqual({
      continued: { error: 'unknown' },
      broughtBack: { cookiesImported: 0, cookiesSkipped: 0, error: 'unknown' },
    })
  })

  test('reads the page from the tab itself and hands over only https', async () => {
    const page = await app?.firstWindow()
    if (!page || !app) throw new Error('App did not launch')
    const read = (key: string) => page.evaluate((name) => Reflect.get(globalThis, name), key)

    await page.locator('#open').click()
    await expect.poll(() => read('opened')).toMatchObject({ activeTabId: expect.any(String) })
    await expect
      .poll(() =>
        app?.evaluate(
          ({ webContents }, target) =>
            webContents.getAllWebContents().some((contents) => contents.getURL() === target),
          `${site}/login`
        )
      )
      .toBe(true)

    await page.locator('#continue').click()
    await expect.poll(() => read('continued')).toEqual({ error: 'unsupported-page' })

    await page.locator('#back').click()
    await expect
      .poll(() => read('broughtBack'))
      .toEqual({ cookiesImported: 0, cookiesSkipped: 0, error: 'unknown' })
  })
})
