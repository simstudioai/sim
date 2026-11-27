import type { ElectronApplication, Page } from '@playwright/test'
import type { DesktopPreferences, QuickChatShortcut } from '@sim/desktop-bridge'
import { type DesktopBridge, expect, type FixtureServer, serve, test } from './harness'

/**
 * Drives the quick chat window in the real shell against a fixture origin: where it opens, that
 * it floats with no desktop bridge, that it resizes within its bounds, that "Open in Sim" hands
 * the chat to a full window, that the toggle hides and restores the same page, that sign-out
 * destroys it, and how its shortcut setting and load failures behave.
 */

const WORKSPACE_ROUTE = '/workspace/ws1/home'
const QUICK_ROUTE = '/extension/ws1'
const DEFAULT_SHORTCUT: QuickChatShortcut = 'Alt+Space'

const PAGES: Record<string, string> = {
  [WORKSPACE_ROUTE]: '<!doctype html><html><body><h1 id="app">workspace</h1></body></html>',
  [QUICK_ROUTE]: `<!doctype html><html><body><h1 id="quick">quick-chat</h1>
    <a id="open-in-sim" href="/workspace/ws1/chat/c1" target="_blank" rel="noopener">Open in Sim</a>
  </body></html>`,
  '/workspace/ws1/chat/c1':
    '<!doctype html><html><body><h1 id="chat">handed-off</h1></body></html>',
  '/login': '<!doctype html><html><body><h1 id="login">fixture-login</h1></body></html>',
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

/** Whether a floating (always-on-top) window exists; full windows never float. */
function hasFloatingWindow(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((win) => !win.isDestroyed() && win.isAlwaysOnTop())
  )
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
      (globalThis as DesktopBridge).simDesktop.settings.setQuickChatShortcut?.(
        value as QuickChatShortcut | null
      ),
    shortcut
  )

const isRegistered = (app: ElectronApplication, shortcut: string) =>
  app.evaluate(({ globalShortcut }, value) => globalShortcut.isRegistered(value), shortcut)

test.describe('quick chat window', () => {
  let fixture: FixtureServer
  /** Paths whose connections are dropped, so their loads fail. */
  const failing = new Set<string>()

  test.beforeAll(async () => {
    fixture = await serve((request, response, url) => {
      if (failing.has(url.pathname)) {
        request.socket.destroy()
        return
      }
      if (url.pathname === '/api/auth/sign-out') {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end('{}')
        return
      }
      const body = PAGES[url.pathname]
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

  test.afterEach(() => {
    failing.clear()
  })

  const settings = (extra: Record<string, unknown> = {}) => ({
    origin: fixture.origin,
    lastRoute: WORKSPACE_ROUTE,
    ...extra,
  })

  test('opens, resizes, hands off, toggles, and closes on sign-out', async ({ desktop }) => {
    const { app } = await desktop.launch({ origin: fixture.origin, settings: settings() })
    const main = await app.firstWindow()
    await expect(main.locator('#app')).toHaveText('workspace')
    const quickUrl = `${fixture.origin}${QUICK_ROUTE}`

    const quick =
      await test.step('opens the compact chat for the last workspace as a floating window', async () => {
        const opened = app.waitForEvent('window')
        await clickMenu(app, 'Quick Chat')
        const page = await opened
        await expect(page.locator('#quick')).toHaveText('quick-chat')
        expect(page.url()).toBe(quickUrl)
        await expect
          .poll(() => windowState(app, quickUrl))
          .toMatchObject({ visible: true, alwaysOnTop: true })
        return page
      })

    await test.step('the floating page gets no desktop bridge while full windows keep it', async () => {
      expect(await hasBridge(quick)).toBe(false)
      expect(await hasBridge(main)).toBe(true)
    })

    await test.step('resizing holds the minimum size and the page follows the window', async () => {
      await resizeWindow(app, quickUrl, 200, 200)
      await expect.poll(() => windowState(app, quickUrl)).toMatchObject({ size: [360, 420] })
      // Small enough for any runner display; macOS clamps a window to the screen it is on.
      await resizeWindow(app, quickUrl, 600, 560)
      await expect.poll(() => windowState(app, quickUrl)).toMatchObject({ size: [600, 560] })
      await expect.poll(() => quick.evaluate(() => window.innerWidth)).toBe(600)
    })

    await test.step('Open in Sim hands the chat to a full window and leaves the panel open', async () => {
      const handedOff = app.waitForEvent('window')
      await quick.locator('#open-in-sim').click()
      const full = await handedOff
      await expect(full.locator('#chat')).toHaveText('handed-off')
      expect(await hasBridge(full)).toBe(true)
      expect(await windowState(app, quickUrl)).toMatchObject({ visible: true, alwaysOnTop: true })
    })

    await test.step('the toggle brings a background panel forward, then hides it, keeping the page', async () => {
      await quick.evaluate(() => {
        ;(globalThis as { quickChatMarker?: string }).quickChatMarker = 'kept'
      })
      // The hand-off focused the full window; the app must be active for window focus to land.
      await app.evaluate(({ app }) => app.focus({ steal: true }))
      await clickMenu(app, 'Quick Chat')
      await expect
        .poll(() => windowState(app, quickUrl))
        .toMatchObject({ visible: true, focused: true })
      await clickMenu(app, 'Quick Chat')
      await expect.poll(() => windowState(app, quickUrl)).toMatchObject({ visible: false })
      await clickMenu(app, 'Quick Chat')
      await expect.poll(() => windowState(app, quickUrl)).toMatchObject({ visible: true })
      expect(
        await quick.evaluate(() => (globalThis as { quickChatMarker?: string }).quickChatMarker)
      ).toBe('kept')
    })

    await test.step('signing out destroys the panel with the account it belonged to', async () => {
      await clickMenu(app, 'Sign Out')
      // Found as the only always-on-top window, not by URL: sign-out sends full windows to /login.
      await expect.poll(() => hasFloatingWindow(app), { timeout: 30_000 }).toBe(false)
      // Windows go to /login only once the whole account teardown has finished.
      await expect(main.locator('#login')).toHaveText('fixture-login', { timeout: 30_000 })
    })
  })

  test('the shortcut setting and a failed first load', async ({ desktop }) => {
    test.skip(process.platform !== 'darwin', 'Only macOS binds a shortcut by default')
    const { app } = await desktop.launch({
      origin: fixture.origin,
      settings: settings({ quickChatShortcut: 'CommandOrControl+Q' }),
    })
    const main = await app.firstWindow()
    await expect(main.locator('#app')).toHaveText('workspace')

    await test.step('a stored shortcut outside the presets falls back to the default', async () => {
      const preferences: DesktopPreferences = await main.evaluate(() =>
        (globalThis as DesktopBridge).simDesktop.settings.getPreferences()
      )
      expect(preferences).toMatchObject({
        quickChatShortcut: DEFAULT_SHORTCUT,
        quickChatShortcutAvailable: true,
      })
      expect(await isRegistered(app, DEFAULT_SHORTCUT)).toBe(true)
      expect(await isRegistered(app, 'CommandOrControl+Q')).toBe(false)
    })

    await test.step('choosing another shortcut releases the old one and binds the new', async () => {
      const next: QuickChatShortcut = 'CommandOrControl+Shift+Space'
      expect(await setShortcut(main, next)).toMatchObject({
        quickChatShortcut: next,
        quickChatShortcutAvailable: true,
      })
      expect(await isRegistered(app, next)).toBe(true)
      expect(await isRegistered(app, DEFAULT_SHORTCUT)).toBe(false)
    })

    await test.step('turning it off releases the shortcut and refuses values off the list', async () => {
      expect(await setShortcut(main, null)).toMatchObject({
        quickChatShortcut: null,
        quickChatShortcutAvailable: true,
      })
      expect(await isRegistered(app, 'CommandOrControl+Shift+Space')).toBe(false)
      expect(await setShortcut(main, 'CommandOrControl+Q')).toMatchObject({
        quickChatShortcut: null,
      })
      expect(await isRegistered(app, 'CommandOrControl+Q')).toBe(false)
    })

    await test.step('a failed first load reloads when the panel is shown again', async () => {
      failing.add(QUICK_ROUTE)
      // Listens before the panel exists: its first load can fail before Playwright sees the page.
      await app.evaluate(({ app }) => {
        const state = globalThis as { quickChatLoadFailed?: boolean }
        app.once('browser-window-created', (_event, win) => {
          win.webContents.on(
            'did-fail-load',
            (_failure, _code, _description, _url, isMainFrame) => {
              if (isMainFrame) state.quickChatLoadFailed = true
            }
          )
        })
      })
      const opened = app.waitForEvent('window')
      await clickMenu(app, 'Quick Chat')
      const quick = await opened
      await expect
        .poll(() =>
          app.evaluate(() => (globalThis as { quickChatLoadFailed?: boolean }).quickChatLoadFailed)
        )
        .toBe(true)
      await expect(quick.locator('#quick')).toHaveCount(0)
      failing.delete(QUICK_ROUTE)

      // Focus the main window so the toggle reveals the panel rather than hiding a focused one.
      await app.evaluate(({ app, BrowserWindow }, route) => {
        const win = BrowserWindow.getAllWindows().find((candidate) =>
          candidate.webContents.getURL().endsWith(route)
        )
        if (!win) throw new Error('Main window is missing')
        app.focus({ steal: true })
        win.focus()
      }, WORKSPACE_ROUTE)
      await expect
        .poll(() => windowState(app, `${fixture.origin}${WORKSPACE_ROUTE}`))
        .toMatchObject({ focused: true })
      await clickMenu(app, 'Quick Chat')
      await expect(quick.locator('#quick')).toHaveText('quick-chat')
    })
  })

  test('the toggle opens nothing while account data cannot be stored', async ({ desktop }) => {
    // An unreadable settings file blocks persistence, which makes account data unavailable.
    const { app } = await desktop.launch({ origin: fixture.origin, settings: '[]' })
    await app.firstWindow()
    // The toggle builds the window synchronously inside the menu click.
    await clickMenu(app, 'Quick Chat')
    expect(await hasFloatingWindow(app)).toBe(false)
  })
})
