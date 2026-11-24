import type { ElectronApplication, Page } from '@playwright/test'
import { type DesktopBridge, expect, type FixtureServer, test } from './harness'
import { serveSignedIn } from './session-fixture'

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
  let fixture: FixtureServer
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    fixture = await serveSignedIn({
      page: `<!doctype html><title>Sim fixture</title><h1>Continue fixture</h1>
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
</script>`,
      handle: (request, response, url) => {
        if (url.pathname.startsWith('/api/') || !request.headers.host?.startsWith('localhost')) {
          return false
        }
        response.writeHead(200, { 'Content-Type': 'text/html' })
        response.end('<!doctype html><title>Sign in</title><h1>Sign in</h1>')
        return true
      },
    })
  })

  test.afterAll(async () => {
    await fixture.close()
  })

  test.beforeEach(async ({ desktop }) => {
    ;({ app } = await desktop.launch({
      origin: fixture.origin,
      main: process.env.SIM_DESKTOP_E2E_MAIN,
      env: { HOME: desktop.tempDir('sim-continue-home-') },
    }))
    page = await app.firstWindow()
    await expect(page.getByRole('heading')).toHaveText('Continue fixture')
    await page.evaluate(async (scope) => {
      const api = (globalThis as DesktopBridge).simDesktop
      await api.browserAgent.activateScope(scope)
      api.browserAgent.setPanelBounds({ x: 0, y: 120, width: 800, height: 400 }, null, scope)
    }, SCOPE)
  })

  test('advertises the capability without a browser to offer, and refuses calls without the user', async () => {
    const surface = await page.evaluate(async (scope) => {
      const api = (globalThis as DesktopBridge).simDesktop
      return {
        continueSignIn: typeof api.browserImport?.continueSignIn,
        bringSignInBack: typeof api.browserImport?.bringSignInBack,
        pending: await api.browserImport?.getPendingSignIn?.(scope),
        profiles: await api.browserImport?.listChromeProfiles(),
        // Page script calling straight in, with no user gesture behind it.
        continued: await api.browserImport?.continueSignIn?.('chrome:Default', scope),
        broughtBack: await api.browserImport?.bringSignInBack?.(scope),
      }
    }, SCOPE)

    expect(surface).toEqual({
      continueSignIn: 'function',
      bringSignInBack: 'function',
      pending: null,
      profiles: [],
      continued: { error: 'unknown' },
      broughtBack: { cookiesImported: 0, cookiesSkipped: 0, error: 'unknown' },
    })
  })

  test('reads the page from the tab itself and hands over only https', async () => {
    const read = (key: string) => page.evaluate((name) => Reflect.get(globalThis, name), key)

    await page.locator('#open').click()
    await expect.poll(() => read('opened')).toMatchObject({ activeTabId: expect.any(String) })
    await expect
      .poll(() =>
        app.evaluate(
          ({ webContents }, target) =>
            webContents.getAllWebContents().some((contents) => contents.getURL() === target),
          `${fixture.site}/login`
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
