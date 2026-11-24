import type { BrowserPanelAction, BrowserToolName } from '@sim/browser-protocol'
import { refFor } from './executor-sim'
import {
  attachBrowserPanel,
  type DesktopBridge,
  expect,
  focusFirstWindow,
  hideBrowserPanel,
  serve,
  ToolAuthorizer,
  test,
} from './harness'

const SCOPE = 'browser-focus-e2e'
const PRIMARY = process.platform === 'darwin' ? 'meta' : 'control'
const PANEL_TOP = 120
const SHELL_FIXTURE =
  '<!doctype html><title>Sim fixture</title><h1>Browser focus fixture</h1><textarea id="composer" aria-label="Composer"></textarea>'
const page = (name: string) =>
  `<!doctype html><title>${name}</title><a href="/popup" target="_blank">Open popup</a><input aria-label="Field">`

type Bridge = DesktopBridge & { shellMarker?: string }
/** What the test installs in the main process. */
type MainFixture = typeof globalThis & { pageLoads?: Map<number, number>; countedPage?: number }

/**
 * The browser shares one window with Sim, so focus and shortcuts decide whether
 * a keystroke lands in chat, in the page, or reloads all of Sim. These steps
 * drive the real shell and native tab views.
 */
test('browser focus and shortcuts stay with the surface the user is using', async ({ desktop }) => {
  const authorizer = new ToolAuthorizer('browser-focus')
  const server = await serve(async (request, response, url) => {
    if (await authorizer.handle(request, response, url)) return
    // The app origin serves the shell; the same server on localhost is the web.
    const isSite = request.headers.host?.startsWith('localhost') === true
    response.writeHead(200, {
      'Content-Type': 'text/html',
      ...(isSite ? {} : { 'Set-Cookie': 'better-auth.session_token=fixture; HttpOnly; Path=/' }),
    })
    response.end(isSite ? page(url.pathname.slice(1)) : SHELL_FIXTURE)
  })
  try {
    const { site } = server
    const { app } = await desktop.launch({
      origin: server.origin,
    })
    const shell = await app.firstWindow()
    await focusFirstWindow(app)
    await expect(shell.getByRole('heading')).toHaveText('Browser focus fixture')
    await attachBrowserPanel(shell, SCOPE, PANEL_TOP)
    await shell.evaluate(() => {
      ;(globalThis as Bridge).shellMarker = 'alive'
    })

    const execute = (tool: BrowserToolName, args: Record<string, unknown> = {}) =>
      authorizer.execute(shell, SCOPE, tool, args)
    /**
     * Fire-and-forget browser IPC, followed by an invoke round trip from the same renderer so the
     * main process has handled the sends before the test acts.
     */
    const send = (message: { panelAction: BrowserPanelAction } | { panelFocused: boolean }) =>
      shell.evaluate(
        async ({ message, scope }) => {
          const api = (globalThis as Bridge).simDesktop.browserAgent
          if ('panelAction' in message) api.panelAction(message.panelAction, scope)
          else api.setPanelFocused(message.panelFocused, scope)
          await api.activateScope(scope)
        },
        { message, scope: SCOPE }
      )
    const tabs = () =>
      shell.evaluate(
        async (scope) =>
          (await (globalThis as Bridge).simDesktop.browserAgent.activateScope(scope)).tabs,
        SCOPE
      )
    const tabCount = async () => (await tabs()).length
    const shellAlive = () =>
      shell.evaluate(() => (globalThis as Bridge).shellMarker === 'alive').catch(() => false)
    const composerFocused = () =>
      shell.evaluate(() => document.hasFocus() && document.activeElement?.id === 'composer')
    const focusedPageUrls = () =>
      app.evaluate(({ BrowserWindow, WebContentsView }) =>
        BrowserWindow.getAllWindows()[0]
          .contentView.children.filter(
            (view) => view instanceof WebContentsView && view.webContents.isFocused()
          )
          .map((view) => (view as Electron.WebContentsView).webContents.getURL())
      )
    const visiblePage = () =>
      app.evaluate(({ BrowserWindow, WebContentsView }) => {
        const view = BrowserWindow.getAllWindows()[0].contentView.children.find(
          (child) => child instanceof WebContentsView && child.getVisible()
        ) as Electron.WebContentsView | undefined
        return view
          ? { url: view.webContents.getURL(), loading: view.webContents.isLoading() }
          : null
      })
    const visiblePageUrl = async () => (await visiblePage())?.url ?? null
    /** How many popup pages have finished loading, wherever they are in the strip. */
    const loadedPopups = () =>
      app.evaluate(
        ({ webContents }, url) =>
          webContents
            .getAllWebContents()
            .filter((contents) => contents.getURL() === url && !contents.isLoading()).length,
        `${site}/popup`
      )
    /** Counts main-frame loads of the page on screen from now on, keyed to its contents. */
    const countVisiblePageLoads = () =>
      app.evaluate(({ BrowserWindow, WebContentsView }) => {
        const view = BrowserWindow.getAllWindows()[0].contentView.children.find(
          (child) => child instanceof WebContentsView && child.getVisible()
        ) as Electron.WebContentsView
        const fixture = globalThis as MainFixture
        const loads = (fixture.pageLoads ??= new Map())
        const contents = view.webContents
        if (!loads.has(contents.id)) {
          contents.on('did-finish-load', () =>
            loads.set(contents.id, (loads.get(contents.id) ?? 0) + 1)
          )
        }
        loads.set(contents.id, 0)
        fixture.countedPage = contents.id
      })
    const pageLoads = () =>
      app.evaluate(() => {
        const fixture = globalThis as MainFixture
        return fixture.countedPage === undefined
          ? undefined
          : fixture.pageLoads?.get(fixture.countedPage)
      })
    /** Focuses the page on screen and waits until it holds keyboard focus. */
    const focusVisiblePage = async () => {
      const url = await app.evaluate(({ BrowserWindow, WebContentsView }) => {
        const view = BrowserWindow.getAllWindows()[0].contentView.children.find(
          (child) => child instanceof WebContentsView && child.getVisible()
        ) as Electron.WebContentsView
        view.webContents.focus()
        return view.webContents.getURL()
      })
      await expect.poll(focusedPageUrls).toEqual([url])
    }
    const pressInPage = (keyCode: string, modifiers: string[]) =>
      app.evaluate(
        ({ BrowserWindow, WebContentsView }, { keyCode, modifiers }) => {
          const view = BrowserWindow.getAllWindows()[0].contentView.children.find(
            (child) => child instanceof WebContentsView && child.getVisible()
          ) as Electron.WebContentsView
          const input = { keyCode, modifiers } as Electron.KeyboardInputEvent
          view.webContents.sendInputEvent({ ...input, type: 'keyDown' })
          view.webContents.sendInputEvent({ ...input, type: 'keyUp' })
        },
        { keyCode, modifiers }
      )
    /** Clicks an application-menu item the way its accelerator would. */
    const clickMenu = (label: string) =>
      app.evaluate(({ BrowserWindow, Menu }, label) => {
        const win = BrowserWindow.getAllWindows()[0]
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
        item.click(undefined, win, win.webContents)
      }, label)
    const clickPopupLink = async () => {
      const before = await loadedPopups()
      const snapshot = (await execute('browser_snapshot')) as { outline: string }
      await execute('browser_click', { elementId: refFor(snapshot.outline, 'Open popup') })
      await expect.poll(loadedPopups).toBe(before + 1)
    }

    await test.step('the agent working never takes the caret from the composer', async () => {
      await shell.locator('#composer').click()
      await shell.keyboard.type('draft')
      for (const [tool, path] of [
        ['browser_open_url', '/one'],
        ['browser_navigate', '/two'],
        ['browser_open_tab', '/three'],
      ] as const) {
        await execute(tool, { url: `${site}${path}` })
        await expect.poll(visiblePage).toEqual({ url: `${site}${path}`, loading: false })
        expect(await composerFocused()).toBe(true)
        expect(await focusedPageUrls()).toEqual([])
      }
      // A link without an opener is focused by Chromium itself as it is created.
      await clickPopupLink()
      expect(await tabCount()).toBe(3)
      expect(await focusedPageUrls()).toEqual([])
      expect(await composerFocused()).toBe(true)
      await shell.keyboard.type(' continues')
      await expect(shell.locator('#composer')).toHaveValue('draft continues')
    })

    await test.step('an omnibox navigation hands focus to the page it loads', async () => {
      await send({ panelAction: { action: 'switch-tab', tabId: '1' } })
      await send({ panelAction: { action: 'navigate', url: `${site}/four` } })
      await expect.poll(focusedPageUrls).toEqual([`${site}/four`])
    })

    await test.step('a popup the agent opens hands focus back to the page the user is in', async () => {
      const before = await tabCount()
      await clickPopupLink()
      expect(await tabCount()).toBe(before + 1)
      await expect.poll(focusedPageUrls).toEqual([`${site}/four`])
    })

    await test.step('reload keys typed in the page reload only that page', async () => {
      for (const [keyCode, modifiers] of [
        ['R', [PRIMARY]],
        ['R', [PRIMARY, 'shift']],
        ['F5', []],
      ] as const) {
        await countVisiblePageLoads()
        await focusVisiblePage()
        await pressInPage(keyCode, [...modifiers])
        await expect.poll(pageLoads).toBe(1)
      }
    })

    await test.step('the page keeps its shortcut claim after the chrome reports blur', async () => {
      await send({ panelFocused: true })
      await focusVisiblePage()
      await send({ panelFocused: false })
      await countVisiblePageLoads()
      await clickMenu('Reload')
      await expect.poll(pageLoads).toBe(1)
      expect(await shellAlive()).toBe(true)
    })

    await test.step('Back and Forward move through the focused page history', async () => {
      await send({ panelAction: { action: 'navigate', url: `${site}/five` } })
      await expect.poll(visiblePage).toEqual({ url: `${site}/five`, loading: false })
      await focusVisiblePage()
      await clickMenu('Back')
      await expect.poll(visiblePageUrl).toBe(`${site}/four`)
      await focusVisiblePage()
      await clickMenu('Forward')
      await expect.poll(visiblePageUrl).toBe(`${site}/five`)
    })

    await test.step('browser shortcuts work while renderer chrome hides the page', async () => {
      const before = await tabCount()
      await hideBrowserPanel(shell, SCOPE)
      await send({ panelFocused: true })
      await clickMenu('New Tab')
      await expect.poll(tabCount).toBe(before + 1)
    })

    await test.step('a revealed page resumes throttling in its own chat after switching chats', async () => {
      await send({ panelAction: { action: 'switch-tab', tabId: '1' } })
      await shell.evaluate(
        async ({ scope, top }) => {
          const api = (globalThis as Bridge).simDesktop.browserAgent
          api.setPanelBounds(
            { x: 0, y: top, width: innerWidth, height: innerHeight - top },
            null,
            scope
          )
          await api.activateScope('browser-focus-other-chat')
        },
        { scope: SCOPE, top: PANEL_TOP }
      )
      await expect
        .poll(() =>
          app.evaluate(
            ({ webContents }, url) =>
              webContents
                .getAllWebContents()
                .find((contents) => contents.getURL() === url)
                ?.getBackgroundThrottling(),
            `${site}/five`
          )
        )
        .toBe(true)
    })
  } finally {
    await server.close()
  }
})
