import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import type { BrowserPageDialog, BrowserPanelAction } from '@sim/browser-protocol'
import {
  attachBrowserPanel,
  type DesktopBridge,
  expect,
  type FixtureServer,
  focusFirstWindow,
  serve,
  ToolAuthorizer,
  test,
} from './harness'

/**
 * The embedded browser against what a user expects of Chrome: the page menu,
 * history and tab keys, Escape on a slow load, and a video's fullscreen
 * button. Each test drives the real shell and native tab views with trusted
 * input.
 */

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

type Bridge = DesktopBridge & { pageDialog?: BrowserPageDialog | null }
/** What the suite installs in the main process. */
type MainFixture = typeof globalThis & {
  agentMenus?: (Electron.MenuItemConstructorOptions | Electron.MenuItem)[][]
  visibleView?: () => Electron.WebContentsView | undefined
}

test.describe('browser page parity with Chrome', () => {
  let server: FixtureServer
  let site = ''
  let app: ElectronApplication
  let shell: Page
  let downloads = ''
  /** The Referer each load of the link target arrived with. */
  const referrers: (string | undefined)[] = []
  /** The Referer each request for the image arrived with. */
  const imageReferrers: (string | undefined)[] = []
  const authorizer = new ToolAuthorizer('browser-parity')

  test.beforeAll(async () => {
    server = await serve(async (request, response, url) => {
      if (await authorizer.handle(request, response, url)) return
      const path = url.pathname
      if (path === '/pixel.png') {
        imageReferrers.push(request.headers.referer)
        // Hotlink-protected, like many image hosts: a request without the page as referrer fails.
        if (!request.headers.referer) {
          response.writeHead(403)
          response.end()
          return
        }
        response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' })
        response.end(PNG)
        return
      }
      if (path === '/landing') referrers.push(request.headers.referer)
      // Never answered; closing the server drops it.
      if (path === '/slow') return
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
    site = server.site
  })

  test.afterAll(async () => {
    await server?.close()
  })

  test.beforeEach(async ({ desktop }) => {
    referrers.length = 0
    imageReferrers.length = 0
    downloads = desktop.tempDir('sim-browser-parity-downloads-')
    const launched = await desktop.launch({
      origin: server.origin,
      // The desktop's own handling decides a page's leave-site question, as in production.
      leaveDialogsToDesktop: true,
    })
    app = launched.app
    shell = await app.firstWindow()
    await app.evaluate(({ app, BrowserWindow, Menu, WebContentsView }, downloads) => {
      // Downloads default to the OS folder; keep the suite's files out of the user's.
      app.setPath('downloads', downloads)
      // A native menu blocks the main process while it is open; keep each page
      // menu's items so a test can choose one the way a click would.
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
    await focusFirstWindow(app)
    await expect(shell.getByRole('heading')).toHaveText('Browser parity fixture')
    await shell.evaluate(() => {
      const bridge = globalThis as Bridge
      bridge.simDesktop.browserAgent.onPageState((state) => {
        bridge.pageDialog = state.dialog ?? null
      })
    })
    await attachBrowserPanel(shell, SCOPE)
    await authorizer.execute(shell, SCOPE, 'browser_open_url', { url: `${site}/start` })
    await panelAction({ action: 'switch-tab', tabId: '1' })
    await panelAction({ action: 'enable-page-dialogs' })
  })

  /**
   * Browser-chrome actions are user gestures, so each follows a real click in Sim. The action is a
   * send; the invoke after it from the same renderer returns once main has handled it.
   */
  async function panelAction(action: BrowserPanelAction) {
    await shell.getByRole('heading').click()
    await shell.evaluate(
      async ({ action, scope }) => {
        const api = (globalThis as Bridge).simDesktop.browserAgent
        api.panelAction(action, scope)
        await api.activateScope(scope)
      },
      { action, scope: SCOPE }
    )
  }

  /** Reads one property of the page on screen from the main process. */
  function visiblePage<T>(read: string): Promise<T> {
    return app.evaluate(({ BrowserWindow }, read) => {
      const view = (globalThis as MainFixture).visibleView?.()
      if (!view) return null
      const contents = view.webContents
      const values: Record<string, unknown> = {
        url: contents.getURL(),
        title: contents.getTitle(),
        loading: contents.isLoadingMainFrame(),
        focused: contents.isFocused(),
        bounds: view.getBounds(),
        windowFullScreen: BrowserWindow.getAllWindows()[0].isFullScreen(),
      }
      return values[read]
    }, read) as Promise<T>
  }

  const pageUrl = () => visiblePage<string>('url')
  const pageTitle = () => visiblePage<string>('title')
  const pageDialog = () => shell.evaluate(() => (globalThis as Bridge).pageDialog ?? null)

  /** Gives the page on screen keyboard focus, as the user's click into it would. */
  async function focusPage(): Promise<void> {
    await app.evaluate(() => {
      const view = (globalThis as MainFixture).visibleView?.()
      if (!view) throw new Error('No visible page')
      view.webContents.focus()
    })
    await expect.poll(() => visiblePage<boolean>('focused')).toBe(true)
  }

  /** Trusted input into the page on screen, the way the user's own mouse and keys arrive. */
  async function inPage(
    action:
      | { kind: 'click' | 'right-click'; selector: string; offsetX?: number }
      | { kind: 'type'; text: string }
      | { kind: 'key'; keyCode: string; modifiers?: string[] }
      | { kind: 'script'; script: string }
  ): Promise<unknown> {
    if (action.kind === 'type' || action.kind === 'key') await focusPage()
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
    const menus = () => app.evaluate(() => (globalThis as MainFixture).agentMenus?.length ?? 0)
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

  test("the page menu's Back asks before leaving unsaved changes", async () => {
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

  test("the page menu's Save Image lands through the browser's downloads, with the page as referrer", async () => {
    await navigate('/image')
    await expect
      .poll(() => inPage({ kind: 'script', script: 'document.getElementById("pic").complete' }))
      .toBe(true)
    const labels = await openPageMenu('#pic')
    expect(labels).toEqual(
      expect.arrayContaining(['Open Image in New Tab', 'Copy Image', 'Copy Image Address'])
    )
    imageReferrers.length = 0
    await choosePageMenuItem('Save Image')
    await expect.poll(() => readdirSync(downloads)).toEqual(['pixel.png'])
    expect(readFileSync(join(downloads, 'pixel.png')).equals(PNG)).toBe(true)
    expect(imageReferrers).toEqual([`${site}/image`])
  })

  test("the page menu's Open Link in New Tab sends the page as referrer", async () => {
    await navigate('/links')
    await openPageMenu('#link')
    await choosePageMenuItem('Open Link in New Tab')
    await expect.poll(() => referrers).toEqual([`${site}/links`])
  })

  test('tab keys, and history keys off macOS, typed in the page follow Chrome', async () => {
    await navigate('/one')
    await authorizer.execute(shell, SCOPE, 'browser_open_tab', { url: `${site}/two` })
    await authorizer.execute(shell, SCOPE, 'browser_open_tab', { url: `${site}/three` })
    const tabs = await shell.evaluate(
      async (scope) =>
        (await (globalThis as Bridge).simDesktop.browserAgent.activateScope(scope)).tabs,
      SCOPE
    )
    // The keys move to the strip neighbours, in whatever order the strip placed the new tabs.
    const urls = tabs.map((tab) => tab.url)
    expect([...urls].sort()).toEqual([`${site}/one`, `${site}/three`, `${site}/two`])
    const index = urls.indexOf(`${site}/one`)
    const next = urls[(index + 1) % urls.length]
    const previous = urls[(index - 1 + urls.length) % urls.length]
    await panelAction({ action: 'switch-tab', tabId: tabs[index].tabId })
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

  test('Escape stops a page that is still loading', async () => {
    await navigate('/before-slow')
    await panelAction({ action: 'navigate', url: `${site}/slow` })
    await expect.poll(() => visiblePage<boolean>('loading')).toBe(true)
    await inPage({ kind: 'key', keyCode: 'Escape' })
    await expect.poll(() => visiblePage<boolean>('loading'), { timeout: 3_000 }).toBe(false)
  })

  test("a page's fullscreen fills the browser panel and Escape leaves it", async () => {
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
