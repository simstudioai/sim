import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import type { BrowserTabsState, BrowserToolName, BrowserToolResponse } from '@sim/browser-protocol'
import { refFor } from './executor-sim'
import {
  attachBrowserPanel,
  test as base,
  type DesktopApp,
  type DesktopBridge,
  expect,
  focusFirstWindow,
  launchDesktop,
  QUIT_DEADLINE_MS,
  quitDesktop,
  serve,
  stopAndRemoveProfile,
  ToolAuthorizer,
} from './harness'

/**
 * Browser tools against the real desktop. Most tests only read and act on pages, so they share one
 * app and each gets its own provisional browser scope, disposed after the test along with its pages.
 * Tests that sign out or change the window (hide, minimize, blur, resize) launch their own app.
 */

const SCOPE = 'browser-tools-e2e'

const FORM = `<!doctype html><html><head><title>Form fixture</title></head><body>
  <label>Name <input id="name" autocomplete="off"></label>
  <label>Plan <select id="plan" aria-label="Plan"><option value="basic">Basic</option><option value="pro">Pro</option></select></label>
  <label>Regions <select id="regions" aria-label="Regions" multiple><option value="a">A</option><option value="b">B</option><option value="c" disabled>C</option></select></label>
  <label>Updates <input id="updates" type="checkbox"></label>
  <label>Date <input id="date" type="date" oninput="this.dataset.events = Number(this.dataset.events || 0) + 1"></label>
  <label>Time <input id="time" type="time"></label>
  <label>Appointment <input id="appointment" type="datetime-local"></label>
  <label>Month <input id="month" type="month"></label>
  <label>Week <input id="week" type="week"></label>
  <label>Color <input id="color" type="color"></label>
  <label>Range <input id="range" type="range"></label>
  <label>Password <input id="password" type="password"></label>
  <label>Route <input id="route" oninput="history.pushState({}, '', '/form?changed=1')"></label>
  <a href="/redirect">Other website</a>
  <div id="horizontal" role="region" aria-label="Wide table" tabindex="0" style="width:280px;overflow-x:auto">
    <div style="width:1600px;height:100px">Wide content</div>
  </div>
</body></html>`

const CLICK_FIXTURE = `<!doctype html><title>Click fixture</title>
<style>body{margin:0;height:2400px}button{position:absolute;left:100px;top:calc(100vh - 100px);width:200px;height:40px}</style>
<button id="target" role="option" onclick="document.body.dataset.clicks = Number(document.body.dataset.clicks) + 1">Choose option</button>
<script>
 document.body.dataset.clicks = '0'; document.body.dataset.scrolls = '0';
 const mode = new URLSearchParams(location.search).get('mode');
 if (mode === 'sticky') {
   document.getElementById('target').style.top = '1010px';
   document.body.insertAdjacentHTML('beforeend', '<div style="position:fixed;inset:0 0 auto;height:80px;background:white;z-index:2">Sticky header</div>');
   scrollTo(0,1000);
 }
 addEventListener('scroll', () => {
   document.body.dataset.scrolls = Number(document.body.dataset.scrolls) + 1;
   if (mode === 'menu' && document.body.dataset.armed === 'true') document.getElementById('target')?.remove();
 });
</script>`

const CAPABILITIES_FIXTURE = `<!doctype html><title>Capabilities fixture</title>
<div id="row" oncontextmenu="event.preventDefault(); document.body.dataset.menu = event.button + ':' + event.shiftKey">Report row</div>
<div id="zone" role="button" aria-label="Attach receipt">Drop a receipt<input id="receipt" type="file" hidden onchange="this.files[0].text().then(text => document.body.dataset.upload = this.files[0].name + ':' + text)"></div>
<button onclick="window.open(new URLSearchParams(location.search).get('popup'), 'auth', 'width=400,height=400')">Connect</button>
<script>addEventListener('message', (event) => { document.body.dataset.connected = event.data })</script>`

const POPUP_FIXTURE = `<!doctype html><title>Authorize fixture</title>
<button onclick="window.opener.postMessage('granted', '*'); window.close()">Allow</button>`

/** Sign-in and payment popup patterns: blank-then-navigate, and form posts into a new tab. */
const popupsFixture = (
  appOrigin: string,
  popupOrigin: string
) => `<!doctype html><title>Popups fixture</title>
<form id="same-session" method="post" action="${popupOrigin}/echo" target="_blank"><input name="note" value="hello"></form>
<form id="cross-session" method="post" action="${appOrigin}/echo" target="_blank"><input name="note" value="hello"></form>
<script>
  let popup = null;
  function signIn() {
    popup = window.open('', 'signin', 'width=400,height=400');
    document.body.dataset.handle = String(popup !== null);
    popup?.document.write('<script>opener.postMessage("ready", "*")<\\/script>');
  }
  addEventListener('message', (event) => {
    if (event.data !== 'ready') return void (document.body.dataset.connected = event.data);
    document.body.dataset.blank = 'ready';
    popup.location.href = new URLSearchParams(location.search).get('next') || '${popupOrigin}/authorize';
  });
</script>`

const echoPage = (method: string | undefined, body: string) =>
  `<!doctype html><title>${method} ${body}</title>`

const UPLOAD_TARGET_FIXTURE = `<!doctype html><title>Upload target fixture</title>
<div id="surface"></div>
<script>
  const params = new URLSearchParams(location.search);
  const surface = document.getElementById('surface');
  const root = params.get('shadow') === '1' ? surface.attachShadow({ mode: 'open' }) : surface;
  root.innerHTML = '<div role="button" aria-label="Upload original">Attach file<input id="original" type="file" hidden></div><input id="decoy" type="file" hidden>';
  const original = root.querySelector('#original');
  const decoy = root.querySelector('#decoy');
  window.uploadTestState = async () => ({
    original: await Promise.all(Array.from(original.files, async (file) => ({ name: file.name, text: await file.text() }))),
    decoy: await Promise.all(Array.from(decoy.files, async (file) => ({ name: file.name, text: await file.text() }))),
    currentCount: root.querySelector('#original').files.length,
  });
  window.mutateUploadTarget = (mutation) => {
    if (mutation === 'replace') original.replaceWith(original.cloneNode(true));
    if (mutation === 'disable') original.disabled = true;
  };
  if (params.get('steal') === '1') {
    new MutationObserver(() => {
      const marker = original.getAttribute('data-sim-agent-upload');
      if (!marker) return;
      original.removeAttribute('data-sim-agent-upload');
      decoy.setAttribute('data-sim-agent-upload', marker);
    }).observe(root, { subtree: true, attributes: true, attributeFilter: ['data-sim-agent-upload'] });
  }
</script>`

const UPLOADED = {
  original: [{ name: 'receipt.txt', text: 'receipt-bytes' }],
  decoy: [],
  currentCount: 1,
}
const NOT_UPLOADED = { original: [], decoy: [], currentCount: 0 }

const PDF =
  '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n'

const PRIVATE_CHAT =
  '<!doctype html><title>Private deployed chat</title><h1>Authenticated deployed chat</h1><label>Message <input id="message"></label><button onclick="document.getElementById(\'reply\').textContent = document.getElementById(\'message\').value">Send</button><p id="reply"></p>'
const PRIVATE_PREVIEW = `<!doctype html><title>Private HTML preview</title><h1>Authenticated HTML preview</h1><iframe sandbox="allow-scripts" srcdoc="<button onclick='document.body.dataset.clicked = true'>Test quiz</button><script>try { parent.document.body.dataset.escaped = true } catch { document.body.dataset.isolated = true }</script>"></iframe>`

const SESSION_COOKIE = 'better-auth.session_token=fixture'

/** The fixture servers every test in the file shares. */
interface ToolsSite {
  origin: string
  /** The app server as localhost: outside the app origin, so it browses in the agent partition. */
  site: string
  popupOrigin: string
  authorizer: ToolAuthorizer
  /** Requests that reached the app origin's `/echo`. */
  appEchoes: string[]
  /** Runs once before the next upload file is served, to change the page mid-staging. */
  beforeUploadResponse: (() => Promise<void>) | undefined
}

interface Shell {
  app: ElectronApplication
  shell: Page
}

interface BrowserTools extends Shell {
  scope: string
  /** Runs a tool and returns its outcome, failed or not. */
  call(tool: BrowserToolName, args?: Record<string, unknown>): Promise<BrowserToolResponse>
  /** Runs a tool and returns its result, failing the test on a tool error. */
  run(tool: BrowserToolName, args?: Record<string, unknown>): Promise<unknown>
  /** Opens `url` and returns its snapshot outline. */
  open(url: string): Promise<string>
  tabs(): Promise<BrowserTabsState>
  /**
   * Runs script with a user gesture in the page at `url` (or its query-string variants) once it
   * finished loading. Throws when no page has that URL.
   */
  inPage<T = unknown>(url: string, code: string): Promise<T>
  /** `inPage` for polling: undefined while no page has that URL. */
  pollPage<T = unknown>(url: string, code: string): Promise<T | undefined>
}

let scopeCount = 0

async function openShell(app: ElectronApplication): Promise<Page> {
  const shell = await app.firstWindow()
  await focusFirstWindow(app)
  await expect(shell.getByRole('heading')).toHaveText('Browser tools fixture')
  return shell
}

function browserTools(
  { app, shell }: Shell,
  scope: string,
  authorizer: ToolAuthorizer
): BrowserTools {
  const call = (tool: BrowserToolName, args: Record<string, unknown> = {}) => {
    const callId = authorizer.issue(scope, tool, args)
    return shell.evaluate(
      ({ callId, tool, args, scope }) =>
        (globalThis as DesktopBridge).simDesktop.browserAgent.executeTool(
          callId,
          tool,
          args,
          scope
        ),
      { callId, tool, args, scope }
    )
  }
  const run = (tool: BrowserToolName, args: Record<string, unknown> = {}) =>
    authorizer.execute(shell, scope, tool, args)
  const pageScript = (url: string, code: string, required: boolean) =>
    app.evaluate(
      async ({ webContents }, { url, code, required }) => {
        const contents = webContents
          .getAllWebContents()
          .find((page) => page.getURL() === url || page.getURL().startsWith(`${url}?`))
        if (!contents) {
          if (required) throw new Error(`No page at ${url}`)
          return undefined
        }
        if (contents.isLoading()) {
          await new Promise<void>((resolve) => contents.once('did-stop-loading', () => resolve()))
        }
        return contents.executeJavaScript(code, true)
      },
      { url, code, required }
    )
  return {
    app,
    shell,
    scope,
    call,
    run,
    async open(url) {
      const result = (await run('browser_open_url', { url })) as { snapshot: { outline: string } }
      return result.snapshot.outline
    },
    tabs: () =>
      shell.evaluate(
        (scope) => (globalThis as DesktopBridge).simDesktop.browserAgent.activateScope(scope),
        scope
      ),
    inPage: (url, code) => pageScript(url, code, true),
    pollPage: (url, code) => pageScript(url, code, false),
  }
}

const test = base.extend<
  { tools: BrowserTools; isolatedTools: BrowserTools },
  { toolsSite: ToolsSite; sharedShell: Shell }
>({
  toolsSite: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from this destructuring, and this one has none.
    async ({}, use) => {
      const fixture: ToolsSite = {
        origin: '',
        site: '',
        popupOrigin: '',
        authorizer: new ToolAuthorizer('browser-fixture'),
        appEchoes: [],
        beforeUploadResponse: undefined,
      }
      const readBody = async (request: AsyncIterable<Buffer>) => {
        let body = ''
        for await (const chunk of request) body += chunk.toString()
        return body
      }
      const appServer = await serve(async (request, response, url) => {
        if (await fixture.authorizer.handle(request, response, url)) return
        const path = url.pathname
        const signedIn = request.headers.cookie?.includes(SESSION_COOKIE) === true
        const reply = (
          status: number,
          headers: Record<string, string>,
          body: string | Buffer = ''
        ) => {
          response.writeHead(status, headers)
          response.end(body)
        }
        switch (path) {
          case '/redirect':
            return reply(302, { Location: `${fixture.site}/landing` })
          case '/enter-sim':
            return reply(302, { Location: `${fixture.origin}/private-chat` })
          case '/api/auth/get-session':
            return reply(
              200,
              { 'Content-Type': 'application/json' },
              JSON.stringify(
                signedIn
                  ? { user: { id: 'browser-auth-fixture' }, session: { id: 'fixture-session' } }
                  : null
              )
            )
          case '/api/auth/sign-out':
            return reply(
              200,
              {
                'Content-Type': 'application/json',
                'Set-Cookie':
                  'better-auth.session_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
              },
              '{}'
            )
          case '/private-chat':
          case '/private-preview':
            if (!signedIn) return reply(302, { Location: '/login' })
            return reply(
              200,
              { 'Content-Type': 'text/html' },
              path === '/private-chat' ? PRIVATE_CHAT : PRIVATE_PREVIEW
            )
          case '/api/desktop/tool/file': {
            const { toolCallId, index } = JSON.parse(await readBody(request))
            const args = fixture.authorizer.calls.get(toolCallId)?.args as
              | { paths?: unknown }
              | undefined
            const found = Array.isArray(args?.paths) && args.paths[index] === 'files/receipt.txt'
            const beforeResponse = fixture.beforeUploadResponse
            fixture.beforeUploadResponse = undefined
            try {
              await beforeResponse?.()
            } catch (error) {
              return reply(500, { 'Content-Type': 'text/plain' }, String(error))
            }
            return found
              ? reply(
                  200,
                  {
                    'Content-Type': 'application/octet-stream',
                    'Content-Disposition': 'attachment; filename="receipt.txt"',
                  },
                  'receipt-bytes'
                )
              : reply(
                  404,
                  { 'Content-Type': 'application/json' },
                  JSON.stringify({ error: 'File not found' })
                )
          }
          case '/upload-target':
            return reply(200, { 'Content-Type': 'text/html' }, UPLOAD_TARGET_FIXTURE)
          case '/upload-host': {
            const frameOrigin =
              url.searchParams.get('kind') === 'oopif' ? fixture.origin : fixture.site
            return reply(
              200,
              { 'Content-Type': 'text/html' },
              `<!doctype html><title>Upload frame fixture</title><iframe src="${frameOrigin}/upload-target" title="Upload frame"></iframe>`
            )
          }
          case '/doc.pdf':
            return reply(200, { 'Content-Type': 'application/pdf' }, PDF)
          case '/echo': {
            const body = await readBody(request)
            fixture.appEchoes.push(`${request.method} ${body}`)
            return reply(200, { 'Content-Type': 'text/html' }, echoPage(request.method, body))
          }
          case '/authorize':
            return reply(200, { 'Content-Type': 'text/html' }, POPUP_FIXTURE)
          case '/popups':
            return reply(
              200,
              { 'Content-Type': 'text/html' },
              popupsFixture(fixture.origin, fixture.popupOrigin)
            )
        }
        const page =
          path === '/click'
            ? CLICK_FIXTURE
            : path === '/capabilities'
              ? CAPABILITIES_FIXTURE
              : path === '/form'
                ? FORM
                : '<!doctype html><title>Sim fixture</title><h1>Browser tools fixture</h1>'
        reply(
          200,
          {
            'Content-Type': 'text/html',
            ...(path === '/workspace' || path === '/home' || path === '/'
              ? { 'Set-Cookie': `${SESSION_COOKIE}; HttpOnly; SameSite=Lax; Path=/` }
              : {}),
          },
          page
        )
      })
      const popupServer = await serve(async (request, response, url) => {
        response.writeHead(200, { 'Content-Type': 'text/html' })
        response.end(
          url.pathname === '/echo'
            ? echoPage(request.method, await readBody(request))
            : POPUP_FIXTURE
        )
      })
      fixture.origin = appServer.origin
      fixture.site = appServer.site
      fixture.popupOrigin = popupServer.site
      await use(fixture)
      await appServer.close()
      await popupServer.close()
    },
    { scope: 'worker' },
  ],

  sharedShell: [
    async ({ toolsSite }, use) => {
      // The `desktop` fixture is per test, so this worker-scoped app is launched and quit directly,
      // under the same deadline. A worker cannot attach files, so a stall's diagnostics go in the error.
      const userData = mkdtempSync(join(tmpdir(), 'sim-browser-tools-e2e-'))
      let desktop: DesktopApp | undefined
      let stall = ''
      try {
        desktop = await launchDesktop({
          origin: toolsSite.origin,
          userData,
          leaveDialogsToDesktop: true,
        })
        await use({ app: desktop.app, shell: await openShell(desktop.app) })
        await quitDesktop(desktop, (diagnostics) => {
          stall = diagnostics
        }).catch((error: unknown) => {
          throw new Error(`${String(error)}\n${stall}`)
        })
      } finally {
        if (desktop) await stopAndRemoveProfile(desktop.app.process(), userData)
        else rmSync(userData, { recursive: true, force: true })
      }
    },
    { scope: 'worker', timeout: 2 * QUIT_DEADLINE_MS + 30_000 },
  ],

  tools: async ({ toolsSite, sharedShell }, use) => {
    const { app, shell } = sharedShell
    const scope = `pending:browser-tools-${++scopeCount}`
    // Another test's app may have taken focus since the shared app last had it.
    await focusFirstWindow(app)
    await attachBrowserPanel(shell, scope)
    await use(browserTools(sharedShell, scope, toolsSite.authorizer))
    toolsSite.appEchoes.length = 0
    toolsSite.beforeUploadResponse = undefined
    await shell.evaluate(
      (scope) => (globalThis as DesktopBridge).simDesktop.browserAgent.disposeScope(scope),
      scope
    )
    // The next test finds its pages by URL, so this scope's pages must be gone first.
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow, webContents }) => {
          const shellId = BrowserWindow.getAllWindows()[0]?.webContents.id
          return webContents
            .getAllWebContents()
            .filter((page) => page.id !== shellId && /^https?:/.test(page.getURL()))
            .map((page) => page.getURL())
        })
      )
      .toEqual([])
  },

  isolatedTools: async ({ toolsSite, desktop }, use) => {
    const { app } = await desktop.launch({
      origin: toolsSite.origin,
      leaveDialogsToDesktop: true,
    })
    const shell = await openShell(app)
    await attachBrowserPanel(shell, SCOPE)
    await use(browserTools({ app, shell }, SCOPE, toolsSite.authorizer))
    toolsSite.appEchoes.length = 0
    toolsSite.beforeUploadResponse = undefined
  },
})

async function openForm(tools: BrowserTools, origin: string) {
  const outline = await tools.open(`${origin}/form`)
  expect(outline).toContain('Name')
  return (name: string) => refFor(outline, name)
}

function formState(tools: BrowserTools, origin: string) {
  return tools.inPage<{
    name: string
    plan: string
    updates: boolean
    password: string
    route: string
    scrollLeft: number
  }>(
    `${origin}/form`,
    `({
      name: document.getElementById('name').value,
      plan: document.getElementById('plan').value,
      updates: document.getElementById('updates').checked,
      password: document.getElementById('password').value,
      route: document.getElementById('route').value,
      scrollLeft: document.getElementById('horizontal').scrollLeft
    })`
  )
}

async function openCapabilities(tools: BrowserTools, site: ToolsSite) {
  const url = `${site.site}/capabilities?popup=${encodeURIComponent(`${site.popupOrigin}/authorize`)}`
  const outline = await tools.open(url)
  return {
    ref: (name: string) => refFor(outline, name),
    dataset: () => tools.pollPage<Record<string, string>>(url, '({ ...document.body.dataset })'),
  }
}

async function openUploadTarget(
  tools: BrowserTools,
  site: string,
  kind: 'root' | 'same-origin' | 'oopif' | 'shadow',
  steal = false
) {
  const framed = kind === 'same-origin' || kind === 'oopif'
  const url = framed
    ? `${site}/upload-host?kind=${kind}`
    : `${site}/upload-target?shadow=${kind === 'shadow' ? '1' : '0'}&steal=${steal ? '1' : '0'}`
  await tools.run('browser_open_url', { url })
  /** Runs script in the upload frame, or the top page; undefined while that frame is missing. */
  const evaluate = (expression: string, inTopFrame = false) =>
    tools.app.evaluate(
      ({ webContents }, { url, framed, expression }) => {
        const contents = webContents.getAllWebContents().find((page) => page.getURL() === url)
        if (!contents) throw new Error(`No page at ${url}`)
        const frame = framed ? contents.mainFrame.frames[0] : contents.mainFrame
        return frame?.executeJavaScript(expression)
      },
      { url, framed: framed && !inTopFrame, expression }
    )
  await expect.poll(() => evaluate('typeof window.uploadTestState')).toBe('function')
  if (kind === 'oopif') {
    expect(
      await tools.app.evaluate(({ webContents }, url) => {
        const contents = webContents.getAllWebContents().find((page) => page.getURL() === url)
        const child = contents?.mainFrame.frames[0]
        return child && child.processId !== contents?.mainFrame.processId
      }, url)
    ).toBe(true)
  }
  const { outline } = (await tools.run('browser_snapshot')) as { outline: string }
  return { elementId: refFor(outline, 'Upload original'), evaluate }
}

/** The first pixel of a screenshot, as [red, green, blue]. */
function firstPixel(app: ElectronApplication, dataUrl: string) {
  return app.evaluate(({ nativeImage }, dataUrl) => {
    const bitmap = nativeImage.createFromDataURL(dataUrl).toBitmap()
    return [bitmap[2], bitmap[1], bitmap[0]]
  }, dataUrl)
}

/** Paints the form page `color` and checks that a screenshot shows it. */
async function expectCapturedColor(
  tools: BrowserTools,
  origin: string,
  color: string,
  dominantChannel: number
) {
  await tools.inPage(
    `${origin}/form`,
    `document.body.style.background = ${JSON.stringify(color)};
    new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
  )
  const shot = (await tools.run('browser_screenshot')) as { dataUrl: string }
  const pixel = await firstPixel(tools.app, shot.dataUrl)
  expect(pixel[dominantChannel], `${color}: ${pixel}`).toBeGreaterThan(180)
  for (let channel = 0; channel < 3; channel++) {
    if (channel !== dominantChannel) {
      expect(pixel[dominantChannel] - pixel[channel], `${color}: ${pixel}`).toBeGreaterThan(80)
    }
  }
}

/** The window and form page state a screenshot must leave as it was. */
function windowState(tools: BrowserTools, origin: string) {
  return tools.app.evaluate(async ({ BrowserWindow, webContents }, origin) => {
    const win = BrowserWindow.getAllWindows()[0]
    const contents = webContents
      .getAllWebContents()
      .find((page) => page.getURL() === `${origin}/form`)
    if (!contents) throw new Error('Missing screenshot fixture')
    return {
      id: contents.id,
      visible: win.isVisible(),
      minimized: win.isMinimized(),
      bounds: win.getBounds(),
      focused: BrowserWindow.getFocusedWindow()?.id ?? null,
      page: await contents.executeJavaScript(
        "({width:innerWidth,height:innerHeight,scrollX,scrollY,html:document.body.innerHTML,focus:document.activeElement?.id,value:document.getElementById('name').value})"
      ),
    }
  }, origin)
}

/** Takes screenshots of the form page, checking each image and that nothing else changed. */
async function expectCapturesLeaveStateUnchanged(tools: BrowserTools, origin: string) {
  const before = await windowState(tools, origin)
  for (let i = 0; i < 3; i++) {
    const shot = (await tools.run('browser_screenshot')) as {
      dataUrl: string
      scale: number
      viewport: { width: number; height: number }
    }
    expect(shot.viewport.width).toBeGreaterThan(0)
    expect(shot.viewport.height).toBeGreaterThan(0)
    const image = await tools.app.evaluate(({ nativeImage }, dataUrl) => {
      const image = nativeImage.createFromDataURL(dataUrl)
      return { empty: image.isEmpty(), ...image.getSize() }
    }, shot.dataUrl)
    expect(image).toEqual({
      empty: false,
      width: Math.round(shot.viewport.width * shot.scale),
      height: Math.round(shot.viewport.height * shot.scale),
    })
    expect(await windowState(tools, origin)).toEqual(before)
  }
  return before
}

/** Blurs the window and waits until no window has focus. */
async function blurWindow(tools: BrowserTools) {
  await tools.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].blur())
  await expect
    .poll(() =>
      tools.app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id ?? null)
    )
    .toBeNull()
}

test.describe('browser tools', () => {
  test('right-clicks with modifiers reach the page', async ({ tools, toolsSite }) => {
    const { ref, dataset } = await openCapabilities(tools, toolsSite)
    await tools.run('browser_click', {
      elementId: ref('Report row'),
      button: 'right',
      modifiers: ['Shift'],
    })
    expect(await dataset()).toMatchObject({ menu: '2:true' })
  })

  test('uploads a workspace file into the hidden input behind a drop zone', async ({
    tools,
    toolsSite,
  }) => {
    const { ref, dataset } = await openCapabilities(tools, toolsSite)
    const upload = await tools.run('browser_upload_file', {
      elementId: ref('Attach receipt'),
      paths: ['files/receipt.txt'],
    })
    expect(upload).toMatchObject({
      uploaded: [{ name: 'receipt.txt', size: 13 }],
      effectObserved: true,
    })
    await expect.poll(dataset).toMatchObject({ upload: 'receipt.txt:receipt-bytes' })
  })

  test('pins uploads to the original input when page code steals a DOM marker', async ({
    tools,
    toolsSite,
  }) => {
    const { elementId, evaluate } = await openUploadTarget(tools, toolsSite.site, 'root', true)
    await tools.run('browser_upload_file', { elementId, paths: ['files/receipt.txt'] })
    expect(await evaluate('window.uploadTestState()')).toEqual(UPLOADED)
  })

  test('reports an unconfirmed upload when cancelled before Chromium acknowledgement arrives', async ({
    tools,
    toolsSite,
  }) => {
    type Held = { count: number; applied: boolean; release: () => void; restore: () => void }
    const { elementId, evaluate } = await openUploadTarget(tools, toolsSite.site, 'root')
    await tools.app.evaluate(({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((page) => page.getURL() === url)
      if (!contents) throw new Error('Missing upload acknowledgement fixture')
      const original = contents.debugger.sendCommand
      let release = () => {}
      const acknowledgement = new Promise<void>((resolve) => {
        release = resolve
      })
      const state: Held = {
        count: 0,
        applied: false,
        release,
        restore: () => {
          contents.debugger.sendCommand = original
        },
      }
      ;(
        globalThis as typeof globalThis & { heldUploadAcknowledgement?: Held }
      ).heldUploadAcknowledgement = state
      contents.debugger.sendCommand = async (method, params, sessionId) => {
        if (method !== 'DOM.setFileInputFiles') {
          return original.call(contents.debugger, method, params, sessionId)
        }
        state.count++
        const result = await original.call(contents.debugger, method, params, sessionId)
        state.applied = true
        await acknowledgement
        return result
      }
    }, `${toolsSite.site}/upload-target?shadow=0&steal=0`)
    const held = () =>
      tools.app.evaluate(() => {
        const state = (globalThis as typeof globalThis & { heldUploadAcknowledgement?: Held })
          .heldUploadAcknowledgement
        return state && { count: state.count, applied: state.applied }
      })
    const args = { elementId, paths: ['files/receipt.txt'] }
    const toolCallId = toolsSite.authorizer.issue(tools.scope, 'browser_upload_file', args)
    const pending = tools.shell.evaluate(
      ({ toolCallId, args, scope }) =>
        (globalThis as DesktopBridge).simDesktop.browserAgent.executeTool(
          toolCallId,
          'browser_upload_file',
          args,
          scope
        ),
      { toolCallId, args, scope: tools.scope }
    )
    try {
      await expect.poll(() => evaluate('window.uploadTestState()')).toEqual(UPLOADED)
      await expect.poll(held).toMatchObject({ applied: true })
      await tools.shell.evaluate(
        async ({ toolCallId, scope }) => {
          const api = (globalThis as DesktopBridge).simDesktop.browserAgent
          if (!api.cancelTool) throw new Error('Browser cancellation is unavailable')
          await api.cancelTool(toolCallId, scope)
        },
        { toolCallId, scope: tools.scope }
      )

      const upload = await pending
      expect(upload.ok, JSON.stringify(upload)).toBe(true)
      expect(upload.result).toMatchObject({
        outcomeUnknown: true,
        doNotRetry: true,
        note: expect.stringContaining('Inspect the page'),
      })
      expect(upload.result).not.toHaveProperty('dispatched', true)
      await tools.run('browser_list_tabs')
      expect(await held()).toMatchObject({ count: 1 })
    } finally {
      await tools.app.evaluate(() => {
        const globals = globalThis as typeof globalThis & { heldUploadAcknowledgement?: Held }
        globals.heldUploadAcknowledgement?.release()
        globals.heldUploadAcknowledgement?.restore()
        globals.heldUploadAcknowledgement = undefined
      })
      await pending
    }
  })

  for (const mutation of ['replace', 'disable', 'navigate-frame'] as const) {
    test(`refuses uploads when the target changes during staging: ${mutation}`, async ({
      tools,
      toolsSite,
    }) => {
      const { elementId, evaluate } = await openUploadTarget(
        tools,
        toolsSite.site,
        mutation === 'navigate-frame' ? 'same-origin' : 'root'
      )
      let mutated = false
      toolsSite.beforeUploadResponse = async () => {
        if (mutation === 'navigate-frame') {
          await evaluate('parent.previousUploadInput = document.querySelector("#original")')
          await evaluate('location.replace("/upload-target?after=1")')
          await expect.poll(() => evaluate('location.search')).toBe('?after=1')
          await expect.poll(() => evaluate('typeof window.uploadTestState')).toBe('function')
        } else {
          await evaluate(`window.mutateUploadTarget(${JSON.stringify(mutation)})`)
        }
        mutated = true
      }
      const upload = await tools.call('browser_upload_file', {
        elementId,
        paths: ['files/receipt.txt'],
      })

      expect(mutated).toBe(true)
      expect(upload.ok, JSON.stringify(upload)).toBe(false)
      expect(await evaluate('window.uploadTestState()')).toEqual(NOT_UPLOADED)
      if (mutation === 'navigate-frame') {
        expect(await evaluate('parent.previousUploadInput.files.length')).toBe(0)
      }
    })
  }

  test('refuses uploads after their same-origin frame is removed during staging', async ({
    tools,
    toolsSite,
  }) => {
    const { elementId, evaluate } = await openUploadTarget(tools, toolsSite.site, 'same-origin')
    let removed = false
    toolsSite.beforeUploadResponse = async () => {
      await evaluate(
        'window.removedUploadInput = document.querySelector("iframe").contentDocument.querySelector("#original"); document.querySelector("iframe").remove()',
        true
      )
      removed = true
    }
    const upload = await tools.call('browser_upload_file', {
      elementId,
      paths: ['files/receipt.txt'],
    })

    expect(removed).toBe(true)
    expect(upload.ok, JSON.stringify(upload)).toBe(false)
    expect(await evaluate('window.removedUploadInput.files.length', true)).toBe(0)
  })

  for (const kind of ['same-origin', 'oopif', 'shadow'] as const) {
    test(`uploads through a pinned input in a ${kind} context`, async ({ tools, toolsSite }) => {
      const { elementId, evaluate } = await openUploadTarget(tools, toolsSite.site, kind)
      const upload = await tools.run('browser_upload_file', {
        elementId,
        paths: ['files/receipt.txt'],
      })
      expect(upload).toMatchObject({ uploaded: [{ name: 'receipt.txt', size: 13 }] })
      expect(await evaluate('window.uploadTestState()')).toEqual(UPLOADED)
    })
  }

  test('keeps window.opener for page popups and returns to the opener when they close', async ({
    tools,
    toolsSite,
  }) => {
    const { ref, dataset } = await openCapabilities(tools, toolsSite)
    const popupUrl = `${toolsSite.popupOrigin}/authorize`

    await tools.run('browser_click', { elementId: ref('Connect') })
    await expect.poll(() => tools.pollPage(popupUrl, 'true')).toBe(true)
    const { outline } = (await tools.run('browser_snapshot')) as { outline: string }
    await tools.run('browser_click', { elementId: refFor(outline, 'Allow') })

    await expect.poll(dataset).toMatchObject({ connected: 'granted' })
    await expect
      .poll(async () => ((await tools.run('browser_list_tabs')) as { tabs: unknown[] }).tabs)
      .toHaveLength(1)
  })

  test('adopts a blank popup that keeps its opener and returns there when it closes', async ({
    tools,
    toolsSite,
  }) => {
    const { site, popupOrigin } = toolsSite
    const openerUrl = `${site}/popups`
    const tabUrls = async () => (await tools.tabs()).tabs.map((tab) => tab.url)
    await tools.run('browser_open_url', { url: openerUrl })
    // A second tab makes the strip neighbour differ from the opener.
    await tools.run('browser_open_tab', { url: `${site}/other` })
    const openerTabId = (await tools.tabs()).tabs.find((tab) => tab.url === openerUrl)?.tabId
    expect(openerTabId).toBeTruthy()

    await tools.inPage(openerUrl, 'signIn()')
    await expect
      .poll(() => tools.pollPage(openerUrl, '({ ...document.body.dataset })'))
      .toMatchObject({ handle: 'true', blank: 'ready' })
    await expect.poll(tabUrls).toContain(`${popupOrigin}/authorize`)
    const popupTab = (await tools.tabs()).tabs.find((tab) => tab.url === `${popupOrigin}/authorize`)
    expect(popupTab?.active).toBe(true)

    await tools.inPage(`${popupOrigin}/authorize`, "document.querySelector('button').click()")
    await expect
      .poll(() => tools.pollPage(openerUrl, '({ ...document.body.dataset })'))
      .toMatchObject({ connected: 'granted' })
    await expect.poll(async () => (await tools.tabs()).tabs.length).toBe(2)
    expect((await tools.tabs()).activeTabId).toBe(openerTabId)
  })

  test('forgets the opener once the user switches tabs, closing the popup to its neighbour', async ({
    tools,
    toolsSite,
  }) => {
    const { site, popupOrigin } = toolsSite
    const openerUrl = `${site}/popups`
    await tools.run('browser_open_url', { url: openerUrl })
    await tools.run('browser_open_tab', { url: `${site}/other` })
    const otherTabId = (await tools.tabs()).tabs.find((tab) => tab.url === `${site}/other`)?.tabId
    await tools.inPage(openerUrl, 'signIn()')
    await expect
      .poll(async () => (await tools.tabs()).tabs.map((tab) => tab.url))
      .toContain(`${popupOrigin}/authorize`)
    const popupTabId = (await tools.tabs()).tabs.find(
      (tab) => tab.url === `${popupOrigin}/authorize`
    )?.tabId
    for (const tabId of [otherTabId, popupTabId]) {
      await tools.shell.evaluate(
        ({ tabId, scope }) =>
          (globalThis as DesktopBridge).simDesktop.browserAgent.panelAction(
            { action: 'switch-tab', tabId },
            scope
          ),
        { tabId, scope: tools.scope }
      )
      await expect.poll(async () => (await tools.tabs()).activeTabId).toBe(tabId)
    }

    await tools.inPage(`${popupOrigin}/authorize`, "document.querySelector('button').click()")
    await expect
      .poll(() => tools.pollPage(openerUrl, '({ ...document.body.dataset })'))
      .toMatchObject({ connected: 'granted' })
    await expect.poll(async () => (await tools.tabs()).tabs.length).toBe(2)
    expect((await tools.tabs()).activeTabId).toBe(otherTabId)
  })

  test('keeps data: popups denied', async ({ tools, toolsSite }) => {
    const openerUrl = `${toolsSite.site}/popups`
    await tools.run('browser_open_url', { url: openerUrl })
    expect(await tools.inPage(openerUrl, "String(window.open('data:text/html,x') !== null)")).toBe(
      'false'
    )
    // The handler decides popups in order, so once this one is listed the data: popup was decided.
    await tools.inPage(openerUrl, `void window.open('${toolsSite.site}/sentinel')`)
    await expect
      .poll(async () => (await tools.tabs()).tabs.map((tab) => tab.url))
      .toContain(`${toolsSite.site}/sentinel`)
    expect((await tools.tabs()).tabs).toHaveLength(2)
  })

  test('posts a same-session form popup and refuses to reissue a cross-session one', async ({
    tools,
    toolsSite,
  }) => {
    const { site, popupOrigin } = toolsSite
    const openerUrl = `${site}/popups`
    await tools.run('browser_open_url', { url: openerUrl })
    await tools.inPage(openerUrl, "document.getElementById('same-session').requestSubmit()")
    await expect
      .poll(() => tools.pollPage(`${popupOrigin}/echo`, 'document.title'))
      .toBe('POST note=hello')

    const before = (await tools.tabs()).tabs.length
    await tools.inPage(openerUrl, "document.getElementById('cross-session').requestSubmit()")
    // The handler decides popups in order, so once this one is listed the post was decided.
    await tools.inPage(openerUrl, `void window.open('${site}/sentinel')`)
    await expect
      .poll(async () => (await tools.tabs()).tabs.map((tab) => tab.url))
      .toContain(`${site}/sentinel`)
    expect((await tools.tabs()).tabs).toHaveLength(before + 1)
    expect(toolsSite.appEchoes).toEqual([])
  })

  test('keeps the opener of a Sim page blank popup that navigates within Sim', async ({
    tools,
    toolsSite,
  }) => {
    const { origin } = toolsSite
    const openerUrl = `${origin}/popups?next=${encodeURIComponent(`${origin}/authorize`)}`
    await tools.run('browser_open_url', { url: openerUrl })
    await tools.inPage(openerUrl, 'signIn()')
    await expect
      .poll(async () => (await tools.tabs()).tabs.map((tab) => tab.url))
      .toContain(`${origin}/authorize`)
    await tools.inPage(`${origin}/authorize`, "document.querySelector('button').click()")
    await expect
      .poll(() => tools.pollPage(openerUrl, '({ ...document.body.dataset })'))
      .toMatchObject({ handle: 'true', connected: 'granted' })
  })

  test('renders PDFs in the built-in viewer', async ({ tools, toolsSite }) => {
    await tools.run('browser_open_url', { url: `${toolsSite.site}/doc.pdf` })
    await expect
      .poll(() =>
        tools.app.evaluate(
          ({ webContents }, url) =>
            webContents
              .getAllWebContents()
              .find((contents) => contents.getURL() === url)
              ?.mainFrame.framesInSubtree.some((frame) =>
                frame.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')
              ),
          `${toolsSite.site}/doc.pdf`
        )
      )
      .toBe(true)
  })

  test('shares desktop authentication for private HTML previews and deployed chats', async ({
    tools,
    toolsSite,
  }) => {
    const { origin } = toolsSite
    for (const path of ['/private-preview', '/private-chat']) {
      const result = (await tools.run('browser_open_url', { url: `${origin}${path}` })) as {
        url: string
        snapshot: { outline: string }
      }
      expect(result.url).toBe(`${origin}${path}`)
      const state = await tools.app.evaluate(async ({ webContents, BrowserWindow }, url) => {
        const host = BrowserWindow.getAllWindows()[0].webContents
        const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
        if (!page) throw new Error('Missing protected page')
        return {
          sharedSession: page.session === host.session,
          hasDesktopBridge: await page.executeJavaScript(
            'typeof window.simDesktop !== "undefined"'
          ),
          heading: await page.executeJavaScript('document.querySelector("h1").textContent'),
          escaped: await page.executeJavaScript('document.body.dataset.escaped === "true"'),
        }
      }, `${origin}${path}`)
      expect(state).toMatchObject({ sharedSession: true, hasDesktopBridge: false, escaped: false })
      expect(state.heading).toContain('Authenticated')
      if (path === '/private-preview') {
        await tools.run('browser_click', {
          elementId: refFor(result.snapshot.outline, 'Test quiz'),
        })
        const frameState = await tools.app.evaluate(async ({ webContents }, url) => {
          const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
          const frame = page?.mainFrame.frames.find((frame) => frame.url === 'about:srcdoc')
          if (!frame) throw new Error('Missing sandboxed preview')
          return frame.executeJavaScript(
            '({ clicked: document.body.dataset.clicked, isolated: document.body.dataset.isolated, bridge: typeof window.simDesktop })'
          )
        }, `${origin}${path}`)
        expect(frameState).toEqual({ clicked: 'true', isolated: 'true', bridge: 'undefined' })
      }
    }
    const outline = await tools.open(`${origin}/private-chat`)
    await tools.run('browser_type', {
      elementId: refFor(outline, 'Message'),
      text: 'Session works',
    })
    await tools.run('browser_click', { elementId: refFor(outline, 'Send') })
    await expect
      .poll(() =>
        tools.pollPage(`${origin}/private-chat`, "document.getElementById('reply').textContent")
      )
      .toBe('Session works')
  })

  test('keeps external navigation isolated and authenticates redirects back into Sim', async ({
    tools,
    toolsSite,
  }) => {
    const { origin, site } = toolsSite
    await tools.run('browser_open_url', { url: `${origin}/private-chat` })
    const result = await tools.run('browser_open_url', { url: `${origin}/redirect` })
    expect(result).toMatchObject({ url: `${site}/landing` })
    expect(
      await tools.app.evaluate(({ webContents, BrowserWindow }, url) => {
        const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
        if (!page) throw new Error(`No page at ${url}`)
        return page.session === BrowserWindow.getAllWindows()[0].webContents.session
      }, `${site}/landing`)
    ).toBe(false)
    const back = await tools.run('browser_open_url', { url: `${site}/enter-sim` })
    expect(back).toMatchObject({ url: `${origin}/private-chat` })
  })

  test('sign-out clears authenticated browser pages with the desktop session', async ({
    isolatedTools: tools,
    toolsSite,
  }) => {
    const { origin } = toolsSite
    const opened = await tools.run('browser_open_url', { url: `${origin}/private-chat` })
    expect(opened).toMatchObject({ url: `${origin}/private-chat` })
    await tools.shell.evaluate(async () => {
      await fetch('/api/auth/sign-out', { method: 'POST' })
    })
    await expect
      .poll(() =>
        tools.app.evaluate(
          ({ webContents }, url) =>
            webContents.getAllWebContents().some((contents) => contents.getURL() === url),
          `${origin}/private-chat`
        )
      )
      .toBe(false)
    await expect(tools.shell).toHaveURL(`${origin}/login`)
  })

  test('sets and clears multiple selections without partial writes for invalid options', async ({
    tools,
    toolsSite,
  }) => {
    const ref = await openForm(tools, toolsSite.origin)
    const selected = await tools.run('browser_select_option', {
      elementId: ref('Regions'),
      values: ['A', 'B'],
    })
    expect(selected).toMatchObject({
      values: ['a', 'b'],
      effectObserved: true,
      readback: { values: ['a', 'b'] },
    })
    const invalid = await tools.call('browser_select_option', {
      elementId: ref('Regions'),
      values: ['B', 'C'],
    })
    expect(invalid.ok).toBe(false)
    expect(
      await tools.inPage(
        `${toolsSite.origin}/form`,
        'Array.from(document.getElementById("regions").selectedOptions, option => option.value)'
      )
    ).toEqual(['a', 'b'])
    const cleared = await tools.run('browser_select_option', {
      elementId: ref('Regions'),
      values: [],
    })
    expect(cleared).toMatchObject({ values: [], effectObserved: true, readback: { values: [] } })
  })

  test('fills structured native fields and leaves invalid dates unchanged', async ({
    tools,
    toolsSite,
  }) => {
    const ref = await openForm(tools, toolsSite.origin)
    for (const [name, text] of [
      ['Date', '2026-09-15'],
      ['Time', '15:48'],
      ['Appointment', '2026-09-15T15:48:00'],
      ['Month', '2026-09'],
      ['Week', '2026-W38'],
      ['Color', '#AABBCC'],
      ['Range', '75'],
    ]) {
      const typed = await tools.run('browser_type', { elementId: ref(name), text })
      expect(typed).toMatchObject({ trusted: false, dispatched: true, effectObserved: true })
    }
    const invalid = await tools.call('browser_type', { elementId: ref('Date'), text: '2026-02-30' })
    expect(invalid.ok).toBe(false)
    expect(invalid.error).toContain('Invalid value')
    expect(
      await tools.inPage(
        `${toolsSite.origin}/form`,
        '({date:document.getElementById("date").value,time:document.getElementById("time").value,appointment:document.getElementById("appointment").value,month:document.getElementById("month").value,week:document.getElementById("week").value,color:document.getElementById("color").value,range:document.getElementById("range").value,events:document.getElementById("date").dataset.events})'
      )
    ).toEqual({
      date: '2026-09-15',
      time: '15:48',
      appointment: '2026-09-15T15:48',
      month: '2026-09',
      week: '2026-W38',
      color: '#aabbcc',
      range: '75',
      events: '1',
    })
  })

  for (const mode of ['menu', 'sticky']) {
    test(`clicks a ${mode} target without losing its identity`, async ({ tools, toolsSite }) => {
      const url = `${toolsSite.origin}/click?mode=${mode}`
      await tools.run('browser_open_url', { url })
      await tools.inPage(
        url,
        `history.scrollRestoration = 'manual';
        document.getElementById('target').style.top = ${mode === 'sticky' ? '1010' : 'innerHeight - 100'} + 'px';
        scrollTo(0, ${mode === 'sticky' ? '1000' : '0'});
        new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
          document.body.dataset.scrolls = '0'; document.body.dataset.armed = 'true'; resolve();
        })))`
      )
      const { outline } = (await tools.run('browser_snapshot')) as { outline: string }
      await tools.run('browser_click', { elementId: refFor(outline, 'Choose option') })
      const state = await tools.inPage<{ clicks: string; scrolls: string; scrollY: number }>(
        url,
        '({clicks:document.body.dataset.clicks,scrolls:document.body.dataset.scrolls,scrollY})'
      )
      expect(state.clicks).toBe('1')
      if (mode === 'menu') expect(state).toMatchObject({ scrolls: '0', scrollY: 0 })
      else expect(state.scrollY).toBeLessThan(1000)
    })
  }

  test('captures fresh pixels after a resize and recovers a permanently pending native capture without losing the page', async ({
    isolatedTools: tools,
    toolsSite,
  }) => {
    const { origin } = toolsSite
    await openForm(tools, origin)
    const viewportWidth = () => tools.inPage(`${origin}/form`, 'innerWidth')
    const beforeWidth = await viewportWidth()
    await tools.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1280, 900)
    )
    await expect.poll(viewportWidth).not.toBe(beforeWidth)
    await expectCapturedColor(tools, origin, 'rgb(240, 20, 30)', 0)
    await expectCapturedColor(tools, origin, 'rgb(30, 40, 230)', 2)

    const before = await tools.app.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((page) => page.getURL() === url)
      if (!contents) throw new Error('Missing capture fixture')
      await contents.executeJavaScript(`
        document.getElementById('name').value = 'Unsaved work';
        document.getElementById('name').focus();
      `)
      contents.capturePage = () => new Promise(() => {})
      return { id: contents.id, url: contents.getURL() }
    }, `${origin}/form`)
    for (const [color, dominantChannel] of [
      ['rgb(240, 20, 30)', 0],
      ['rgb(30, 40, 230)', 2],
      ['rgb(20, 220, 50)', 1],
    ] as const) {
      await expectCapturedColor(tools, origin, color, dominantChannel)
    }
    const after = await tools.app.evaluate(async ({ webContents }, id) => {
      const contents = webContents.fromId(id)
      if (!contents) throw new Error('Capture fixture was replaced')
      return {
        id: contents.id,
        url: contents.getURL(),
        page: await contents.executeJavaScript(
          `({value:document.getElementById('name').value,focus:document.activeElement.id})`
        ),
      }
    }, before.id)
    expect(after).toEqual({ ...before, page: { value: 'Unsaved work', focus: 'name' } })
  })

  test('maps a fractional narrow crop back to its actual viewport position', async ({
    tools,
    toolsSite,
  }) => {
    const formUrl = `${toolsSite.origin}/form`
    await openForm(tools, toolsSite.origin)
    const target = await tools.inPage<{
      x: number
      y: number
      width: number
      height: number
      devicePixelRatio: number
    }>(
      formUrl,
      `const button = document.createElement('button');
      button.textContent = 'Narrow target';
      button.style.cssText = 'position:absolute;left:20.1px;top:60.1px;width:1.1px;height:100px;padding:0;border:0;overflow:hidden';
      button.onclick = () => { document.body.dataset.cropClicks = Number(document.body.dataset.cropClicks || 0) + 1 };
      document.body.append(button);
      const rect = button.getBoundingClientRect();
      ({x:rect.x,y:rect.y,width:rect.width,height:rect.height,devicePixelRatio});`
    )
    const { outline } = (await tools.run('browser_snapshot')) as { outline: string }
    const shot = (await tools.run('browser_screenshot', {
      elementId: refFor(outline, 'Narrow target'),
    })) as {
      imageSize: { width: number; height: number }
      clip: { x: number; y: number; width: number; height: number }
      scale: number
    }
    expect(shot.clip.x).toBeLessThanOrEqual(target.x)
    expect(shot.clip.y).toBeLessThanOrEqual(target.y)
    expect(shot.clip.x + shot.clip.width).toBeGreaterThanOrEqual(target.x + target.width)
    expect(shot.clip.y + shot.clip.height).toBeGreaterThanOrEqual(target.y + target.height)
    expect(target.x - shot.clip.x).toBeLessThan(1 / target.devicePixelRatio)
    expect(target.y - shot.clip.y).toBeLessThan(1 / target.devicePixelRatio)
    expect(shot.scale).toBeCloseTo(shot.imageSize.width / shot.clip.width)
    await tools.run('browser_click_at', {
      x: shot.clip.x + shot.clip.width / 2,
      y: shot.clip.y + shot.clip.height / 2,
    })
    expect(await tools.inPage(formUrl, 'document.body.dataset.cropClicks')).toBe('1')
  })

  for (const mode of ['hidden', 'minimized'] as const) {
    test(`captures a ${mode} window without changing its state, and recovers a stalled capture after restoring it`, async ({
      isolatedTools: tools,
      toolsSite,
    }) => {
      const { origin } = toolsSite
      await openForm(tools, origin)
      await tools.inPage(`${origin}/form`, "document.getElementById('name').value = 'Unsaved work'")
      await blurWindow(tools)
      await tools.app.evaluate(async ({ BrowserWindow }, mode) => {
        const win = BrowserWindow.getAllWindows()[0]
        if (mode === 'hidden') win.hide()
        else {
          const minimized = new Promise<void>((resolve) => win.once('minimize', resolve))
          win.minimize()
          await minimized
        }
      }, mode)

      const before = await expectCapturesLeaveStateUnchanged(tools, origin)

      await tools.app.evaluate(({ webContents }, url) => {
        const contents = webContents.getAllWebContents().find((page) => page.getURL() === url)
        if (!contents) throw new Error('Missing capture fixture')
        contents.capturePage = () => new Promise(() => {})
      }, `${origin}/form`)
      const start = Date.now()
      const stalled = await tools.call('browser_screenshot')
      expect(Date.now() - start).toBeLessThan(12_000)
      if (!stalled.ok) expect(stalled.error).toContain('Screenshot frame capture timed out')
      expect(await windowState(tools, origin)).toEqual(before)

      await tools.app.evaluate(({ BrowserWindow }, mode) => {
        const win = BrowserWindow.getAllWindows()[0]
        if (mode === 'minimized') win.restore()
        else win.showInactive()
      }, mode)
      await expect
        .poll(() =>
          tools.app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()[0]
            return !win.isMinimized() && win.isVisible()
          })
        )
        .toBe(true)
      for (let attempt = 0; attempt < 2; attempt++) await tools.run('browser_screenshot')
      expect(await windowState(tools, origin)).toMatchObject({
        id: before.id,
        page: { value: 'Unsaved work' },
      })
    })
  }

  test('captures a visible window without changing its state', async ({
    isolatedTools: tools,
    toolsSite,
  }) => {
    await openForm(tools, toolsSite.origin)
    await blurWindow(tools)
    await expectCapturesLeaveStateUnchanged(tools, toolsSite.origin)
  })

  test('opens with references, fills in order, and scrolls a horizontal pane', async ({
    tools,
    toolsSite,
  }) => {
    const { origin } = toolsSite
    const ref = await openForm(tools, origin)
    const fill = await tools.run('browser_fill_form', {
      fields: [
        { elementId: ref('Name'), kind: 'text', text: 'Example User' },
        { elementId: ref('Plan'), kind: 'select', value: 'pro' },
        { elementId: ref('Updates'), kind: 'checked', checked: true },
      ],
    })
    expect(fill, JSON.stringify(fill)).toMatchObject({ completed: true, completedCount: 3 })
    expect(await formState(tools, origin)).toMatchObject({
      name: 'Example User',
      plan: 'pro',
      updates: true,
    })
    const cleared = await tools.run('browser_fill_form', {
      fields: [{ elementId: ref('Name'), kind: 'text', text: '' }],
    })
    expect(cleared, JSON.stringify(cleared)).toMatchObject({ completed: true })
    expect(await formState(tools, origin)).toMatchObject({ name: '' })

    const scroll = await tools.run('browser_scroll', {
      direction: 'right',
      amount: 240,
      elementId: ref('Wide table'),
    })
    expect(scroll).toMatchObject({ movedBy: 240 })
    expect(Math.round((await formState(tools, origin)).scrollLeft)).toBe(240)
    await tools.run('browser_scroll', {
      direction: 'left',
      amount: 240,
      elementId: ref('Wide table'),
    })
    expect(await formState(tools, origin)).toMatchObject({ scrollLeft: 0 })
  })

  test('batches an action with a fresh observation without replaying form fields', async ({
    tools,
    toolsSite,
  }) => {
    const { origin } = toolsSite
    const ref = await openForm(tools, origin)
    const fill = (await tools.run('browser_fill_form', {
      fields: [{ elementId: ref('Name'), kind: 'text', text: 'Observed value' }],
      observe: { query: 'Name' },
    })) as { observation: { result: { matches: { elementId: number }[] } } }
    expect(fill).toMatchObject({
      completed: true,
      completedCount: 1,
      observation: { ok: true, result: { totalMatches: 1 } },
    })
    expect(await formState(tools, origin)).toMatchObject({ name: 'Observed value' })
    const freshId = fill.observation.result.matches[0].elementId
    expect(freshId).toBe(ref('Name'))
    const clear = await tools.run('browser_type', { elementId: freshId, text: '', observe: {} })
    expect(clear).toMatchObject({ observation: { ok: true } })
    expect(await formState(tools, origin)).toMatchObject({ name: '' })
  })

  test('stops after a route change without writing the next field', async ({
    tools,
    toolsSite,
  }) => {
    const { origin } = toolsSite
    const ref = await openForm(tools, origin)
    const fill = await tools.call('browser_fill_form', {
      fields: [
        { elementId: ref('Route'), kind: 'text', text: 'change route' },
        { elementId: ref('Name'), kind: 'text', text: 'Must not be written' },
      ],
    })
    expect(fill.result, JSON.stringify(fill)).toMatchObject({ completed: false, doNotRetry: true })
    expect(await formState(tools, origin)).toMatchObject({ name: '', route: 'change route' })
  })

  test('follows a link and cross-origin redirect without a website approval prompt', async ({
    tools,
    toolsSite,
  }) => {
    const { origin, site } = toolsSite
    await openForm(tools, origin)
    await tools.inPage(`${origin}/form`, "document.querySelector('a').click()")
    await expect.poll(() => tools.pollPage(`${site}/landing`, 'true')).toBe(true)
    expect(
      await tools.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    ).toBe(1)
    await expect(tools.shell.getByRole('heading')).toHaveText('Browser tools fixture')
  })

  test('stops when a new popup exceeds the page summary limit', async ({ tools, toolsSite }) => {
    const { origin } = toolsSite
    const ref = await openForm(tools, origin)
    await tools.inPage(
      `${origin}/form`,
      `for (let index = 0; index < 10; index++) {
        const toolbar = document.createElement('div')
        toolbar.setAttribute('role', 'toolbar')
        toolbar.textContent = 'Toolbar ' + index
        document.body.append(toolbar)
      }
      document.getElementById('name').addEventListener('input', () => {
        const popup = document.createElement('div')
        popup.setAttribute('role', 'listbox')
        popup.textContent = 'Suggestions'
        document.body.append(popup)
      }, { once: true })`
    )

    const fill = await tools.run('browser_fill_form', {
      fields: [
        { elementId: ref('Name'), kind: 'text', text: 'Example User' },
        { elementId: ref('Plan'), kind: 'select', value: 'pro' },
      ],
    })
    expect(fill, JSON.stringify(fill)).toMatchObject({
      completed: false,
      completedCount: 1,
      stoppedIndex: 0,
      results: [{ verified: true, valuePreview: 'Example User' }],
      doNotRetry: true,
      error: expect.stringContaining('could not be fully verified'),
    })
    expect(await formState(tools, origin)).toMatchObject({ name: 'Example User', plan: 'basic' })
  })

  test('refuses credential fields and leaves subsequent fields untouched', async ({
    tools,
    toolsSite,
  }) => {
    const { origin } = toolsSite
    const ref = await openForm(tools, origin)
    const fill = await tools.call('browser_fill_form', {
      fields: [
        { elementId: ref('Password'), kind: 'text', text: 'must-not-be-entered' },
        { elementId: ref('Name'), kind: 'text', text: 'Must not be written' },
      ],
    })
    expect(fill.result).toMatchObject({ completed: false, completedCount: 0 })
    expect(await formState(tools, origin)).toMatchObject({ name: '', password: '' })
  })
})
