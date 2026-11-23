import { mkdtempSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'
import type { DesktopPreferences, QuickChatShortcut } from '@sim/desktop-bridge'
import { getErrorMessage } from '@sim/utils/errors'
import { recordCheck } from './check-report'

/**
 * Drives the quick chat window in the real shell against a fixture origin: where it opens, that
 * it floats with no desktop bridge, that it resizes within its bounds, that "Open in Sim" hands
 * the chat to a full window, that the toggle hides and restores the same page, that sign-out
 * destroys it, and how its shortcut setting and load failures behave. Each check lands in a JSON
 * report at QUICK_CHAT_REPORT_PATH as it finishes.
 */

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))
const WORKSPACE_ROUTE = '/workspace/ws1/home'
const DEFAULT_SHORTCUT: QuickChatShortcut = 'Alt+Space'

const PAGES: Record<string, string> = {
  [WORKSPACE_ROUTE]: '<!doctype html><html><body><h1 id="app">workspace</h1></body></html>',
  '/extension/ws1': `<!doctype html><html><body><h1 id="quick">quick-chat</h1>
    <a id="open-in-sim" href="/workspace/ws1/chat/c1" target="_blank" rel="noopener">Open in Sim</a>
  </body></html>`,
  '/workspace/ws1/chat/c1':
    '<!doctype html><html><body><h1 id="chat">handed-off</h1></body></html>',
  '/login': '<!doctype html><html><body><h1 id="login">fixture-login</h1></body></html>',
}

interface FixtureServer {
  server: Server
  origin: string
  /** Drops every connection for `path`, so its loads fail, until `failing` is turned off again. */
  setFailing: (path: string, failing: boolean) => void
}

function startFixtureServer(): Promise<FixtureServer> {
  const failing = new Set<string>()
  return new Promise((resolvePromise) => {
    const server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      if (failing.has(path)) {
        request.socket.destroy()
        return
      }
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
      resolvePromise({
        server,
        origin: `http://127.0.0.1:${port}`,
        setFailing: (path, on) => {
          if (on) failing.add(path)
          else failing.delete(path)
        },
      })
    })
  })
}

function launchApp(origin: string, settings: string | Record<string, unknown> = {}) {
  const userData = mkdtempSync(join(tmpdir(), 'sim-desktop-quick-chat-'))
  writeFileSync(
    join(userData, 'settings.json'),
    typeof settings === 'string'
      ? settings
      : JSON.stringify({ origin, lastRoute: WORKSPACE_ROUTE, ...settings })
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
      ? {
          visible: win.isVisible(),
          focused: win.isFocused(),
          alwaysOnTop: win.isAlwaysOnTop(),
          size: win.getSize(),
        }
      : null
  }, url)
}

/** Resizes the window showing `url` the way dragging its edge would. */
function resizeWindow(app: ElectronApplication, url: string, width: number, height: number) {
  return app.evaluate(
    ({ BrowserWindow }, { url, width, height }) => {
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL() === url)
        ?.setSize(width, height)
    },
    { url, width, height }
  )
}

const hasBridge = (page: Page) =>
  page.evaluate(() => typeof (globalThis as { simDesktop?: unknown }).simDesktop !== 'undefined')

/** Changes the shortcut through the settings bridge, as the desktop settings page does. */
const setShortcut = (page: Page, shortcut: string | null) =>
  page.evaluate(
    (value) =>
      (
        globalThis as unknown as {
          simDesktop: {
            settings: { setQuickChatShortcut(v: unknown): Promise<DesktopPreferences> }
          }
        }
      ).simDesktop.settings.setQuickChatShortcut(value),
    shortcut
  )

const isRegistered = (app: ElectronApplication, shortcut: string) =>
  app.evaluate(({ globalShortcut }, value) => globalShortcut.isRegistered(value), shortcut)

/** Runs one named check and records its outcome as soon as it is known. */
async function check(name: string, body: () => Promise<void>) {
  const reportPath = process.env.QUICK_CHAT_REPORT_PATH ?? test.info().outputPath('quick-chat.json')
  const started = Date.now()
  const record = (status: 'passed' | 'failed', error?: unknown) =>
    recordCheck(reportPath, 'quick-chat', {
      name,
      status,
      durationMs: Date.now() - started,
      retry: test.info().retry,
      ...(error === undefined ? {} : { error: getErrorMessage(error) }),
    })
  try {
    await body()
    record('passed')
  } catch (error) {
    record('failed', error)
    throw error
  }
}

test.describe('quick chat window', () => {
  let fixture: FixtureServer
  let app: ElectronApplication | undefined

  test.beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  test.afterAll(() => {
    fixture.server.close()
  })

  test.afterEach(async () => {
    await app?.close().catch(() => {})
  })

  test('opens, resizes, hands off, toggles, and closes on sign-out', async () => {
    const launched = await launchApp(fixture.origin)
    app = launched
    const main = await launched.firstWindow()
    await expect(main.locator('#app')).toHaveText('workspace')
    const quickUrl = `${fixture.origin}/extension/ws1`
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

    await check('resizing holds the minimum size and the page follows the window', async () => {
      if (!quick) throw new Error('Quick chat did not open')
      const page = quick
      await resizeWindow(launched, quickUrl, 200, 200)
      await expect.poll(() => windowState(launched, quickUrl)).toMatchObject({ size: [360, 420] })
      // Small enough for any runner display; macOS clamps a window to the screen it is on.
      await resizeWindow(launched, quickUrl, 600, 560)
      await expect.poll(() => windowState(launched, quickUrl)).toMatchObject({ size: [600, 560] })
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(600)
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
          .toMatchObject({ visible: true, focused: true })
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

  test('the shortcut setting and a failed first load', async () => {
    test.skip(process.platform !== 'darwin', 'Only macOS binds a shortcut by default')
    const launched = await launchApp(fixture.origin, { quickChatShortcut: 'CommandOrControl+Q' })
    app = launched
    const main = await launched.firstWindow()
    await expect(main.locator('#app')).toHaveText('workspace')

    await check('a stored shortcut outside the presets falls back to the default', async () => {
      const preferences = await main.evaluate(() =>
        (
          globalThis as unknown as {
            simDesktop: { settings: { getPreferences(): Promise<DesktopPreferences> } }
          }
        ).simDesktop.settings.getPreferences()
      )
      expect(preferences).toMatchObject({
        quickChatShortcut: DEFAULT_SHORTCUT,
        quickChatShortcutAvailable: true,
      })
      expect(await isRegistered(launched, DEFAULT_SHORTCUT)).toBe(true)
      expect(await isRegistered(launched, 'CommandOrControl+Q')).toBe(false)
    })

    await check('choosing another shortcut releases the old one and binds the new', async () => {
      const next: QuickChatShortcut = 'CommandOrControl+Shift+Space'
      expect(await setShortcut(main, next)).toMatchObject({
        quickChatShortcut: next,
        quickChatShortcutAvailable: true,
      })
      expect(await isRegistered(launched, next)).toBe(true)
      expect(await isRegistered(launched, DEFAULT_SHORTCUT)).toBe(false)
    })

    await check(
      'turning it off releases the shortcut and refuses values off the list',
      async () => {
        expect(await setShortcut(main, null)).toMatchObject({
          quickChatShortcut: null,
          quickChatShortcutAvailable: true,
        })
        expect(await isRegistered(launched, 'CommandOrControl+Shift+Space')).toBe(false)
        expect(await setShortcut(main, 'CommandOrControl+Q')).toMatchObject({
          quickChatShortcut: null,
        })
        expect(await isRegistered(launched, 'CommandOrControl+Q')).toBe(false)
      }
    )

    await check('a failed first load reloads when the panel is shown again', async () => {
      fixture.setFailing('/extension/ws1', true)
      const opened = launched.waitForEvent('window')
      await clickMenu(launched, 'Quick Chat')
      const quick = await opened
      await quick.waitForLoadState().catch(() => {})
      expect(await quick.locator('#quick').count()).toBe(0)
      fixture.setFailing('/extension/ws1', false)
      await launched.evaluate(({ app }) => app.focus({ steal: true }))
      // Pressing the shortcut either hides a focused panel or shows it again; each show after the
      // failure reloads, so a few presses must land on the loaded page.
      await expect
        .poll(
          async () => {
            if ((await quick.locator('#quick').count()) > 0) return true
            await clickMenu(launched, 'Quick Chat')
            return false
          },
          { intervals: [1_000], timeout: 15_000 }
        )
        .toBe(true)
      await expect(quick.locator('#quick')).toHaveText('quick-chat')
    })
  })

  test('stays closed while account data cannot be stored', async () => {
    // An unreadable settings file blocks persistence, which makes account data unavailable.
    const launched = await launchApp(fixture.origin, '[]')
    app = launched
    await launched.firstWindow()
    await check(
      'the shortcut opens nothing while the window could not hold an account',
      async () => {
        await clickMenu(launched, 'Quick Chat')
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_500))
        expect(
          await launched.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().some((win) => !win.isDestroyed() && win.isAlwaysOnTop())
          )
        ).toBe(false)
      }
    )
  })
})
