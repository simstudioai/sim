import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from '@playwright/test'
import type { BrowserPageDialog, BrowserToolName } from '@sim/browser-protocol'
import type { SimDesktopApi } from '@sim/desktop-bridge'
import { getErrorMessage } from '@sim/utils/errors'
import { recordCheck } from './check-report'

/**
 * The embedded browser against what a user expects of Chrome: the page menu,
 * history and tab keys, Escape on a slow load, and a video's fullscreen
 * button. Each test drives the real shell and native tab views with trusted
 * input, and lands in a JSON report at BROWSER_PAGE_PARITY_REPORT_PATH
 * (test-results/browser-page-parity-report.json by default) as it finishes.
 */

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))
const SCOPE = 'browser-page-parity-e2e'
const IS_MAC = process.platform === 'darwin'
const SHELL_FIXTURE = '<!doctype html><title>Sim fixture</title><h1>Browser parity fixture</h1>'
/** A 2x2 PNG, so a saved copy is checked byte for byte. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DwnwEIGBkZGRgYAAAhBAEB/0bFxgAAAABJRU5ErkJggg==',
  'base64'
)
const PAGES: Record<string, string> = {
  '/form': `<!doctype html><title>form</title><input id="draft" aria-label="Draft">
<script>addEventListener('beforeunload', (event) => {
  if (document.getElementById('draft').value) { event.preventDefault(); event.returnValue = '' }
})</script>`,
  '/image':
    '<!doctype html><title>image</title><img id="pic" src="/pixel.png" width="200" height="200">',
  '/links': '<!doctype html><title>links</title><a id="link" href="/landing">Landing</a>',
  '/fullscreen': `<!doctype html><title>fullscreen</title>
<button id="go" style="width:200px;height:80px">Fullscreen</button>
<script>
document.getElementById('go').onclick = () => document.documentElement.requestFullscreen().then(
  () => { document.title = 'entered' },
  (error) => { document.title = 'refused:' + error.name }
)
document.onfullscreenchange = () => { if (!document.fullscreenElement) document.title = 'exited' }
</script>`,
}

type Bridge = typeof globalThis & {
  simDesktop: SimDesktopApi
  pageDialog?: BrowserPageDialog | null
  boundsTimer?: number
}
/** What the suite installs in the main process. */
type MainFixture = typeof globalThis & {
  agentMenus?: (Electron.MenuItemConstructorOptions | Electron.MenuItem)[][]
  visibleView?: () => Electron.WebContentsView | undefined
}

const reportPath = () =>
  process.env.BROWSER_PAGE_PARITY_REPORT_PATH ??
  join(test.info().project.outputDir, 'browser-page-parity-report.json')

/** Runs one check and adds its outcome to the report as soon as it is known. */
async function check(name: string, body: () => Promise<void>): Promise<void> {
  const startedAt = Date.now()
  const record = (status: 'passed' | 'failed', error?: unknown) =>
    recordCheck(reportPath(), 'browser-page-parity', {
      name,
      status,
      durationMs: Date.now() - startedAt,
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

/** A test whose outcome is also one check in the suite's report. */
function checkedTest(name: string, body: () => Promise<void>): void {
  test(name, () => check(name, body))
}

test.describe('browser page parity with Chrome', () => {
  let app: ElectronApplication | undefined
  let shell: Page
  let site = ''
  let userData = ''
  let downloads = ''
  /** Held responses for the slow page, released when the suite ends. */
  const held = new Set<ServerResponse>()
  /** The Referer each load of the link target arrived with. */
  const referrers: (string | undefined)[] = []
  const calls = new Map<string, { chatId: string; toolName: BrowserToolName; args: unknown }>()
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    if (path === '/api/desktop/tool/authorize') {
      let body = ''
      for await (const chunk of request) body += chunk.toString()
      const authorization = calls.get(JSON.parse(body).toolCallId)
      response.writeHead(authorization ? 200 : 403, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(authorization ?? {}))
      return
    }
    if (path === '/pixel.png') {
      response.writeHead(200, { 'Content-Type': 'image/png' })
      response.end(PNG)
      return
    }
    if (path === '/landing') referrers.push(request.headers.referer)
    if (path === '/slow') {
      held.add(response)
      return
    }
    // The app origin serves the shell; the same server on localhost is the web.
    const isSite = request.headers.host?.startsWith('localhost') === true
    response.writeHead(200, {
      'Content-Type': 'text/html',
      ...(isSite ? {} : { 'Set-Cookie': 'better-auth.session_token=fixture; HttpOnly; Path=/' }),
    })
    response.end(
      isSite
        ? (PAGES[path] ?? `<!doctype html><title>${path.slice(1)}</title><p>${path}</p>`)
        : SHELL_FIXTURE
    )
  })

  test.beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    const origin = `http://127.0.0.1:${address.port}`
    site = origin.replace('127.0.0.1', 'localhost')
    userData = mkdtempSync(join(tmpdir(), 'sim-browser-parity-e2e-'))
    downloads = mkdtempSync(join(tmpdir(), 'sim-browser-parity-downloads-'))
    app = await electron.launch({
      args: [process.env.SIM_DESKTOP_E2E_MAIN ?? '.'],
      cwd: DESKTOP_DIR,
      env: { ...process.env, SIM_DESKTOP_ORIGIN: origin, SIM_DESKTOP_USER_DATA: userData },
    })
    // A dialog listener stops Playwright auto-dismissing a page's leave-site
    // question, so the desktop's own handling decides it as in production.
    const leaveDialogsToDesktop = (page: Page) => page.on('dialog', () => {})
    app.context().pages().forEach(leaveDialogsToDesktop)
    app.context().on('page', leaveDialogsToDesktop)
    shell = await app.firstWindow()
    await app.evaluate(({ app, BrowserWindow, Menu, WebContentsView }, downloads) => {
      // Downloads default to the OS folder; keep the suite's files out of the user's.
      app.setPath('downloads', downloads)
      const host = BrowserWindow.getAllWindows()[0]
      host.webContents.setBackgroundThrottling(false)
      app.focus({ steal: true })
      host.focus()
      // A native menu blocks the main process while it is open; keep each page
      // menu's items so a check can choose one the way a click would.
      const capture = globalThis as MainFixture
      capture.visibleView = () =>
        BrowserWindow.getAllWindows()[0].contentView.children.find(
          (child): child is Electron.WebContentsView =>
            child instanceof WebContentsView && child.getVisible()
        )
      capture.agentMenus = []
      const build = Menu.buildFromTemplate.bind(Menu)
      Menu.buildFromTemplate = (template) => {
        capture.agentMenus?.push(template)
        const menu = build(template)
        menu.popup = () => {}
        return menu
      }
    }, downloads)
    await expect(shell.getByRole('heading')).toHaveText('Browser parity fixture')
    await shell.evaluate(async (scope) => {
      const bridge = globalThis as Bridge
      const api = bridge.simDesktop.browserAgent
      await api.activateScope(scope)
      api.onPageState((state) => {
        bridge.pageDialog = state.dialog ?? null
      })
      const updateBounds = () =>
        api.setPanelBounds(
          { x: 0, y: 80, width: innerWidth, height: innerHeight - 80 },
          null,
          scope
        )
      updateBounds()
      bridge.boundsTimer = window.setInterval(updateBounds, 200)
    }, SCOPE)
    await execute('browser_open_url', { url: `${site}/start` })
    await panelAction({ action: 'switch-tab', tabId: '1' })
    await panelAction({ action: 'enable-page-dialogs' })
  })

  test.afterAll(async () => {
    for (const response of held) response.destroy()
    await app?.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(userData, { recursive: true, force: true })
    rmSync(downloads, { recursive: true, force: true })
  })

  let callCount = 0
  async function execute(tool: BrowserToolName, args: Record<string, unknown>) {
    const callId = `browser-parity-${++callCount}`
    calls.set(callId, { chatId: SCOPE, toolName: tool, args })
    const result = await shell.evaluate(
      ({ callId, tool, args, scope }) =>
        (globalThis as Bridge).simDesktop.browserAgent.executeTool(callId, tool, args, scope),
      { callId, tool, args, scope: SCOPE }
    )
    expect(result.ok, result.error).toBe(true)
  }

  /** Browser-chrome actions are user gestures, so each follows a real click in Sim. */
  async function panelAction(action: Record<string, unknown>) {
    await shell.getByRole('heading').click()
    await shell.evaluate(
      ({ action, scope }) =>
        (globalThis as Bridge).simDesktop.browserAgent.panelAction(
          action as unknown as Parameters<SimDesktopApi['browserAgent']['panelAction']>[0],
          scope
        ),
      { action, scope: SCOPE }
    )
  }

  /** Reads one property of the page on screen from the main process. */
  function visiblePage<T>(read: string): Promise<T> {
    if (!app) throw new Error('App not launched')
    return app.evaluate(({ BrowserWindow }, read) => {
      const view = (globalThis as MainFixture).visibleView?.()
      if (!view) return null
      const contents = view.webContents
      const values: Record<string, unknown> = {
        url: contents.getURL(),
        title: contents.getTitle(),
        loading: contents.isLoadingMainFrame(),
        zoom: contents.getZoomFactor(),
        bounds: view.getBounds(),
        windowFullScreen: BrowserWindow.getAllWindows()[0].isFullScreen(),
      }
      return values[read]
    }, read) as Promise<T>
  }

  const pageUrl = () => visiblePage<string>('url')
  const pageTitle = () => visiblePage<string>('title')
  const pageDialog = () => shell.evaluate(() => (globalThis as Bridge).pageDialog ?? null)

  /** Trusted input into the page on screen, the way the user's own mouse and keys arrive. */
  async function inPage(
    action:
      | { kind: 'click' | 'right-click'; selector: string; offsetX?: number }
      | { kind: 'type'; text: string }
      | { kind: 'key'; keyCode: string; modifiers?: string[] }
      | { kind: 'script'; script: string }
  ): Promise<unknown> {
    if (!app) throw new Error('App not launched')
    return app.evaluate(async (_electron, action) => {
      const view = (globalThis as MainFixture).visibleView?.()
      if (!view) throw new Error('No visible page')
      const contents = view.webContents
      if (action.kind === 'script') return contents.executeJavaScript(action.script)
      if (action.kind === 'type') {
        for (const character of action.text) {
          contents.sendInputEvent({ type: 'char', keyCode: character })
        }
        return null
      }
      if (action.kind === 'key') {
        const input = {
          keyCode: action.keyCode,
          modifiers: action.modifiers ?? [],
        } as Electron.KeyboardInputEvent
        contents.focus()
        contents.sendInputEvent({ ...input, type: 'keyDown' })
        contents.sendInputEvent({ ...input, type: 'keyUp' })
        return null
      }
      const rect: { x: number; y: number; height: number } = await contents.executeJavaScript(
        `(() => { const { x, y, height } = document.querySelector(${JSON.stringify(action.selector)}).getBoundingClientRect(); return { x, y, height } })()`
      )
      const point = {
        x: Math.round(rect.x + (action.offsetX ?? 10)),
        y: Math.round(rect.y + Math.min(rect.height / 2, 20)),
      }
      const button = action.kind === 'click' ? 'left' : 'right'
      contents.sendInputEvent({ type: 'mouseDown', ...point, button, clickCount: 1 })
      contents.sendInputEvent({ type: 'mouseUp', ...point, button, clickCount: 1 })
      return null
    }, action)
  }

  /** Right-clicks `selector` and returns the page menu's item labels. */
  async function openPageMenu(selector: string, offsetX?: number): Promise<string[]> {
    if (!app) throw new Error('App not launched')
    const menus = () =>
      app?.evaluate(() => (globalThis as MainFixture).agentMenus?.length ?? 0) ?? 0
    const before = await menus()
    await inPage({ kind: 'right-click', selector, offsetX })
    await expect.poll(menus).toBeGreaterThan(before)
    return app.evaluate(() =>
      ((globalThis as MainFixture).agentMenus?.at(-1) ?? [])
        .filter((item) => item.type !== 'separator')
        .map((item) => item.label ?? '')
    )
  }

  /** Chooses an item from the page menu opened last. */
  async function choosePageMenuItem(label: string): Promise<void> {
    if (!app) throw new Error('App not launched')
    await app.evaluate((_electron, label) => {
      const item = (globalThis as MainFixture).agentMenus
        ?.at(-1)
        ?.find((entry) => entry.label === label)
      if (!item?.click) throw new Error(`The page menu has no "${label}" item`)
      ;(item.click as () => void)()
    }, label)
  }

  async function navigate(path: string): Promise<void> {
    await panelAction({ action: 'navigate', url: `${site}${path}` })
    await expect.poll(pageUrl).toBe(`${site}${path}`)
    await expect.poll(() => visiblePage<boolean>('loading')).toBe(false)
  }

  checkedTest("the page menu's Back asks before leaving unsaved changes", async () => {
    await navigate('/next')
    await navigate('/form')
    await inPage({ kind: 'click', selector: '#draft' })
    await inPage({ kind: 'type', text: 'draft' })
    await expect.poll(() => inPage({ kind: 'script', script: 'draft.value' })).toBe('draft')

    await openPageMenu('#draft', 120)
    await choosePageMenuItem('Back')
    await expect.poll(pageDialog).toMatchObject({ kind: 'beforeunload' })
    const stay = await pageDialog()
    await panelAction({ action: 'respond-dialog', requestId: stay?.requestId, allowed: false })
    await expect.poll(pageDialog).toBeNull()
    expect(await pageUrl()).toBe(`${site}/form`)
    expect(await inPage({ kind: 'script', script: 'draft.value' })).toBe('draft')

    await openPageMenu('#draft', 120)
    await choosePageMenuItem('Back')
    await expect.poll(pageDialog).toMatchObject({ kind: 'beforeunload' })
    const leave = await pageDialog()
    await panelAction({ action: 'respond-dialog', requestId: leave?.requestId, allowed: true })
    await expect.poll(pageUrl).toBe(`${site}/next`)
  })

  checkedTest("the page menu's Save Image lands through the browser's downloads", async () => {
    for (const file of readdirSync(downloads)) rmSync(join(downloads, file), { force: true })
    await navigate('/image')
    await expect
      .poll(() => inPage({ kind: 'script', script: 'document.getElementById("pic").complete' }))
      .toBe(true)
    const labels = await openPageMenu('#pic')
    expect(labels).toEqual(
      expect.arrayContaining(['Open Image in New Tab', 'Copy Image', 'Copy Image Address'])
    )
    await choosePageMenuItem('Save Image')
    await expect.poll(() => readdirSync(downloads)).toEqual(['pixel.png'])
    expect(readFileSync(join(downloads, 'pixel.png')).equals(PNG)).toBe(true)
  })

  checkedTest("the page menu's Open Link in New Tab sends the page as referrer", async () => {
    referrers.length = 0
    await navigate('/links')
    await openPageMenu('#link')
    await choosePageMenuItem('Open Link in New Tab')
    await expect.poll(() => referrers).toEqual([`${site}/links`])
  })

  checkedTest('tab keys, and history keys off macOS, typed in the page follow Chrome', async () => {
    await navigate('/one')
    await execute('browser_open_tab', { url: `${site}/two` })
    await execute('browser_open_tab', { url: `${site}/three` })
    const tabs = await shell.evaluate(
      async (scope) =>
        (await (globalThis as Bridge).simDesktop.browserAgent.activateScope(scope)).tabs,
      SCOPE
    )
    // Earlier checks may have left tabs open; the keys move to the neighbours in strip order.
    const urls = tabs.map((tab) => tab.url)
    const index = urls.indexOf(`${site}/one`)
    const next = urls[(index + 1) % urls.length]
    const previous = urls[(index - 1 + urls.length) % urls.length]
    expect(urls.length).toBeGreaterThan(2)
    await panelAction({ action: 'switch-tab', tabId: tabs[index]?.tabId })
    await expect.poll(pageUrl).toBe(`${site}/one`)

    if (IS_MAC) {
      await inPage({ kind: 'key', keyCode: 'Right', modifiers: ['meta', 'alt'] })
      await expect.poll(pageUrl).toBe(next)
      await inPage({ kind: 'key', keyCode: '[', modifiers: ['meta', 'shift'] })
      await expect.poll(pageUrl).toBe(`${site}/one`)
      await inPage({ kind: 'key', keyCode: '[', modifiers: ['meta', 'shift'] })
      await expect.poll(pageUrl).toBe(previous)
      await inPage({ kind: 'key', keyCode: ']', modifiers: ['meta', 'shift'] })
      await expect.poll(pageUrl).toBe(`${site}/one`)
      await inPage({ kind: 'key', keyCode: 'Left', modifiers: ['meta', 'alt'] })
      await expect.poll(pageUrl).toBe(previous)
    } else {
      await inPage({ kind: 'key', keyCode: 'PageDown', modifiers: ['control'] })
      await expect.poll(pageUrl).toBe(next)
      await inPage({ kind: 'key', keyCode: 'PageUp', modifiers: ['control'] })
      await expect.poll(pageUrl).toBe(`${site}/one`)
      await navigate('/one-later')
      await inPage({ kind: 'key', keyCode: 'Left', modifiers: ['alt'] })
      await expect.poll(pageUrl).toBe(`${site}/one`)
      await inPage({ kind: 'key', keyCode: 'Right', modifiers: ['alt'] })
      await expect.poll(pageUrl).toBe(`${site}/one-later`)
    }
  })

  checkedTest('Escape stops a page that is still loading', async () => {
    await navigate('/before-slow')
    await panelAction({ action: 'navigate', url: `${site}/slow` })
    await expect.poll(() => visiblePage<boolean>('loading')).toBe(true)
    await inPage({ kind: 'key', keyCode: 'Escape' })
    await expect.poll(() => visiblePage<boolean>('loading'), { timeout: 3_000 }).toBe(false)
  })

  checkedTest("a page's fullscreen fills the browser panel and Escape leaves it", async () => {
    await navigate('/fullscreen')
    const bounds = await visiblePage<Electron.Rectangle>('bounds')
    await inPage({ kind: 'click', selector: '#go' })
    await expect.poll(pageTitle).toBe('entered')
    expect(await visiblePage<boolean>('windowFullScreen')).toBe(false)
    expect(await visiblePage<Electron.Rectangle>('bounds')).toEqual(bounds)
    await inPage({ kind: 'key', keyCode: 'Escape' })
    await expect.poll(pageTitle).toBe('exited')
    expect(await visiblePage<boolean>('windowFullScreen')).toBe(false)
  })
})
