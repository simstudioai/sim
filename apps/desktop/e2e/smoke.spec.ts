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
    await expect(window.getByRole('img', { name: 'Sim', exact: true })).toBeVisible()
    await expect(window.getByRole('img', { name: 'Sim', exact: true })).toHaveAttribute(
      'aria-label',
      'Sim'
    )
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
    await expect(window.locator('#detail')).toHaveAttribute('role', 'status')
  })

  test('recovery messages use an isolated EMCN dialog with a safe keyboard default', async () => {
    app = await launchApp('http://127.0.0.1:1')
    const window = await app.firstWindow()
    await expect(window.locator('#server')).toBeVisible()
    const dialogPromise = app.waitForEvent('window')
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.emit('unresponsive')
    })
    const prompt = await dialogPromise
    await expect(prompt.getByRole('dialog', { name: 'Sim', exact: true })).toBeVisible()
    await expect(prompt.getByText('Sim isn’t responding')).toBeVisible()
    await expect(prompt.getByRole('button', { name: 'Wait', exact: true })).toBeFocused()
    await expect
      .poll(() =>
        prompt
          .getByRole('dialog')
          .evaluate((element) => element.scrollHeight <= globalThis.innerHeight)
      )
      .toBe(true)
    await expect
      .poll(() => prompt.evaluate(() => typeof (globalThis as { simDesktop?: unknown }).simDesktop))
      .toBe('undefined')
    await prompt.screenshot({
      path: test.info().outputPath('recovery-dialog.png'),
      animations: 'disabled',
    })
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(
        (entry) => entry.webContents.getURL() === 'sim-shell://pages/dialog.html'
      )
      if (!win) throw new Error('Recovery dialog is missing')
      win.webContents.ipc.removeHandler('shell:configuration')
      win.webContents.ipc.handle('shell:configuration', () => ({
        title: 'Long recovery message',
        message: 'Recovery details',
        detail: Array.from({ length: 80 }, (_, index) => `Diagnostic detail ${index + 1}`).join(
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
    const closed = prompt.waitForEvent('close')
    await prompt
      .getByRole('button', { name: 'Wait', exact: true })
      .press('Enter')
      .catch(() => {})
    await closed
    await expect(window.locator('#server')).toBeVisible()
  })

  // The picker is the only way to repoint a shell whose server is unreachable.
  // Its page, the pre-filled value (which crosses the local-page IPC gate) and
  // Escape are asserted together because the packaged build once opened it as
  // a blank sheet with no way out.
  test('the offline server picker renders EMCN controls and handles validation and dismissal', async () => {
    const testInfo = test.info()
    app = await launchApp('http://127.0.0.1:1')
    const window = await app.firstWindow()
    await window.waitForSelector('#server', { timeout: 30_000 })

    const pickerPromise = app.waitForEvent('window')
    await window.locator('#server').click()
    const picker = await pickerPromise

    expect(picker.url()).toBe('sim-shell://pages/server.html')
    await expect(picker.getByRole('dialog', { name: 'Sim server', exact: true })).toBeVisible()
    await expect(picker.getByLabel('Server URL')).toHaveValue('http://127.0.0.1:1')
    await expect(picker.getByLabel('Server URL')).toBeFocused()
    await expect
      .poll(() =>
        picker
          .getByRole('dialog')
          .evaluate((element) => element.scrollHeight <= globalThis.innerHeight)
      )
      .toBe(true)
    await picker.getByLabel('Server URL').fill('http://example.com')
    await picker.getByLabel('Server URL').press('Enter')
    await expect(picker.getByRole('alert')).toBeVisible()
    await expect(picker.getByLabel('Server URL')).toHaveAttribute('aria-invalid', 'true')
    await picker.getByLabel('Server URL').fill('http://127.0.0.1:1')
    await expect(picker.getByRole('alert')).toHaveCount(0)
    await picker.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect(picker.getByRole('status')).toHaveText('Already connected to this server.')
    await expect
      .poll(() =>
        picker
          .locator('[data-chip-modal-body]')
          .evaluate((element) => element.scrollHeight <= element.clientHeight)
      )
      .toBe(true)
    await picker.emulateMedia({ colorScheme: 'light' })
    await picker.screenshot({
      path: testInfo.outputPath('server-modal-light.png'),
      animations: 'disabled',
    })
    await picker.emulateMedia({ colorScheme: 'dark' })
    await expect(picker.locator('html')).toHaveClass('dark')
    await picker.screenshot({
      path: testInfo.outputPath('server-modal-dark.png'),
      animations: 'disabled',
    })

    const closed = picker.waitForEvent('close')
    // The main process destroys the window on the key-down, so the key-up half
    // of `press` has no target to reach; the close event is the assertion.
    await picker.keyboard.press('Escape').catch(() => {})
    await closed
    expect(app.windows()).toHaveLength(1)
  })
})
