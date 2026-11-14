import { mkdtempSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'
import { recordCheck } from './check-report'

/**
 * Drives the quick chat window in the real shell against a fixture origin: where it opens, that
 * it floats with no desktop bridge, that "Open in Sim" hands the chat to a full window, that the
 * toggle hides and restores the same page, and that sign-out destroys it. Each check lands in a
 * JSON report at QUICK_CHAT_REPORT_PATH as it finishes.
 */

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))
const WORKSPACE_ROUTE = '/workspace/ws1/home'

const PAGES: Record<string, string> = {
  [WORKSPACE_ROUTE]: '<!doctype html><html><body><h1 id="app">workspace</h1></body></html>',
  '/extension/ws1': `<!doctype html><html><body><h1 id="quick">quick-chat</h1>
    <a id="open-in-sim" href="/workspace/ws1/chat/c1" target="_blank" rel="noopener">Open in Sim</a>
  </body></html>`,
  '/workspace/ws1/chat/c1':
    '<!doctype html><html><body><h1 id="chat">handed-off</h1></body></html>',
  '/login': '<!doctype html><html><body><h1 id="login">fixture-login</h1></body></html>',
}

function startFixtureServer(): Promise<{ server: Server; origin: string }> {
  return new Promise((resolvePromise) => {
    const server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      if (path === '/api/auth/sign-out') {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end('{}')
        return
      }
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

function launchApp(origin: string): Promise<ElectronApplication> {
  const userData = mkdtempSync(join(tmpdir(), 'sim-desktop-quick-chat-'))
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({ origin, lastRoute: WORKSPACE_ROUTE })
  )
  return electron.launch({
    args: ['.'],
    cwd: DESKTOP_DIR,
    env: { ...process.env, SIM_DESKTOP_ORIGIN: origin, SIM_DESKTOP_USER_DATA: userData },
  })
}

/** Clicks an application-menu item by label, the way a user choosing it from the menu bar would. */
function clickMenu(app: ElectronApplication, label: string): Promise<void> {
  return app.evaluate(({ Menu }, label) => {
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | null => {
      for (const item of items) {
        if (item.label === label) return item
        const found = item.submenu ? find(item.submenu.items) : null
        if (found) return found
      }
      return null
    }
    const item = find(Menu.getApplicationMenu()?.items ?? [])
    if (!item) throw new Error(`No menu item ${label}`)
    item.click()
  }, label)
}

/** Native state of the window showing `url`, or null once no window shows it. */
function windowState(app: ElectronApplication, url: string) {
  return app.evaluate(({ BrowserWindow }, url) => {
    const win = BrowserWindow.getAllWindows().find(
      (candidate) => !candidate.isDestroyed() && candidate.webContents.getURL() === url
    )
    return win
      ? { visible: win.isVisible(), focused: win.isFocused(), alwaysOnTop: win.isAlwaysOnTop() }
      : null
  }, url)
}

const hasBridge = (page: Page) =>
  page.evaluate(() => typeof (globalThis as { simDesktop?: unknown }).simDesktop !== 'undefined')

test.describe('quick chat window', () => {
  let server: Server
  let origin: string
  let app: ElectronApplication | undefined

  test.beforeAll(async () => {
    ;({ server, origin } = await startFixtureServer())
  })

  test.afterAll(() => {
    server.close()
  })

  test.afterEach(async () => {
    await app?.close().catch(() => {})
  })

  test('opens, hands off, toggles, and closes on sign-out', async () => {
    const reportPath =
      process.env.QUICK_CHAT_REPORT_PATH ?? test.info().outputPath('quick-chat.json')
    const check = async (name: string, body: () => Promise<void>) => {
      const started = Date.now()
      try {
        await body()
        recordCheck(reportPath, 'quick-chat', {
          name,
          status: 'passed',
          durationMs: Date.now() - started,
          retry: test.info().retry,
        })
      } catch (error) {
        recordCheck(reportPath, 'quick-chat', {
          name,
          status: 'failed',
          durationMs: Date.now() - started,
          retry: test.info().retry,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    }

    app = await launchApp(origin)
    const launched = app
    const main = await launched.firstWindow()
    await expect(main.locator('#app')).toHaveText('workspace')
    const quickUrl = `${origin}/extension/ws1`
    let quick: Page | undefined

    await check('opens the compact chat for the last workspace as a floating window', async () => {
      const opened = launched.waitForEvent('window')
      await clickMenu(launched, 'Quick Chat')
      quick = await opened
      await expect(quick.locator('#quick')).toHaveText('quick-chat')
      expect(quick.url()).toBe(quickUrl)
      await expect
        .poll(() => windowState(launched, quickUrl))
        .toMatchObject({ visible: true, alwaysOnTop: true })
    })

    await check('the floating page gets no desktop bridge while full windows keep it', async () => {
      if (!quick) throw new Error('Quick chat did not open')
      expect(await hasBridge(quick)).toBe(false)
      expect(await hasBridge(main)).toBe(true)
    })

    await check(
      'Open in Sim hands the chat to a full window and leaves the panel open',
      async () => {
        if (!quick) throw new Error('Quick chat did not open')
        const handedOff = launched.waitForEvent('window')
        await quick.locator('#open-in-sim').click()
        const full = await handedOff
        await expect(full.locator('#chat')).toHaveText('handed-off')
        expect(await hasBridge(full)).toBe(true)
        expect(await windowState(launched, quickUrl)).toMatchObject({
          visible: true,
          alwaysOnTop: true,
        })
      }
    )

    await check(
      'the toggle brings a background panel forward, then hides it, keeping the page',
      async () => {
        if (!quick) throw new Error('Quick chat did not open')
        await quick.evaluate(() => {
          ;(globalThis as { quickChatMarker?: string }).quickChatMarker = 'kept'
        })
        // The hand-off focused the full window; the app must be active for window focus to land.
        await launched.evaluate(({ app }) => app.focus({ steal: true }))
        await clickMenu(launched, 'Quick Chat')
        await expect
          .poll(() => windowState(launched, quickUrl))
          .toMatchObject({
            visible: true,
            focused: true,
          })
        await clickMenu(launched, 'Quick Chat')
        await expect.poll(() => windowState(launched, quickUrl)).toMatchObject({ visible: false })
        await clickMenu(launched, 'Quick Chat')
        await expect.poll(() => windowState(launched, quickUrl)).toMatchObject({ visible: true })
        expect(
          await quick.evaluate(() => (globalThis as { quickChatMarker?: string }).quickChatMarker)
        ).toBe('kept')
      }
    )

    await check('signing out destroys the panel with the account it belonged to', async () => {
      await clickMenu(launched, 'Sign Out')
      // Found as the only always-on-top window, not by URL: sign-out sends full windows to /login.
      await expect
        .poll(
          () =>
            launched.evaluate(({ BrowserWindow }) =>
              BrowserWindow.getAllWindows().some((win) => !win.isDestroyed() && win.isAlwaysOnTop())
            ),
          { timeout: 30_000 }
        )
        .toBe(false)
    })
  })
})
