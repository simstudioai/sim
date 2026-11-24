import type { ElectronApplication, Page } from '@playwright/test'
import { getErrorMessage } from '@sim/utils/errors'
import { expect, type FixtureServer, serve, test } from './harness'

const OFFLINE_ORIGIN = 'http://127.0.0.1:1'

const PAGES: Record<string, string> = {
  '/home': `<!doctype html><html><head><title>Sim Fixture</title></head><body>
    <h1 id="app">fixture-app</h1>
    <button id="internal-blank" onclick="window.open('/workspace/two', '_blank')">internal</button>
    <button id="external-blank" onclick="window.open('https://docs.sim.ai/x', '_blank')">external</button>
    <button id="mcp-popup" onclick="window.open('/mcp', 'mcp-oauth-fixture')">mcp</button>
    <button id="external-navigate" onclick="location.href='https://docs.sim.ai/navigation'">navigate</button>
  </body></html>`,
  '/workspace/two': '<!doctype html><html><body><h1 id="two">second-route</h1></body></html>',
  '/login': '<!doctype html><html><body><h1 id="login">fixture-login</h1></body></html>',
}

/** `User-Agent` of every request the fixture origin has served, in arrival order. */
const requestUserAgents: string[] = []

/** Runs an action that closes `page`, tolerating only the error from the page closing under it. */
async function closeWith(page: Page, action: () => Promise<void>): Promise<void> {
  const closed = page.waitForEvent('close')
  await action().catch((error: unknown) => {
    if (!getErrorMessage(error).includes('Target page, context or browser has been closed')) {
      throw error
    }
  })
  await closed
}

/** Replaces `shell.openExternal` with a recorder, read back by `openedExternally`. */
async function recordExternalOpens(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { __openedExternal?: string[] }).__openedExternal = opened
    shell.openExternal = async (url: string) => {
      opened.push(url)
    }
  })
}

function openedExternally(app: ElectronApplication): Promise<string[] | undefined> {
  return app.evaluate(() => (globalThis as { __openedExternal?: string[] }).__openedExternal)
}

function dialogFits(page: Page): Promise<boolean> {
  return page
    .getByRole('dialog')
    .evaluate((element) => element.scrollHeight <= globalThis.innerHeight)
}

test.describe('desktop shell smoke', () => {
  let fixture: FixtureServer

  test.beforeAll(async () => {
    fixture = await serve((request, response, url) => {
      requestUserAgents.push(request.headers['user-agent'] ?? '')
      const sessionCookie = request.headers.cookie
        ?.split(';')
        .map((cookie) => cookie.trim())
        .includes('sim-e2e-session=shared')
      const body =
        url.pathname === '/mcp'
          ? sessionCookie
            ? '<!doctype html><html><body><h1 id="mcp">oauth-popup</h1></body></html>'
            : '<!doctype html><html><body><h1 id="unauthorized">sign-in-required</h1></body></html>'
          : PAGES[url.pathname]
      if (!body) {
        response.writeHead(404, { 'Content-Type': 'text/html' }).end('<h1>not found</h1>')
        return
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(body)
    })
  })

  test.afterAll(async () => {
    await fixture.close()
  })

  test('loads the configured origin top-level with one stock Chrome user agent on every request', async ({
    desktop,
  }) => {
    requestUserAgents.length = 0
    const { app } = await desktop.launch({ origin: fixture.origin })
    const window = await app.firstWindow()
    await expect(window.locator('#app')).toHaveText('fixture-app')
    expect(window.url()).toBe(`${fixture.origin}/home`)
    await window.evaluate(() => fetch('/home').then((response) => response.text()))

    const pageUserAgent = await window.evaluate(() => navigator.userAgent)
    expect(pageUserAgent).toMatch(
      /^Mozilla\/5\.0 \(.+\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/
    )
    expect(requestUserAgents.length).toBeGreaterThanOrEqual(2)
    expect(new Set(requestUserAgents)).toEqual(new Set([pageUserAgent]))
  })

  test('internal window.open creates an independent full Sim window', async ({ desktop }) => {
    const { app } = await desktop.launch({ origin: fixture.origin })
    const window = await app.firstWindow()
    const newWindowPromise = app.waitForEvent('window')
    await window.locator('#internal-blank').click()
    const secondWindow = await newWindowPromise
    await expect(secondWindow.locator('#two')).toHaveText('second-route')
    await expect(window.locator('#app')).toHaveText('fixture-app')
    expect(app.windows()).toHaveLength(2)
  })

  test('other origins open in the system browser, never in an app window or the app document', async ({
    desktop,
  }) => {
    const { app } = await desktop.launch({ origin: fixture.origin })
    const window = await app.firstWindow()
    await expect(window.locator('#app')).toHaveText('fixture-app')
    await recordExternalOpens(app)

    await test.step('window.open to another origin', async () => {
      await window.locator('#external-blank').click()
      await expect.poll(() => openedExternally(app)).toEqual(['https://docs.sim.ai/x'])
      expect(app.windows()).toHaveLength(1)
      await expect(window.locator('#app')).toHaveText('fixture-app')
    })

    await test.step('same-window navigation to another origin', async () => {
      await window.locator('#external-navigate').click({ noWaitAfter: true })
      await expect
        .poll(() => openedExternally(app))
        .toEqual(['https://docs.sim.ai/x', 'https://docs.sim.ai/navigation'])
      expect(window.url()).toBe(`${fixture.origin}/home`)
      await expect(window.locator('#app')).toHaveText('fixture-app')
    })
  })

  test('OAuth popups share the session without inheriting the privileged preload', async ({
    desktop,
  }) => {
    const { app } = await desktop.launch({ origin: fixture.origin })
    const window = await app.firstWindow()
    await window.waitForURL(`${fixture.origin}/home`, { waitUntil: 'load' })
    await window.evaluate(() => {
      document.cookie = 'sim-e2e-session=shared; Path=/; SameSite=Lax'
    })
    const popupPromise = app.waitForEvent('window')
    await window.locator('#mcp-popup').click()
    const popup = await popupPromise

    await expect(popup.locator('#mcp')).toHaveText('oauth-popup')
    await expect
      .poll(() => popup.evaluate(() => typeof (globalThis as { simDesktop?: unknown }).simDesktop))
      .toBe('undefined')
  })

  test('unreachable origin shows the bundled offline page', async ({ desktop }) => {
    const { app } = await desktop.launch({ origin: OFFLINE_ORIGIN })
    const window = await app.firstWindow()
    await expect(window.locator('#retry')).toBeVisible({ timeout: 30_000 })
    expect(window.url()).toMatch(/^sim-shell:\/\/pages\/offline\.html\?/)
    const home = window.getByRole('link', { name: 'Home', exact: true })
    await expect(home).toBeVisible()
    await expect(home).toHaveAttribute('href', 'https://sim.ai')
    await expect(window.locator('#title')).toHaveText('Can’t connect to Sim')
    // The real preload bridge must retain server recovery while hiding cloud-only status.
    await expect(window.locator('#server')).toBeVisible()
    await expect(window.locator('#status')).toBeHidden()
    await expect
      .poll(() =>
        window.evaluate(async () => {
          const fonts = await document.fonts.load('14px "Sim Auth Geist"')
          return fonts.length > 0 && fonts.every((font) => font.status === 'loaded')
        })
      )
      .toBe(true)
    await expect(window.locator('#detail')).toHaveAttribute('role', 'status')
  })

  test('offline title-bar geometry follows native fullscreen state across reloads', async ({
    desktop,
  }) => {
    test.skip(process.platform !== 'darwin', 'The traffic-light lane is macOS-specific')
    const { app } = await desktop.launch({ origin: OFFLINE_ORIGIN })
    const window = await app.firstWindow()
    await expect(window.locator('#server')).toBeVisible()
    await expect(window.locator('html')).toHaveAttribute('data-sim-desktop-title-bar', 'inset')
    const titlebar = window.locator('[data-auth-titlebar]')
    await expect
      .poll(() => titlebar.evaluate((element) => element.getBoundingClientRect().height))
      .toBeGreaterThanOrEqual(38)
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setFullScreen(true)
    })
    await expect(window.locator('html')).toHaveAttribute('data-sim-desktop-title-bar', 'fullscreen')
    await window.reload()
    await expect(window.locator('#server')).toBeVisible()
    await expect(window.locator('html')).toHaveAttribute('data-sim-desktop-title-bar', 'fullscreen')
    await expect(titlebar).toHaveCSS('height', '0px')
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setFullScreen(false)
    })
    await expect(window.locator('html')).toHaveAttribute('data-sim-desktop-title-bar', 'inset')
    await expect
      .poll(() => titlebar.evaluate((element) => element.getBoundingClientRect().height))
      .toBeGreaterThanOrEqual(38)
  })

  test('the hang recovery dialog is an isolated, app-themed EMCN dialog that defaults to Wait', async ({
    desktop,
  }) => {
    const { app } = await desktop.launch({ origin: fixture.origin })
    const window = await app.firstWindow()
    await expect(window.locator('#app')).toBeVisible()
    await app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = 'light'
    })
    await window.evaluate(() => {
      document.documentElement.className = 'dark'
      ;(globalThis as { __sameDocument?: boolean }).__sameDocument = true
    })
    const dialogPromise = app.waitForEvent('window')
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.emit('unresponsive')
    })
    const prompt = await dialogPromise

    await test.step('isolated dialog with Wait focused', async () => {
      await expect(
        prompt.getByRole('dialog', { name: 'Sim isn’t responding', exact: true })
      ).toBeVisible()
      await expect(prompt.getByRole('button', { name: 'Wait', exact: true })).toBeFocused()
      await expect.poll(() => dialogFits(prompt)).toBe(true)
      await expect
        .poll(() =>
          prompt.evaluate(() => typeof (globalThis as { simDesktop?: unknown }).simDesktop)
        )
        .toBe('undefined')
    })

    await test.step('follows the app theme, not the system theme', async () => {
      await expect(prompt.locator('html')).toHaveClass('dark')
      await expect(prompt.locator('html')).toHaveCSS('color-scheme', 'dark')
      await expect(prompt.locator('#dialog-message')).toHaveCSS('-webkit-font-smoothing', 'auto')
      await expect(prompt.locator('#dialog-message')).toHaveCSS('font-weight', '400')
      await expect(prompt.locator('#dialog-message')).toHaveCSS('font-size', '14px')
      await window.evaluate(() => {
        document.documentElement.className = 'light'
      })
      await expect(prompt.locator('html')).toHaveClass('light')
      await expect(prompt.locator('html')).toHaveCSS('color-scheme', 'light')
    })

    await test.step('a long message keeps every button reachable', async () => {
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find(
          (entry) => entry.webContents.getURL() === 'sim-shell://pages/dialog.html'
        )
        if (!win) throw new Error('Recovery dialog is missing')
        win.webContents.ipc.removeHandler('shell:configuration')
        win.webContents.ipc.handle('shell:configuration', () => ({
          title: 'Long recovery message',
          text: Array.from({ length: 80 }, (_, index) => `Diagnostic detail ${index + 1}`).join(
            '\n'
          ),
          type: 'warning',
          buttons: ['Wait', 'Reload'],
          defaultId: 0,
          cancelId: 0,
        }))
        win.webContents.reload()
      })
      await expect(
        prompt.getByRole('dialog', { name: 'Long recovery message', exact: true })
      ).toBeVisible()
      await expect(prompt.getByRole('button', { name: 'Reload', exact: true })).toBeInViewport()
      await expect(prompt.getByRole('button', { name: 'Wait', exact: true })).toBeFocused()
    })

    await test.step('Enter waits instead of reloading', async () => {
      await closeWith(prompt, () =>
        prompt.getByRole('button', { name: 'Wait', exact: true }).press('Enter')
      )
      await expect(window.locator('#app')).toBeVisible()
      expect(
        await window.evaluate(() => (globalThis as { __sameDocument?: boolean }).__sameDocument)
      ).toBe(true)
    })
  })

  // The picker is the only way to repoint a shell whose server is unreachable.
  // Its page, the pre-filled value (which crosses the local-page IPC gate) and
  // Escape are asserted together because the packaged build once opened it as
  // a blank sheet with no way out.
  test('the offline server picker handles validation and dismissal', async ({ desktop }) => {
    const { app } = await desktop.launch({ origin: OFFLINE_ORIGIN })
    const window = await app.firstWindow()
    await expect(window.locator('#server')).toBeVisible({ timeout: 30_000 })

    const pickerPromise = app.waitForEvent('window')
    await window.locator('#server').click()
    const picker = await pickerPromise
    const serverUrl = picker.getByLabel('Server URL')

    await expect(picker).toHaveURL('sim-shell://pages/server.html')
    await expect(picker.getByRole('dialog', { name: 'Sim server', exact: true })).toBeVisible()
    await expect(serverUrl).toHaveValue(OFFLINE_ORIGIN)
    await expect(serverUrl).toBeFocused()
    await expect.poll(() => dialogFits(picker)).toBe(true)

    await serverUrl.fill('http://example.com')
    await serverUrl.press('Enter')
    await expect(picker.locator('#server-origin-errors')).toBeVisible()
    await expect(serverUrl).toHaveAccessibleDescription(/Server URL must use HTTPS/)
    await expect(serverUrl).toHaveAttribute('aria-invalid', 'true')
    await serverUrl.fill(OFFLINE_ORIGIN)
    await expect(picker.locator('#server-origin-errors')).toHaveCount(0)
    await expect(serverUrl).not.toHaveAttribute('aria-invalid', 'true')
    await picker.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect(picker.getByRole('status')).toHaveText('Already connected to this server.')
    await expect.poll(() => dialogFits(picker)).toBe(true)

    // The picker follows the app's theme, not the system's.
    await picker.emulateMedia({ colorScheme: 'dark' })
    await expect(picker.locator('[data-auth-root]')).toHaveCSS('color-scheme', 'light')

    await closeWith(picker, () => picker.keyboard.press('Escape'))
    expect(app.windows()).toHaveLength(1)
  })
})
