import { mkdtempSync } from 'node:fs'
import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ElectronApplication } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))

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

function startFixtureServer(): Promise<{ server: Server; origin: string }> {
  return new Promise((resolvePromise) => {
    const server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      const sessionCookie = request.headers.cookie
        ?.split(';')
        .map((cookie) => cookie.trim())
        .includes('sim-e2e-session=shared')
      const body =
        path === '/mcp'
          ? sessionCookie
            ? '<!doctype html><html><body><h1 id="mcp">oauth-popup</h1></body></html>'
            : '<!doctype html><html><body><h1 id="unauthorized">sign-in-required</h1></body></html>'
          : PAGES[path]
      if (!body) {
        response.writeHead(404, { 'Content-Type': 'text/html' }).end('<h1>not found</h1>')
        return
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(body)
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolvePromise({ server, origin: `http://127.0.0.1:${port}` })
    })
  })
}

async function launchApp(origin: string): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    cwd: DESKTOP_DIR,
    env: {
      ...process.env,
      SIM_DESKTOP_ORIGIN: origin,
      SIM_DESKTOP_USER_DATA: mkdtempSync(join(tmpdir(), 'sim-desktop-e2e-')),
    },
  })
}

test.describe('desktop shell smoke', () => {
  let server: Server
  let origin: string
  let app: ElectronApplication

  test.beforeAll(async () => {
    ;({ server, origin } = await startFixtureServer())
  })

  test.afterAll(async () => {
    server.close()
  })

  test.afterEach(async () => {
    await app?.close().catch(() => {})
  })

  test('loads the configured origin top-level', async () => {
    app = await launchApp(origin)
    const window = await app.firstWindow()
    await expect(window.locator('#app')).toHaveText('fixture-app')
    expect(window.url()).toBe(`${origin}/home`)
  })

  test('internal window.open creates an independent full Sim window', async () => {
    app = await launchApp(origin)
    const window = await app.firstWindow()
    const newWindowPromise = app.waitForEvent('window')
    await window.locator('#internal-blank').click()
    const secondWindow = await newWindowPromise
    await expect(secondWindow.locator('#two')).toHaveText('second-route')
    await expect(window.locator('#app')).toHaveText('fixture-app')
    expect(app.windows()).toHaveLength(2)
  })

  test('external window.open goes to the system browser, never a new app window', async () => {
    app = await launchApp(origin)
    const window = await app.firstWindow()
    await app.evaluate(({ shell }) => {
      const opened: string[] = []
      ;(globalThis as { __openedExternal?: string[] }).__openedExternal = opened
      shell.openExternal = async (url: string) => {
        opened.push(url)
      }
    })
    await window.locator('#external-blank').click()
    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as { __openedExternal?: string[] }).__openedExternal)
      )
      .toEqual(['https://docs.sim.ai/x'])
    expect(app.windows()).toHaveLength(1)
    await expect(window.locator('#app')).toHaveText('fixture-app')
  })

  test('OAuth popups share the session without inheriting the privileged preload', async () => {
    app = await launchApp(origin)
    const window = await app.firstWindow()
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

  test('cross-origin same-window navigation opens externally and preserves the app document', async () => {
    app = await launchApp(origin)
    const window = await app.firstWindow()
    await app.evaluate(({ shell }) => {
      const opened: string[] = []
      ;(globalThis as { __openedExternal?: string[] }).__openedExternal = opened
      shell.openExternal = async (url: string) => {
        opened.push(url)
      }
    })

    await window.locator('#external-navigate').click({ noWaitAfter: true })

    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as { __openedExternal?: string[] }).__openedExternal)
      )
      .toEqual(['https://docs.sim.ai/navigation'])
    expect(window.url()).toBe(`${origin}/home`)
  })

  test('unreachable origin shows the bundled offline page', async () => {
    app = await launchApp('http://127.0.0.1:1')
    const window = await app.firstWindow()
    await window.waitForSelector('#retry', { timeout: 30_000 })
    expect(window.url()).toMatch(/^sim-shell:\/\/pages\/offline\.html\?/)
    await expect(window.locator('.wordmark')).toBeVisible()
    await expect(window.locator('.wordmark')).toHaveAttribute('aria-label', 'Sim')
    await expect(window.locator('#title')).toHaveText('Can’t connect to Sim')
    // The recovery path for a self-hosted shell pointed at a server it cannot
    // reach. Exercised end to end here because it is the only coverage of the
    // `server:` local-page IPC gate: the bundled page reads the configuration
    // over the real preload bridge, and status.sim.ai is withheld because this
    // origin is not one of Sim's own. `toBeHidden` is load-bearing — the page's
    // own `button { display: inline-flex }` outranks the UA `[hidden]` rule, so
    // the attribute alone does not hide it.
    await expect(window.locator('#server')).toBeVisible()
    await expect(window.locator('#status')).toBeHidden()
    await expect
      .poll(() => window.evaluate(() => document.fonts.check('16px "Season Sans"')))
      .toBe(true)
    await expect(window.locator('#retry')).toHaveCSS('height', '30px')
    await expect(window.locator('#retry')).toHaveCSS('border-radius', '8px')
    await expect(window.locator('#retry')).toHaveCSS('padding-left', '8px')
    await expect(window.locator('#retry')).toHaveCSS('font-size', '14px')
    await expect(window.locator('#retry')).toHaveCSS('line-height', '20px')
    await expect(window.locator('#retry')).toHaveCSS('text-align', 'left')
    await window.locator('#retry').focus()
    await expect(window.locator('#retry')).toHaveCSS('outline-style', 'solid')
    await expect(window.locator('#detail')).toHaveAttribute('role', 'status')
  })

  // The picker is the only way to repoint a shell whose server is unreachable.
  // Its page, the pre-filled value (which crosses the local-page IPC gate) and
  // Escape are asserted together because the packaged build once opened it as
  // a blank sheet with no way out.
  test('the offline page opens the server picker, pre-filled, and Escape closes it', async () => {
    app = await launchApp('http://127.0.0.1:1')
    const window = await app.firstWindow()
    await window.waitForSelector('#server', { timeout: 30_000 })

    const pickerPromise = app.waitForEvent('window')
    await window.locator('#server').click()
    const picker = await pickerPromise

    expect(picker.url()).toBe('sim-shell://pages/server.html')
    await expect(picker.locator('h1')).toHaveText('Sim server')
    await expect(picker.locator('#origin')).toHaveValue('http://127.0.0.1:1')

    const closed = picker.waitForEvent('close')
    // The main process destroys the window on the key-down, so the key-up half
    // of `press` has no target to reach; the close event is the assertion.
    await picker.keyboard.press('Escape').catch(() => {})
    await closed
    expect(app.windows()).toHaveLength(1)
  })
})
