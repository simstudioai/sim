import { mkdtempSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
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
import type { BrowserToolName } from '@sim/browser-protocol'
import type { SimDesktopApi } from '@sim/desktop-bridge'

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))
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
<button id="delete" onclick="document.body.dataset.deleted = confirm('Delete the report?')">Delete report</button>
<div id="row" oncontextmenu="event.preventDefault(); document.body.dataset.menu = event.button + ':' + event.shiftKey">Report row</div>
<div id="zone" role="button" aria-label="Attach receipt">Drop a receipt<input id="receipt" type="file" hidden onchange="this.files[0].text().then(text => document.body.dataset.upload = this.files[0].name + ':' + text)"></div>
<button onclick="window.open(new URLSearchParams(location.search).get('popup'), 'auth', 'width=400,height=400')">Connect</button>
<script>addEventListener('message', (event) => { document.body.dataset.connected = event.data })</script>`

const POPUP_FIXTURE = `<!doctype html><title>Authorize fixture</title>
<button onclick="window.opener.postMessage('granted', '*'); window.close()">Allow</button>`

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

test.describe('browser tools', () => {
  const calls = new Map<
    string,
    { chatId: string; toolName: BrowserToolName | 'terminal'; args: Record<string, unknown> }
  >()
  const claimed = new Map<string, { args: Record<string, unknown> }>()
  let server: Server
  let popupServer: Server
  let origin: string
  let site: string
  let popupOrigin: string
  let app: ElectronApplication
  let window: Page
  let callCount = 0
  let beforeUploadResponse: (() => Promise<void>) | undefined

  test.beforeAll(async () => {
    server = createServer(async (request, response) => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      if (path === '/redirect') {
        response.writeHead(302, { Location: `${origin.replace('127.0.0.1', 'localhost')}/landing` })
        response.end()
        return
      }
      if (path === '/enter-sim') {
        response.writeHead(302, { Location: `${origin}/private-chat` })
        response.end()
        return
      }
      if (path === '/api/auth/get-session') {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify(
            request.headers.cookie?.includes('better-auth.session_token=fixture')
              ? { user: { id: 'browser-auth-fixture' }, session: { id: 'fixture-session' } }
              : null
          )
        )
        return
      }
      if (path === '/api/auth/sign-out') {
        response.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': 'better-auth.session_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
        })
        response.end('{}')
        return
      }
      if (path === '/private-chat' || path === '/private-preview') {
        if (!request.headers.cookie?.includes('better-auth.session_token=fixture')) {
          response.writeHead(302, { Location: '/login' })
          response.end()
          return
        }
        response.writeHead(200, { 'Content-Type': 'text/html' })
        response.end(
          path === '/private-chat'
            ? '<!doctype html><title>Private deployed chat</title><h1>Authenticated deployed chat</h1><label>Message <input id="message"></label><button onclick="document.getElementById(\'reply\').textContent = document.getElementById(\'message\').value">Send</button><p id="reply"></p>'
            : `<!doctype html><title>Private HTML preview</title><h1>Authenticated HTML preview</h1><iframe sandbox="allow-scripts" srcdoc="<button onclick='document.body.dataset.clicked = true'>Test quiz</button><script>try { parent.document.body.dataset.escaped = true } catch { document.body.dataset.isolated = true }</script>"></iframe>`
        )
        return
      }
      if (path === '/api/desktop/tool/file') {
        let body = ''
        for await (const chunk of request) body += chunk.toString()
        const { toolCallId, index } = JSON.parse(body)
        const reference = claimed.get(toolCallId)?.args.paths
        const found = Array.isArray(reference) && reference[index] === 'files/receipt.txt'
        const beforeResponse = beforeUploadResponse
        beforeUploadResponse = undefined
        try {
          await beforeResponse?.()
        } catch (error) {
          response.writeHead(500, { 'Content-Type': 'text/plain' })
          response.end(String(error))
          return
        }
        response.writeHead(found ? 200 : 404, {
          'Content-Type': found ? 'application/octet-stream' : 'application/json',
          ...(found ? { 'Content-Disposition': 'attachment; filename="receipt.txt"' } : {}),
        })
        response.end(found ? 'receipt-bytes' : JSON.stringify({ error: 'File not found' }))
        return
      }
      if (path === '/upload-target' || path === '/upload-host') {
        const params = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams
        const frameOrigin = params.get('kind') === 'oopif' ? origin : site
        response.writeHead(200, { 'Content-Type': 'text/html' })
        response.end(
          path === '/upload-target'
            ? UPLOAD_TARGET_FIXTURE
            : `<!doctype html><title>Upload frame fixture</title><iframe src="${frameOrigin}/upload-target" title="Upload frame"></iframe>`
        )
        return
      }
      if (path === '/doc.pdf') {
        response.writeHead(200, { 'Content-Type': 'application/pdf' })
        response.end(
          '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n'
        )
        return
      }
      if (path === '/api/desktop/tool/authorize') {
        let body = ''
        for await (const chunk of request) body += chunk.toString()
        const authorization = calls.get(JSON.parse(body).toolCallId)
        calls.delete(JSON.parse(body).toolCallId)
        if (authorization) claimed.set(JSON.parse(body).toolCallId, authorization)
        response.writeHead(authorization ? 200 : 403, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify(authorization ?? {}))
        return
      }
      response.writeHead(200, {
        'Content-Type': 'text/html',
        ...(path === '/workspace' || path === '/home' || path === '/'
          ? { 'Set-Cookie': 'better-auth.session_token=fixture; HttpOnly; SameSite=Lax; Path=/' }
          : {}),
      })
      response.end(
        path === '/click'
          ? CLICK_FIXTURE
          : path === '/capabilities'
            ? CAPABILITIES_FIXTURE
            : path === '/form'
              ? FORM
              : '<!doctype html><title>Sim fixture</title><h1>Browser tools fixture</h1>'
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    origin = `http://127.0.0.1:${address.port}`
    /** Pages outside the app origin browse in the agent partition, like any third-party site. */
    site = origin.replace('127.0.0.1', 'localhost')
    popupServer = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end(POPUP_FIXTURE)
    })
    await new Promise<void>((resolve) => popupServer.listen(0, '127.0.0.1', resolve))
    const popupAddress = popupServer.address()
    if (!popupAddress || typeof popupAddress === 'string') throw new Error('Missing popup address')
    popupOrigin = `http://localhost:${popupAddress.port}`
  })

  test.beforeEach(async () => {
    app = await electron.launch({
      args: [process.env.SIM_DESKTOP_E2E_MAIN ?? '.'],
      cwd: DESKTOP_DIR,
      env: {
        ...process.env,
        SIM_DESKTOP_ORIGIN: origin,
        SIM_DESKTOP_USER_DATA: mkdtempSync(join(tmpdir(), 'sim-browser-tools-e2e-')),
      },
    })
    // A dialog listener stops Playwright auto-dismissing page dialogs, so the desktop's own CDP
    // dialog handling decides their outcome exactly as it does in production.
    const leaveDialogsToDesktop = (page: Page) => page.on('dialog', () => {})
    app.context().pages().forEach(leaveDialogsToDesktop)
    app.context().on('page', leaveDialogsToDesktop)
    window = await app.firstWindow()
    await app.evaluate(({ app, BrowserWindow }) => {
      const host = BrowserWindow.getAllWindows()[0]
      host.webContents.setBackgroundThrottling(false)
      app.focus({ steal: true })
      host.focus()
    })
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()))
      .toBe(true)
    await expect(window.getByRole('heading')).toHaveText('Browser tools fixture')
    await window.evaluate(async (scope) => {
      const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
      await api.browserAgent.activateScope(scope)
      const updateBounds = () =>
        api.browserAgent.setPanelBounds(
          { x: 0, y: 80, width: innerWidth, height: innerHeight - 80 },
          null,
          scope
        )
      updateBounds()
      setInterval(updateBounds, 200)
    }, SCOPE)
  })

  test.afterEach(async () => {
    beforeUploadResponse = undefined
    await app?.close()
    calls.clear()
    claimed.clear()
  })

  test.afterAll(async () => {
    for (const listener of [server, popupServer]) {
      await new Promise<void>((resolve, reject) =>
        listener.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })

  async function execute(tool: BrowserToolName, args: Record<string, unknown>) {
    const callId = `browser-fixture-${++callCount}`
    calls.set(callId, { chatId: SCOPE, toolName: tool, args })
    return window.evaluate(
      async ({ callId, tool, args, scope }) => {
        const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
        return api.browserAgent.executeTool(callId, tool, args, scope)
      },
      { callId, tool, args, scope: SCOPE }
    )
  }

  async function openForm() {
    const response = await execute('browser_open_url', { url: `${origin}/form` })
    expect(response.ok, response.error).toBe(true)
    const result = response.result as { snapshot: { outline: string } }
    expect(result.snapshot.outline).toContain('Name')
    return (name: string) => {
      const line = result.snapshot.outline
        .split('\n')
        .find((line) => line.includes(`"${name}"`) && /\[ref=\d+\]/.test(line))
      const match = line?.match(/\[ref=(\d+)\]/)
      if (!match) throw new Error(`No reference for ${name}: ${result.snapshot.outline}`)
      return Number(match[1])
    }
  }

  async function openCapabilities() {
    const url = `${site}/capabilities?popup=${encodeURIComponent(`${popupOrigin}/authorize`)}`
    const response = await execute('browser_open_url', { url })
    expect(response.ok, response.error).toBe(true)
    const outline = (response.result as { snapshot: { outline: string } }).snapshot.outline
    const ref = (name: string) => {
      const match = outline
        .split('\n')
        .find((line) => line.includes(`"${name}"`) && /\[ref=\d+\]/.test(line))
        ?.match(/\[ref=(\d+)\]/)
      if (!match) throw new Error(`No reference for ${name}: ${outline}`)
      return Number(match[1])
    }
    const dataset = () =>
      app.evaluate(
        ({ webContents }, url) =>
          webContents
            .getAllWebContents()
            .find((contents) => contents.getURL() === url)
            ?.executeJavaScript('({ ...document.body.dataset })'),
        url
      )
    return { ref, dataset }
  }

  test('answers confirm dialogs only when the action asks and right-clicks reach the page', async () => {
    const { ref, dataset } = await openCapabilities()

    const dismissed = await execute('browser_click', { elementId: ref('Delete report') })
    expect(JSON.stringify(dismissed.result)).toContain('which was dismissed')
    expect(await dataset()).toMatchObject({ deleted: 'false' })

    const accepted = await execute('browser_click', {
      elementId: ref('Delete report'),
      dialog: { accept: true },
    })
    expect(JSON.stringify(accepted.result)).toContain('accepted as requested')
    expect(await dataset()).toMatchObject({ deleted: 'true' })

    const menu = await execute('browser_click', {
      elementId: ref('Report row'),
      button: 'right',
      modifiers: ['Shift'],
    })
    expect(menu.ok, menu.error).toBe(true)
    expect(await dataset()).toMatchObject({ menu: '2:true' })
  })

  test('uploads a workspace file into the hidden input behind a drop zone', async () => {
    const { ref, dataset } = await openCapabilities()

    const upload = await execute('browser_upload_file', {
      elementId: ref('Attach receipt'),
      paths: ['files/receipt.txt'],
    })

    expect(upload.ok, upload.error).toBe(true)
    expect(upload.result).toMatchObject({
      uploaded: [{ name: 'receipt.txt', size: 13 }],
      effectObserved: true,
    })
    await expect.poll(dataset).toMatchObject({ upload: 'receipt.txt:receipt-bytes' })
  })

  async function openUploadTarget(
    kind: 'root' | 'same-origin' | 'oopif' | 'shadow',
    steal = false
  ) {
    const framed = kind === 'same-origin' || kind === 'oopif'
    const url = framed
      ? `${site}/upload-host?kind=${kind}`
      : `${site}/upload-target?shadow=${kind === 'shadow' ? '1' : '0'}&steal=${steal ? '1' : '0'}`
    const response = await execute('browser_open_url', { url })
    expect(response.ok, response.error).toBe(true)
    const evaluate = (expression: string, inTopFrame = false) =>
      app.evaluate(
        ({ webContents }, { url, framed, expression }) => {
          const contents = webContents
            .getAllWebContents()
            .find((contents) => contents.getURL() === url)
          const frame = framed ? contents?.mainFrame.frames[0] : contents?.mainFrame
          if (!frame) throw new Error('Missing upload fixture frame')
          return frame.executeJavaScript(expression)
        },
        { url, framed: framed && !inTopFrame, expression }
      )
    await expect.poll(() => evaluate('typeof window.uploadTestState')).toBe('function')
    if (kind === 'oopif') {
      expect(
        await app.evaluate(({ webContents }, url) => {
          const contents = webContents
            .getAllWebContents()
            .find((contents) => contents.getURL() === url)
          const child = contents?.mainFrame.frames[0]
          return child && child.processId !== contents?.mainFrame.processId
        }, url)
      ).toBe(true)
    }
    const snapshot = await execute('browser_snapshot', {})
    expect(snapshot.ok, snapshot.error).toBe(true)
    const outline = (snapshot.result as { outline: string }).outline
    const match = outline
      .split('\n')
      .find((line) => line.includes('"Upload original"'))
      ?.match(/\[ref=(\d+)\]/)
    expect(match, outline).toBeTruthy()
    return { elementId: Number(match?.[1]), evaluate }
  }

  test('pins uploads to the original input when page code steals a DOM marker', async () => {
    const { elementId, evaluate } = await openUploadTarget('root', true)
    const upload = await execute('browser_upload_file', { elementId, paths: ['files/receipt.txt'] })

    expect(upload.ok, upload.error).toBe(true)
    expect(await evaluate('window.uploadTestState()')).toEqual({
      original: [{ name: 'receipt.txt', text: 'receipt-bytes' }],
      decoy: [],
      currentCount: 1,
    })
  })

  test('reports an unconfirmed upload when cancelled before Chromium acknowledgement arrives', async () => {
    const { elementId, evaluate } = await openUploadTarget('root')
    await app.evaluate(({ webContents }, site) => {
      const contents = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL() === `${site}/upload-target?shadow=0&steal=0`)
      if (!contents) throw new Error('Missing upload acknowledgement fixture')
      const original = contents.debugger.sendCommand
      let release = () => {}
      const acknowledgement = new Promise<void>((resolve) => {
        release = resolve
      })
      const state = {
        count: 0,
        applied: false,
        release,
        restore: () => {
          contents.debugger.sendCommand = original
        },
      }
      const globals = globalThis as typeof globalThis & { heldUploadAcknowledgement?: typeof state }
      globals.heldUploadAcknowledgement = state
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
    }, site)
    const pending = execute('browser_upload_file', { elementId, paths: ['files/receipt.txt'] })
    const toolCallId = `browser-fixture-${callCount}`
    try {
      await expect
        .poll(() => evaluate('window.uploadTestState()'))
        .toEqual({
          original: [{ name: 'receipt.txt', text: 'receipt-bytes' }],
          decoy: [],
          currentCount: 1,
        })
      await expect
        .poll(() =>
          app.evaluate(
            () =>
              (
                globalThis as typeof globalThis & {
                  heldUploadAcknowledgement?: { applied: boolean }
                }
              ).heldUploadAcknowledgement?.applied
          )
        )
        .toBe(true)
      await window.evaluate(
        async ({ toolCallId, scope }) => {
          const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
          if (!api.browserAgent.cancelTool) throw new Error('Browser cancellation is unavailable')
          await api.browserAgent.cancelTool(toolCallId, scope)
        },
        { toolCallId, scope: SCOPE }
      )

      const upload = await pending
      expect(upload.ok, JSON.stringify(upload)).toBe(true)
      expect(upload.result).toMatchObject({
        outcomeUnknown: true,
        doNotRetry: true,
        note: expect.stringContaining('Inspect the page'),
      })
      expect(upload.result).not.toHaveProperty('dispatched', true)
      expect((await execute('browser_list_tabs', {})).ok).toBe(true)
      expect(
        await app.evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                heldUploadAcknowledgement?: { count: number }
              }
            ).heldUploadAcknowledgement?.count
        )
      ).toBe(1)
    } finally {
      await app.evaluate(() => {
        const globals = globalThis as typeof globalThis & {
          heldUploadAcknowledgement?: { release: () => void; restore: () => void }
        }
        globals.heldUploadAcknowledgement?.release()
        globals.heldUploadAcknowledgement?.restore()
        globals.heldUploadAcknowledgement = undefined
      })
      await pending
    }
  })

  for (const mutation of ['replace', 'disable', 'navigate-frame'] as const) {
    test(`refuses uploads when the target changes during staging: ${mutation}`, async () => {
      const { elementId, evaluate } = await openUploadTarget(
        mutation === 'navigate-frame' ? 'same-origin' : 'root'
      )
      let mutated = false
      beforeUploadResponse = async () => {
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
      const upload = await execute('browser_upload_file', {
        elementId,
        paths: ['files/receipt.txt'],
      })

      expect(mutated).toBe(true)
      expect(upload.ok, JSON.stringify(upload)).toBe(false)
      expect(await evaluate('window.uploadTestState()')).toEqual({
        original: [],
        decoy: [],
        currentCount: 0,
      })
      if (mutation === 'navigate-frame') {
        expect(await evaluate('parent.previousUploadInput.files.length')).toBe(0)
      }
    })
  }

  test('refuses uploads after their same-origin frame is removed during staging', async () => {
    const { elementId, evaluate } = await openUploadTarget('same-origin')
    let removed = false
    beforeUploadResponse = async () => {
      await evaluate(
        'window.removedUploadInput = document.querySelector("iframe").contentDocument.querySelector("#original"); document.querySelector("iframe").remove()',
        true
      )
      removed = true
    }
    const upload = await execute('browser_upload_file', {
      elementId,
      paths: ['files/receipt.txt'],
    })

    expect(removed).toBe(true)
    expect(upload.ok, JSON.stringify(upload)).toBe(false)
    expect(await evaluate('window.removedUploadInput.files.length', true)).toBe(0)
  })

  for (const kind of ['same-origin', 'oopif', 'shadow'] as const) {
    test(`uploads through a pinned input in a ${kind} context`, async () => {
      const { elementId, evaluate } = await openUploadTarget(kind)
      const upload = await execute('browser_upload_file', {
        elementId,
        paths: ['files/receipt.txt'],
      })

      expect(upload.ok, upload.error).toBe(true)
      expect(upload.result).toMatchObject({ uploaded: [{ name: 'receipt.txt', size: 13 }] })
      expect(await evaluate('window.uploadTestState()')).toEqual({
        original: [{ name: 'receipt.txt', text: 'receipt-bytes' }],
        decoy: [],
        currentCount: 1,
      })
    })
  }

  test('keeps window.opener for page popups and returns to the opener when they close', async () => {
    const { ref, dataset } = await openCapabilities()

    expect((await execute('browser_click', { elementId: ref('Connect') })).ok).toBe(true)
    const popup = await execute('browser_snapshot', {})
    const allow = (popup.result as { outline: string }).outline.match(
      /button "Allow" \[ref=(\d+)\]/
    )?.[1]
    expect(allow, JSON.stringify(popup.result)).toBeTruthy()
    expect((await execute('browser_click', { elementId: Number(allow) })).ok).toBe(true)

    await expect.poll(dataset).toMatchObject({ connected: 'granted' })
    await expect
      .poll(
        async () => ((await execute('browser_list_tabs', {})).result as { tabs: unknown[] }).tabs
      )
      .toHaveLength(1)
  })

  test('renders PDFs in the built-in viewer', async () => {
    const response = await execute('browser_open_url', { url: `${site}/doc.pdf` })
    expect(response.ok, response.error).toBe(true)

    await expect
      .poll(() =>
        app.evaluate(
          ({ webContents }, url) =>
            webContents
              .getAllWebContents()
              .find((contents) => contents.getURL() === url)
              ?.mainFrame.framesInSubtree.some((frame) =>
                frame.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')
              ),
          `${site}/doc.pdf`
        )
      )
      .toBe(true)
  })

  test('shares desktop authentication for private HTML previews and deployed chats', async () => {
    for (const path of ['/private-preview', '/private-chat']) {
      const result = await execute('browser_open_url', { url: `${origin}${path}` })
      expect(result.ok, result.error).toBe(true)
      expect(result.result).toMatchObject({ url: `${origin}${path}` })
      const state = await app.evaluate(async ({ webContents, BrowserWindow }, url) => {
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
      expect(state.sharedSession).toBe(true)
      expect(state.hasDesktopBridge).toBe(false)
      expect(state.heading).toContain('Authenticated')
      expect(state.escaped).toBe(false)
      if (path === '/private-preview') {
        const outline = (result.result as { snapshot: { outline: string } }).snapshot.outline
        const button = outline
          .split('\n')
          .find((line) => line.includes('"Test quiz"') && /\[ref=\d+\]/.test(line))
          ?.match(/\[ref=(\d+)\]/)?.[1]
        expect(button, JSON.stringify(result.result)).toBeTruthy()
        const click = await execute('browser_click', { elementId: Number(button) })
        expect(click.ok, click.error).toBe(true)
        const frameState = await app.evaluate(async ({ webContents }, url) => {
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
    const typed = await execute('browser_open_url', { url: `${origin}/private-chat` })
    expect(typed.ok, typed.error).toBe(true)
    const result = typed.result as { snapshot: { outline: string } }
    const message = result.snapshot.outline
      .split('\n')
      .find((line) => line.includes('"Message"') && /\[ref=\d+\]/.test(line))
      ?.match(/\[ref=(\d+)\]/)?.[1]
    const send = result.snapshot.outline
      .split('\n')
      .find((line) => line.includes('"Send"') && /\[ref=\d+\]/.test(line))
      ?.match(/\[ref=(\d+)\]/)?.[1]
    expect(message, result.snapshot.outline).toBeTruthy()
    expect(send, result.snapshot.outline).toBeTruthy()
    expect(
      (await execute('browser_type', { elementId: Number(message), text: 'Session works' })).ok
    ).toBe(true)
    expect((await execute('browser_click', { elementId: Number(send) })).ok).toBe(true)
    expect(JSON.stringify(await execute('browser_snapshot', {}))).toContain('Session works')
  })

  test('keeps external navigation isolated and authenticates redirects back into Sim', async () => {
    expect((await execute('browser_open_url', { url: `${origin}/private-chat` })).ok).toBe(true)
    const external = origin.replace('127.0.0.1', 'localhost')
    const result = await execute('browser_open_url', { url: `${origin}/redirect` })
    expect(result.ok, result.error).toBe(true)
    expect(result.result).toMatchObject({ url: `${external}/landing` })
    expect(
      await app.evaluate(({ webContents, BrowserWindow }, url) => {
        const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
        return page?.session === BrowserWindow.getAllWindows()[0].webContents.session
      }, `${external}/landing`)
    ).toBe(false)
    const back = await execute('browser_open_url', { url: `${external}/enter-sim` })
    expect(back.ok, back.error).toBe(true)
    expect(back.result).toMatchObject({ url: `${origin}/private-chat` })
  })

  test('sign-out clears authenticated browser pages with the desktop session', async () => {
    const opened = await execute('browser_open_url', { url: `${origin}/private-chat` })
    expect(opened.ok, opened.error).toBe(true)
    expect(opened.result).toMatchObject({ url: `${origin}/private-chat` })
    await window.evaluate(async () => {
      await fetch('/api/auth/sign-out', { method: 'POST' })
    })
    await expect
      .poll(() =>
        app.evaluate(
          ({ webContents }, url) =>
            webContents.getAllWebContents().some((contents) => contents.getURL() === url),
          `${origin}/private-chat`
        )
      )
      .toBe(false)
    await expect(window).toHaveURL(`${origin}/login`)
  })

  async function formState() {
    return app.evaluate(async ({ webContents }, origin) => {
      const page = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().startsWith(`${origin}/form`))
      if (!page) throw new Error('Missing browser fixture')
      return page.executeJavaScript(`({
        name: document.getElementById('name').value,
        plan: document.getElementById('plan').value,
        updates: document.getElementById('updates').checked,
        password: document.getElementById('password').value,
        route: document.getElementById('route').value,
        scrollLeft: document.getElementById('horizontal').scrollLeft
      })`)
    }, origin)
  }

  test('sets and clears multiple selections without partial writes for invalid options', async () => {
    const ref = await openForm()
    const selected = await execute('browser_select_option', {
      elementId: ref('Regions'),
      values: ['A', 'B'],
    })
    expect(selected.ok, selected.error).toBe(true)
    expect(selected.result).toMatchObject({
      values: ['a', 'b'],
      effectObserved: true,
      readback: { values: ['a', 'b'] },
    })
    const invalid = await execute('browser_select_option', {
      elementId: ref('Regions'),
      values: ['B', 'C'],
    })
    expect(invalid.ok).toBe(false)
    const values = await app.evaluate(async ({ webContents }, origin) => {
      const contents = webContents
        .getAllWebContents()
        .find((wc) => wc.getURL() === `${origin}/form`)
      if (!contents) throw new Error('Missing form fixture')
      return contents.executeJavaScript(
        'Array.from(document.getElementById("regions").selectedOptions, option => option.value)'
      )
    }, origin)
    expect(values).toEqual(['a', 'b'])
    const cleared = await execute('browser_select_option', {
      elementId: ref('Regions'),
      values: [],
    })
    expect(cleared.result).toMatchObject({
      values: [],
      effectObserved: true,
      readback: { values: [] },
    })
  })

  test('fills structured native fields and leaves invalid dates unchanged', async () => {
    const ref = await openForm()
    for (const [name, text] of [
      ['Date', '2026-09-15'],
      ['Time', '15:48'],
      ['Appointment', '2026-09-15T15:48:00'],
      ['Month', '2026-09'],
      ['Week', '2026-W38'],
      ['Color', '#AABBCC'],
      ['Range', '75'],
    ]) {
      const response = await execute('browser_type', { elementId: ref(name), text })
      expect(response.ok, response.error).toBe(true)
      expect(response.result).toMatchObject({
        trusted: false,
        dispatched: true,
        effectObserved: true,
      })
    }
    const invalid = await execute('browser_type', { elementId: ref('Date'), text: '2026-02-30' })
    expect(invalid.ok).toBe(false)
    expect(invalid.error).toContain('Invalid value')
    const state = await app.evaluate(async ({ webContents }, origin) => {
      const contents = webContents
        .getAllWebContents()
        .find((wc) => wc.getURL() === `${origin}/form`)
      if (!contents) throw new Error('Missing form fixture')
      return contents.executeJavaScript(
        '({date:document.getElementById("date").value,time:document.getElementById("time").value,appointment:document.getElementById("appointment").value,month:document.getElementById("month").value,week:document.getElementById("week").value,color:document.getElementById("color").value,range:document.getElementById("range").value,events:document.getElementById("date").dataset.events})'
      )
    }, origin)
    expect(state).toEqual({
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
    test(`clicks a ${mode} target without losing its identity`, async () => {
      const opened = await execute('browser_open_url', { url: `${origin}/click?mode=${mode}` })
      expect(opened.ok, opened.error).toBe(true)
      await app.evaluate(
        async ({ webContents }, { origin, mode }) => {
          const contents = webContents
            .getAllWebContents()
            .find((wc) => wc.getURL().startsWith(`${origin}/click`))
          if (!contents) throw new Error('Missing click fixture')
          await contents.executeJavaScript(`
          history.scrollRestoration = 'manual';
          document.getElementById('target').style.top = ${mode === 'sticky' ? '1010' : 'innerHeight - 100'} + 'px';
          scrollTo(0, ${mode === 'sticky' ? '1000' : '0'});
          new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
            document.body.dataset.scrolls = '0'; document.body.dataset.armed = 'true'; resolve();
          })))
        `)
        },
        { origin, mode }
      )
      const snapshot = await execute('browser_snapshot', {})
      expect(snapshot.ok, snapshot.error).toBe(true)
      const outline = (snapshot.result as { outline: string }).outline
      const line = outline.split('\n').find((line) => line.includes('"Choose option"'))
      const match = line?.match(/\[ref=(\d+)\]/)
      if (!match) throw new Error(`Missing target: ${outline}`)
      const result = await execute('browser_click', { elementId: Number(match[1]) })
      expect(result.ok, result.error).toBe(true)
      const state = await app.evaluate(async ({ webContents }, origin) => {
        const contents = webContents
          .getAllWebContents()
          .find((wc) => wc.getURL().startsWith(`${origin}/click`))
        if (!contents) throw new Error('Missing click fixture')
        return contents.executeJavaScript(
          '({clicks:document.body.dataset.clicks,scrolls:document.body.dataset.scrolls,scrollY})'
        )
      }, origin)
      expect(state.clicks).toBe('1')
      if (mode === 'menu') expect(state).toMatchObject({ scrolls: '0', scrollY: 0 })
      else expect(state.scrollY).toBeLessThan(1000)
    })
  }

  test('recovers a permanently pending native capture without losing the page', async () => {
    await openForm()
    const before = await app.evaluate(async ({ webContents }, origin) => {
      const contents = webContents
        .getAllWebContents()
        .find((wc) => wc.getURL() === `${origin}/form`)
      if (!contents) throw new Error('Missing capture fixture')
      await contents.executeJavaScript(`
        document.getElementById('name').value = 'Unsaved work';
        document.getElementById('name').focus();
      `)
      contents.capturePage = () => new Promise(() => {})
      return { id: contents.id, url: contents.getURL() }
    }, origin)
    for (const [color, dominantChannel] of [
      ['rgb(240, 20, 30)', 0],
      ['rgb(30, 40, 230)', 2],
      ['rgb(20, 220, 50)', 1],
    ] as const) {
      await app.evaluate(
        async ({ webContents }, { id, color }) => {
          const contents = webContents.fromId(id)
          if (!contents) throw new Error('Capture fixture was replaced')
          await contents.executeJavaScript(`
          document.body.style.background = ${JSON.stringify(color)};
          new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        `)
        },
        { id: before.id, color }
      )
      const response = await execute('browser_screenshot', {})
      expect(response.ok, response.error).toBe(true)
      const shot = response.result as { dataUrl: string }
      const pixel = await app.evaluate(({ nativeImage }, dataUrl) => {
        const bitmap = nativeImage.createFromDataURL(dataUrl).toBitmap()
        return [bitmap[2], bitmap[1], bitmap[0]]
      }, shot.dataUrl)
      expect(pixel[dominantChannel]).toBeGreaterThan(180)
      for (let channel = 0; channel < 3; channel++) {
        if (channel !== dominantChannel)
          expect(pixel[dominantChannel] - pixel[channel]).toBeGreaterThan(80)
      }
    }
    const after = await app.evaluate(async ({ webContents }, id) => {
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

  test('maps a fractional narrow crop back to its actual viewport position', async () => {
    await openForm()
    const target = await app.evaluate(async ({ webContents }, origin) => {
      const contents = webContents
        .getAllWebContents()
        .find((wc) => wc.getURL() === `${origin}/form`)
      if (!contents) throw new Error('Missing crop fixture')
      return contents.executeJavaScript(`
        const button = document.createElement('button');
        button.textContent = 'Narrow target';
        button.style.cssText = 'position:absolute;left:20.1px;top:60.1px;width:1.1px;height:100px;padding:0;border:0;overflow:hidden';
        button.onclick = () => { document.body.dataset.cropClicks = Number(document.body.dataset.cropClicks || 0) + 1 };
        document.body.append(button);
        const rect = button.getBoundingClientRect();
        ({x:rect.x,y:rect.y,width:rect.width,height:rect.height,devicePixelRatio});
      `) as Promise<{
        x: number
        y: number
        width: number
        height: number
        devicePixelRatio: number
      }>
    }, origin)
    const snapshot = await execute('browser_snapshot', {})
    expect(snapshot.ok, snapshot.error).toBe(true)
    const line = (snapshot.result as { outline: string }).outline
      .split('\n')
      .find((line) => line.includes('"Narrow target"'))
    const match = line?.match(/\[ref=(\d+)\]/)
    if (!match) throw new Error('Missing narrow target reference')
    const response = await execute('browser_screenshot', { elementId: Number(match[1]) })
    expect(response.ok, response.error).toBe(true)
    const shot = response.result as {
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
    const clicked = await execute('browser_click_at', {
      x: shot.clip.x + shot.clip.width / 2,
      y: shot.clip.y + shot.clip.height / 2,
    })
    expect(clicked.ok, clicked.error).toBe(true)
    const count = await app.evaluate(async ({ webContents }, origin) => {
      const contents = webContents
        .getAllWebContents()
        .find((wc) => wc.getURL() === `${origin}/form`)
      return contents?.executeJavaScript('document.body.dataset.cropClicks')
    }, origin)
    expect(count).toBe('1')
  })

  for (const mode of ['hidden', 'minimized']) {
    test(`recovers a stalled capture after restoring a ${mode} window`, async () => {
      test.skip(mode === 'minimized' && process.platform !== 'darwin', 'Requires minimize events')
      await openForm()
      await app.evaluate(
        async ({ BrowserWindow, webContents }, { origin, mode }) => {
          const contents = webContents
            .getAllWebContents()
            .find((wc) => wc.getURL() === `${origin}/form`)
          if (!contents) throw new Error('Missing capture fixture')
          contents.capturePage = () => new Promise(() => {})
          await contents.executeJavaScript("document.getElementById('name').value = 'Unsaved work'")
          const win = BrowserWindow.getAllWindows()[0]
          win.blur()
          if (mode === 'hidden') win.hide()
          else {
            const minimized = new Promise<void>((resolve) => win.once('minimize', resolve))
            win.minimize()
            await minimized
          }
        },
        { origin, mode }
      )
      const state = () =>
        app.evaluate(async ({ BrowserWindow, webContents }, origin) => {
          const win = BrowserWindow.getAllWindows()[0]
          const contents = webContents
            .getAllWebContents()
            .find((wc) => wc.getURL() === `${origin}/form`)
          if (!contents) throw new Error('Missing capture fixture')
          return {
            id: contents.id,
            visible: win.isVisible(),
            minimized: win.isMinimized(),
            focused: BrowserWindow.getFocusedWindow()?.id ?? null,
            bounds: win.getBounds(),
            value: await contents.executeJavaScript("document.getElementById('name').value"),
          }
        }, origin)
      const before = await state()
      const start = Date.now()
      const hiddenCapture = await execute('browser_screenshot', {})
      expect(Date.now() - start).toBeLessThan(12_000)
      if (!hiddenCapture.ok)
        expect(hiddenCapture.error).toContain('Screenshot frame capture timed out')
      expect(await state()).toEqual(before)
      await app.evaluate(({ BrowserWindow }, mode) => {
        const win = BrowserWindow.getAllWindows()[0]
        if (mode === 'minimized') win.restore()
        else win.showInactive()
      }, mode)
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await execute('browser_screenshot', {})
        expect(response.ok, response.error).toBe(true)
      }
      expect(await state()).toMatchObject({ id: before.id, value: 'Unsaved work' })
    })
  }

  for (const mode of ['visible', 'hidden', 'minimized']) {
    test(`captures a ${mode} window without changing its state`, async () => {
      test.skip(
        mode === 'minimized' && process.platform !== 'darwin',
        'Requires a window manager with minimize events'
      )
      await openForm()
      await app.evaluate(async ({ BrowserWindow }, mode) => {
        const win = BrowserWindow.getAllWindows()[0]
        win.blur()
        if (mode === 'hidden') win.hide()
        if (mode === 'minimized') {
          const minimized = new Promise<void>((resolve) => win.once('minimize', () => resolve()))
          win.minimize()
          await minimized
        }
      }, mode)
      const state = () =>
        app.evaluate(async ({ BrowserWindow, webContents }, origin) => {
          const win = BrowserWindow.getAllWindows()[0]
          const contents = webContents
            .getAllWebContents()
            .find((wc) => wc.getURL() === `${origin}/form`)
          if (!contents) throw new Error('Missing screenshot fixture')
          return {
            visible: win.isVisible(),
            minimized: win.isMinimized(),
            bounds: win.getBounds(),
            focused: BrowserWindow.getFocusedWindow()?.id ?? null,
            page: await contents.executeJavaScript(
              '({width:innerWidth,height:innerHeight,scrollX,scrollY,html:document.body.innerHTML,focus:document.activeElement?.id})'
            ),
          }
        }, origin)
      const before = await state()
      for (let i = 0; i < 3; i++) {
        const response = await execute('browser_screenshot', {})
        expect(response.ok, response.error).toBe(true)
        const shot = response.result as {
          dataUrl: string
          scale: number
          viewport: { width: number; height: number }
        }
        expect(shot.dataUrl.length).toBeGreaterThan(1000)
        expect(shot.viewport.width).toBeGreaterThan(0)
        expect(shot.viewport.height).toBeGreaterThan(0)
        const image = await app.evaluate(({ nativeImage }, dataUrl) => {
          const image = nativeImage.createFromDataURL(dataUrl)
          return { empty: image.isEmpty(), ...image.getSize() }
        }, shot.dataUrl)
        expect(image).toEqual({
          empty: false,
          width: Math.round(shot.viewport.width * shot.scale),
          height: Math.round(shot.viewport.height * shot.scale),
        })
        expect(await state()).toEqual(before)
      }
    })
  }

  test('captures fresh pixels after resizing and repainting the viewport', async () => {
    await openForm()
    const viewportWidth = () =>
      app.evaluate(async ({ webContents }, origin) => {
        const contents = webContents
          .getAllWebContents()
          .find((wc) => wc.getURL() === `${origin}/form`)
        return contents?.executeJavaScript('innerWidth')
      }, origin)
    const beforeWidth = await viewportWidth()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900))
    await expect.poll(viewportWidth).not.toBe(beforeWidth)
    for (const color of ['red', 'blue']) {
      await app.evaluate(
        async ({ webContents }, { origin, color }) => {
          const contents = webContents
            .getAllWebContents()
            .find((wc) => wc.getURL() === `${origin}/form`)
          if (!contents) throw new Error('Missing screenshot fixture')
          await contents.executeJavaScript(
            `document.body.style.background = ${JSON.stringify(color)};
            new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
          )
        },
        { origin, color }
      )
      const response = await execute('browser_screenshot', {})
      expect(response.ok, response.error).toBe(true)
      const shot = response.result as { dataUrl: string }
      const pixel = await app.evaluate(({ nativeImage }, dataUrl) => {
        const image = nativeImage.createFromDataURL(dataUrl)
        return Array.from(image.toBitmap().subarray(0, 4))
      }, shot.dataUrl)
      const dominant = pixel[color === 'red' ? 2 : 0]
      const other = pixel[color === 'red' ? 0 : 2]
      expect(dominant - other, `${color}: ${pixel}`).toBeGreaterThan(150)
    }
  })

  test('opens with references, fills in order, and scrolls a horizontal pane', async () => {
    const ref = await openForm()
    const fill = await execute('browser_fill_form', {
      fields: [
        { elementId: ref('Name'), kind: 'text', text: 'Example User' },
        { elementId: ref('Plan'), kind: 'select', value: 'pro' },
        { elementId: ref('Updates'), kind: 'checked', checked: true },
      ],
    })
    expect(fill.ok, fill.error).toBe(true)
    expect(fill.result, JSON.stringify(fill.result)).toMatchObject({
      completed: true,
      completedCount: 3,
    })
    expect(await formState()).toMatchObject({ name: 'Example User', plan: 'pro', updates: true })
    const cleared = await execute('browser_fill_form', {
      fields: [{ elementId: ref('Name'), kind: 'text', text: '' }],
    })
    expect(cleared.result, JSON.stringify(cleared.result)).toMatchObject({ completed: true })
    expect(await formState()).toMatchObject({ name: '' })

    const scroll = await execute('browser_scroll', {
      direction: 'right',
      amount: 240,
      elementId: ref('Wide table'),
    })
    expect(scroll.ok, scroll.error).toBe(true)
    expect(scroll.result).toMatchObject({ movedBy: 240 })
    expect(Math.round((await formState()).scrollLeft)).toBe(240)
    await execute('browser_scroll', {
      direction: 'left',
      amount: 240,
      elementId: ref('Wide table'),
    })
    expect(await formState()).toMatchObject({ scrollLeft: 0 })
  })

  test('batches an action with a fresh observation without replaying form fields', async () => {
    const ref = await openForm()
    const fill = await execute('browser_fill_form', {
      fields: [{ elementId: ref('Name'), kind: 'text', text: 'Observed value' }],
      observe: { query: 'Name' },
    })
    expect(fill.ok, fill.error).toBe(true)
    expect(fill.result).toMatchObject({
      completed: true,
      completedCount: 1,
      observation: { ok: true, result: { totalMatches: 1 } },
    })
    expect(await formState()).toMatchObject({ name: 'Observed value' })
    const result = fill.result as { observation: { result: { matches: { elementId: number }[] } } }
    const freshId = result.observation.result.matches[0].elementId
    expect(freshId).not.toBe(ref('Name'))
    const clear = await execute('browser_type', { elementId: freshId, text: '', observe: {} })
    expect(clear.ok, clear.error).toBe(true)
    expect(clear.result).toMatchObject({ observation: { ok: true } })
    expect(await formState()).toMatchObject({ name: '' })
  })

  test('stops after a route change without writing the next field', async () => {
    const ref = await openForm()
    const fill = await execute('browser_fill_form', {
      fields: [
        { elementId: ref('Route'), kind: 'text', text: 'change route' },
        { elementId: ref('Name'), kind: 'text', text: 'Must not be written' },
      ],
    })
    expect(fill.result, JSON.stringify(fill.result)).toMatchObject({
      completed: false,
      doNotRetry: true,
    })
    expect(await formState()).toMatchObject({ name: '', route: 'change route' })
  })

  test('follows a link and cross-origin redirect without a website approval prompt', async () => {
    await openForm()
    await app.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
      if (!page) throw new Error('Missing browser fixture')
      await page.executeJavaScript("document.querySelector('a').click()")
    }, `${origin}/form`)

    const destination = `${origin.replace('127.0.0.1', 'localhost')}/landing`
    await expect
      .poll(() =>
        app.evaluate(
          ({ webContents }, url) =>
            webContents.getAllWebContents().some((contents) => contents.getURL() === url),
          destination
        )
      )
      .toBe(true)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    await expect(window.getByRole('heading')).toHaveText('Browser tools fixture')
  })

  test('stops when a new popup exceeds the page summary limit', async () => {
    const ref = await openForm()
    await app.evaluate(async ({ webContents }, origin) => {
      const page = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().startsWith(`${origin}/form`))
      if (!page) throw new Error('Missing browser fixture')
      await page.executeJavaScript(`
        for (let index = 0; index < 10; index++) {
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
        }, { once: true })
      `)
    }, origin)

    const fill = await execute('browser_fill_form', {
      fields: [
        { elementId: ref('Name'), kind: 'text', text: 'Example User' },
        { elementId: ref('Plan'), kind: 'select', value: 'pro' },
      ],
    })
    expect(fill.ok, fill.error).toBe(true)
    expect(fill.result, JSON.stringify(fill.result)).toMatchObject({
      completed: false,
      completedCount: 1,
      stoppedIndex: 0,
      results: [{ verified: true, valuePreview: 'Example User' }],
      doNotRetry: true,
      error: expect.stringContaining('could not be fully verified'),
    })
    expect(await formState()).toMatchObject({ name: 'Example User', plan: 'basic' })
  })

  test('refuses credential fields and leaves subsequent fields untouched', async () => {
    const ref = await openForm()
    const fill = await execute('browser_fill_form', {
      fields: [
        { elementId: ref('Password'), kind: 'text', text: 'must-not-be-entered' },
        { elementId: ref('Name'), kind: 'text', text: 'Must not be written' },
      ],
    })
    expect(fill.result).toMatchObject({ completed: false, completedCount: 0 })
    expect(await formState()).toMatchObject({ name: '', password: '' })
  })
  test('local terminal executes through its native PTY and refuses repeated authorization', async () => {
    await window.evaluate(async (scope) => {
      const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
      await api.terminal.activateScope(scope)
      await api.terminal.openTerminal(undefined, scope)
    }, SCOPE)
    calls.set('local-cwd', {
      chatId: SCOPE,
      toolName: 'terminal',
      args: { operation: 'cwd', args: {} },
    })
    const cwd = await window.evaluate(async (scope) => {
      const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
      return api.terminal.executeTool('local-cwd', 'cwd', {}, scope)
    }, SCOPE)
    expect(cwd.ok).toBe(true)
    calls.set('local-run', {
      chatId: SCOPE,
      toolName: 'terminal',
      args: { operation: 'run', args: { command: "printf 'SIM_NATIVE_TERMINAL_VERIFIED\\n'" } },
    })
    const result = await window.evaluate(async (scope) => {
      const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
      return api.terminal.executeTool('local-run', 'run', {}, scope)
    }, SCOPE)
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).toContain('SIM_NATIVE_TERMINAL_VERIFIED')
    const replay = await window.evaluate(async (scope) => {
      const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
      return api.terminal.executeTool('local-run', 'run', {}, scope)
    }, SCOPE)
    expect(replay.ok).toBe(false)
  })
})
