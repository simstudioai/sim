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
  '/workspace': `<!doctype html><html><head><title>Sim Fixture</title></head><body>
    <h1 id="app">fixture-app</h1>
    <button id="internal-blank" onclick="window.open('/workspace/two', '_blank')">internal</button>
    <button id="external-blank" onclick="window.open('https://docs.sim.ai/x', '_blank')">external</button>
  </body></html>`,
  '/workspace/two': '<!doctype html><html><body><h1 id="two">second-route</h1></body></html>',
  '/login': '<!doctype html><html><body><h1 id="login">fixture-login</h1></body></html>',
}

function startFixtureServer(): Promise<{ server: Server; origin: string }> {
  return new Promise((resolvePromise) => {
    const server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      const body = PAGES[path]
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
    expect(window.url()).toBe(`${origin}/workspace`)
  })

  test('internal window.open collapses into the main window (single-window policy)', async () => {
    app = await launchApp(origin)
    const window = await app.firstWindow()
    await window.locator('#internal-blank').click()
    await expect(window.locator('#two')).toHaveText('second-route')
    expect(app.windows()).toHaveLength(1)
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

  test('unreachable origin shows the bundled offline page', async () => {
    app = await launchApp('http://127.0.0.1:1')
    const window = await app.firstWindow()
    await window.waitForSelector('#retry', { timeout: 30_000 })
    expect(window.url().startsWith('file:')).toBe(true)
  })
})
