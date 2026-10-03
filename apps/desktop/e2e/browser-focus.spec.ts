import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from '@playwright/test'
import type { BrowserToolName } from '@sim/browser-protocol'
import type { SimDesktopApi } from '@sim/desktop-bridge'
import { getErrorMessage } from '@sim/utils/errors'

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))
const SCOPE = 'browser-focus-e2e'
const PRIMARY = process.platform === 'darwin' ? 'meta' : 'control'
const SHELL_FIXTURE =
  '<!doctype html><title>Sim fixture</title><h1>Browser focus fixture</h1><textarea id="composer" aria-label="Composer"></textarea>'
const page = (name: string) =>
  `<!doctype html><title>${name}</title><a href="/popup" target="_blank">Open popup</a><input aria-label="Field">`

type Bridge = typeof globalThis & { simDesktop: SimDesktopApi; shellMarker?: string }

/**
 * The browser shares one window with Sim, so focus and shortcuts decide whether
 * a keystroke lands in chat, in the page, or reloads all of Sim. These checks
 * drive the real shell and native tab views.
 */
test('browser focus and shortcuts stay with the surface the user is using', async () => {
  const reportPath =
    process.env.DESKTOP_BROWSER_FOCUS_REPORT_PATH ?? test.info().outputPath('browser-focus.json')
  const checks: {
    name: string
    status: 'passed' | 'failed'
    durationMs: number
    error?: string
  }[] = []
  const check = async (name: string, run: () => Promise<void>) => {
    const started = Date.now()
    try {
      await test.step(name, run)
      checks.push({ name, status: 'passed', durationMs: Date.now() - started })
    } catch (error) {
      checks.push({
        name,
        status: 'failed',
        durationMs: Date.now() - started,
        error: getErrorMessage(error),
      })
      throw error
    }
  }
  const calls = new Map<string, { chatId: string; toolName: BrowserToolName; args: unknown }>()
  const server: Server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    if (path === '/api/desktop/tool/authorize') {
      let body = ''
      for await (const chunk of request) body += chunk.toString()
      const authorization = calls.get(JSON.parse(body).toolCallId)
      response.writeHead(authorization ? 200 : 403, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(authorization ?? {}))
      return
    }
    // The app origin serves the shell; the same server on localhost is the web.
    const isSite = request.headers.host?.startsWith('localhost') === true
    response.writeHead(200, {
      'Content-Type': 'text/html',
      ...(isSite ? {} : { 'Set-Cookie': 'better-auth.session_token=fixture; HttpOnly; Path=/' }),
    })
    response.end(isSite ? page(path.slice(1)) : SHELL_FIXTURE)
  })
  const userData = mkdtempSync(join(tmpdir(), 'sim-browser-focus-e2e-'))
  let app: ElectronApplication | undefined
  let passed = false
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    const origin = `http://127.0.0.1:${address.port}`
    /** Pages outside the app origin browse in the agent partition, like any third-party site. */
    const site = origin.replace('127.0.0.1', 'localhost')
    const shellApp = await electron.launch({
      args: [process.env.SIM_DESKTOP_E2E_MAIN ?? '.'],
      cwd: DESKTOP_DIR,
      env: { ...process.env, SIM_DESKTOP_ORIGIN: origin, SIM_DESKTOP_USER_DATA: userData },
    })
    app = shellApp
    const shell: Page = await shellApp.firstWindow()
    await shellApp.evaluate(({ app, BrowserWindow }) => {
      const host = BrowserWindow.getAllWindows()[0]
      host.webContents.setBackgroundThrottling(false)
      app.focus({ steal: true })
      host.focus()
    })
    await expect(shell.getByRole('heading')).toHaveText('Browser focus fixture')
    await shell.evaluate(async (scope) => {
      const api = (globalThis as Bridge).simDesktop.browserAgent
      await api.activateScope(scope)
      const updateBounds = () =>
        api.setPanelBounds(
          { x: 0, y: 120, width: innerWidth, height: innerHeight - 120 },
          null,
          scope
        )
      updateBounds()
      ;(globalThis as Bridge & { boundsTimer?: number }).boundsTimer = window.setInterval(
        updateBounds,
        200
      )
      ;(globalThis as Bridge).shellMarker = 'alive'
    }, SCOPE)

    let callCount = 0
    const execute = async (tool: BrowserToolName, args: Record<string, unknown>) => {
      const callId = `browser-focus-${++callCount}`
      calls.set(callId, { chatId: SCOPE, toolName: tool, args })
      const result = await shell.evaluate(
        ({ callId, tool, args, scope }) =>
          (globalThis as Bridge).simDesktop.browserAgent.executeTool(callId, tool, args, scope),
        { callId, tool, args, scope: SCOPE }
      )
      expect(result.ok).toBe(true)
      return result.ok ? result.result : undefined
    }
    const panelAction = (action: Record<string, unknown>) =>
      shell.evaluate(
        ({ action, scope }) =>
          (globalThis as Bridge).simDesktop.browserAgent.panelAction(
            action as unknown as Parameters<SimDesktopApi['browserAgent']['panelAction']>[0],
            scope
          ),
        { action, scope: SCOPE }
      )
    const setPanelFocused = (focused: boolean) =>
      shell.evaluate(
        ({ focused, scope }) =>
          (globalThis as Bridge).simDesktop.browserAgent.setPanelFocused(focused, scope),
        { focused, scope: SCOPE }
      )
    const tabCount = () =>
      shell.evaluate(
        async (scope) =>
          (await (globalThis as Bridge).simDesktop.browserAgent.activateScope(scope)).tabs.length,
        SCOPE
      )
    const shellAlive = () =>
      shell.evaluate(() => (globalThis as Bridge).shellMarker === 'alive').catch(() => false)
    const composerFocused = () =>
      shell.evaluate(() => document.hasFocus() && document.activeElement?.id === 'composer')
    const focusedPageUrls = () =>
      shellApp.evaluate(({ BrowserWindow, WebContentsView }) =>
        BrowserWindow.getAllWindows()[0]
          .contentView.children.filter(
            (view) => view instanceof WebContentsView && view.webContents.isFocused()
          )
          .map((view) => (view as Electron.WebContentsView).webContents.getURL())
      )
    const visiblePageUrl = () =>
      shellApp.evaluate(({ BrowserWindow, WebContentsView }) => {
        const view = BrowserWindow.getAllWindows()[0].contentView.children.find(
          (child) => child instanceof WebContentsView && child.getVisible()
        ) as Electron.WebContentsView | undefined
        return view?.webContents.getURL() ?? null
      })
    /** Counts main-frame loads of the visible page from now on. */
    const countVisiblePageLoads = () =>
      shellApp.evaluate(({ BrowserWindow, WebContentsView }) => {
        const view = BrowserWindow.getAllWindows()[0].contentView.children.find(
          (child) => child instanceof WebContentsView && child.getVisible()
        ) as Electron.WebContentsView
        const counter = globalThis as typeof globalThis & { pageLoads?: number; counted?: boolean }
        counter.pageLoads = 0
        if (!counter.counted) {
          counter.counted = true
          view.webContents.on('did-finish-load', () => {
            counter.pageLoads = (counter.pageLoads ?? 0) + 1
          })
        }
      })
    const pageLoads = () =>
      shellApp.evaluate(() => (globalThis as typeof globalThis & { pageLoads?: number }).pageLoads)
    const focusVisiblePage = () =>
      shellApp.evaluate(({ BrowserWindow, WebContentsView }) => {
        const view = BrowserWindow.getAllWindows()[0].contentView.children.find(
          (child) => child instanceof WebContentsView && child.getVisible()
        ) as Electron.WebContentsView
        view.webContents.focus()
      })
    const pressInPage = (keyCode: string, modifiers: string[]) =>
      shellApp.evaluate(
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
      shellApp.evaluate(({ BrowserWindow, Menu }, label) => {
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

    await check('the agent working never takes the caret from the composer', async () => {
      await shell.locator('#composer').click()
      await shell.keyboard.type('draft')
      for (const [tool, args] of [
        ['browser_open_url', { url: `${site}/one` }],
        ['browser_navigate', { url: `${site}/two` }],
        ['browser_open_tab', { url: `${site}/three` }],
      ] as const) {
        await execute(tool, args)
        await expect.poll(visiblePageUrl).not.toBeNull()
        expect(await composerFocused()).toBe(true)
        expect(await focusedPageUrls()).toEqual([])
      }
      // A link without an opener is focused by Chromium itself as it is created.
      const snapshot = await execute('browser_snapshot', {})
      const ref = /"Open popup" \[ref=(\d+)\]/.exec(
        String((snapshot as { outline?: string }).outline)
      )?.[1]
      expect(ref, 'snapshot lists the popup link').toBeTruthy()
      await execute('browser_click', { elementId: Number(ref) })
      await expect.poll(tabCount).toBe(3)
      await expect.poll(focusedPageUrls).toEqual([])
      expect(await composerFocused()).toBe(true)
      await shell.keyboard.type(' continues')
      await expect(shell.locator('#composer')).toHaveValue('draft continues')
    })

    await check('an omnibox navigation hands focus to the page it loads', async () => {
      await panelAction({ action: 'switch-tab', tabId: '1' })
      await panelAction({ action: 'navigate', url: `${site}/four` })
      await expect.poll(focusedPageUrls).toEqual([`${site}/four`])
    })

    await check('a popup the agent opens hands focus back to the page the user is in', async () => {
      const before = await tabCount()
      const snapshot = await execute('browser_snapshot', {})
      const ref = /"Open popup" \[ref=(\d+)\]/.exec(
        String((snapshot as { outline?: string }).outline)
      )?.[1]
      expect(ref, 'snapshot lists the popup link').toBeTruthy()
      await execute('browser_click', { elementId: Number(ref) })
      await expect.poll(tabCount).toBe(before + 1)
      await expect.poll(focusedPageUrls).toEqual([`${site}/four`])
    })

    await check('reload keys typed in the page reload only that page', async () => {
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

    await check('the page keeps its shortcut claim after the chrome reports blur', async () => {
      await setPanelFocused(true)
      await focusVisiblePage()
      await setPanelFocused(false)
      await countVisiblePageLoads()
      await clickMenu('Reload')
      await expect.poll(pageLoads).toBe(1)
      expect(await shellAlive()).toBe(true)
    })

    await check('Back and Forward move through the focused page history', async () => {
      await panelAction({ action: 'navigate', url: `${site}/five` })
      await expect.poll(visiblePageUrl).toBe(`${site}/five`)
      await focusVisiblePage()
      await clickMenu('Back')
      await expect.poll(visiblePageUrl).toBe(`${site}/four`)
      await focusVisiblePage()
      await clickMenu('Forward')
      await expect.poll(visiblePageUrl).toBe(`${site}/five`)
    })

    await check('browser shortcuts work while renderer chrome hides the page', async () => {
      const before = await tabCount()
      await shell.evaluate((scope) => {
        const bridge = globalThis as Bridge & { boundsTimer?: number }
        window.clearInterval(bridge.boundsTimer)
        bridge.simDesktop.browserAgent.setPanelBounds(null, null, scope)
      }, SCOPE)
      await setPanelFocused(true)
      await clickMenu('New Tab')
      await expect.poll(tabCount).toBe(before + 1)
    })
    passed = true
  } finally {
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, JSON.stringify({ passed, checks }, null, 2))
    await app?.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(userData, { recursive: true, force: true })
  }
})
