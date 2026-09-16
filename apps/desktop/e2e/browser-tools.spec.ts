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
  <label>Updates <input id="updates" type="checkbox"></label>
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

test.describe('browser tools', () => {
  const calls = new Map<
    string,
    { chatId: string; toolName: BrowserToolName; args: Record<string, unknown> }
  >()
  let server: Server
  let origin: string
  let app: ElectronApplication
  let window: Page
  let callCount = 0

  test.beforeAll(async () => {
    server = createServer(async (request, response) => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      if (path === '/redirect') {
        response.writeHead(302, { Location: `${origin.replace('127.0.0.1', 'localhost')}/landing` })
        response.end()
        return
      }
      if (path === '/api/desktop/tool/authorize') {
        let body = ''
        for await (const chunk of request) body += chunk.toString()
        const authorization = calls.get(JSON.parse(body).toolCallId)
        response.writeHead(authorization ? 200 : 403, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify(authorization ?? {}))
        return
      }
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end(
        path === '/click'
          ? CLICK_FIXTURE
          : path === '/form'
            ? FORM
            : '<!doctype html><title>Sim fixture</title><h1>Browser tools fixture</h1>'
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    origin = `http://127.0.0.1:${address.port}`
  })

  test.beforeEach(async () => {
    app = await electron.launch({
      args: ['.'],
      cwd: DESKTOP_DIR,
      env: {
        ...process.env,
        SIM_DESKTOP_ORIGIN: origin,
        SIM_DESKTOP_USER_DATA: mkdtempSync(join(tmpdir(), 'sim-browser-tools-e2e-')),
      },
    })
    window = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false)
    )
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
    await app?.close()
    calls.clear()
  })

  test.afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
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
      const line = result.snapshot.outline.split('\n').find((line) => line.includes(`"${name}"`))
      const match = line?.match(/\[ref=(\d+)\]/)
      if (!match) throw new Error(`No reference for ${name}: ${result.snapshot.outline}`)
      return Number(match[1])
    }
  }

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
            `document.body.style.background = ${JSON.stringify(color)}; void 0`
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
})
