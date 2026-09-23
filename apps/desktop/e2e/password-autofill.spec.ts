import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
import type { SimDesktopApi } from '@sim/desktop-bridge'

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))
const SCOPE = 'password-fixture'
const SCREENSHOTS = process.env.SIM_PASSWORD_SCREENSHOTS
const LOGIN = `<!doctype html><html><head><title>Account sign in</title><style>
body { font: 16px system-ui; color: #222; background: #fafafa; padding: 60px }
form { width: 340px; margin: auto } input { display: block; box-sizing: border-box; width: 100%; height: 42px; margin: 8px 0 24px; padding: 8px; border: 1px solid #aaa; border-radius: 6px } button { padding: 10px 16px } h1 { font-size: 24px }
</style></head><body><form onsubmit="event.preventDefault();document.body.dataset.submitted='yes'"><h1>Sign in to your account</h1><label>Email<input id="user" autocomplete="username"></label><label>Password<input id="pass" type="password" autocomplete="current-password"></label><button>Sign in</button></form></body></html>`

test.describe('saved password autofill', () => {
  let server: Server
  let origin: string
  let site: string
  let app: ElectronApplication
  let host: Page
  let userData: string
  const calls = new Map<
    string,
    { chatId: string; toolName: string; args: Record<string, unknown> }
  >()
  let serial = 0

  test.beforeAll(async () => {
    server = createServer(async (request, response) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname
      if (path === '/api/auth/get-session') {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({ user: { id: 'fixture-user' }, session: { id: 'fixture-session' } })
        )
        return
      }
      if (path === '/api/desktop/tool/authorize') {
        let body = ''
        for await (const chunk of request) body += chunk.toString()
        const call = calls.get(JSON.parse(body).toolCallId)
        response.writeHead(call ? 200 : 403, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify(call ?? {}))
        return
      }
      if (path.startsWith('/api/')) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end('{}')
        return
      }
      response.writeHead(200, {
        'Content-Type': 'text/html',
        'Set-Cookie': 'better-auth.session_token=fixture; HttpOnly; SameSite=Lax; Path=/',
      })
      response.end(
        path === '/login'
          ? LOGIN
          : '<!doctype html><title>Sim fixture</title><h1>Password fixture</h1><button id="outside">Outside the browser</button>'
      )
    })
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    origin = `http://127.0.0.1:${address.port}`
    site = `http://localhost:${address.port}`
  })

  test.beforeEach(async () => {
    userData = mkdtempSync(join(tmpdir(), 'sim-password-e2e-'))
    app = await electron.launch({
      args: ['.'],
      cwd: DESKTOP_DIR,
      env: { ...process.env, SIM_DESKTOP_ORIGIN: origin, SIM_DESKTOP_USER_DATA: userData },
    })
    host = await app.firstWindow()
    await expect(host.getByRole('heading')).toHaveText('Password fixture')
    await app.evaluate(({ app, BrowserWindow }) => {
      app.focus({ steal: true })
      BrowserWindow.getAllWindows()[0].focus()
    })
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()))
      .toBe(true)
    await host.evaluate(async (scope) => {
      const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
      await api.browserAgent.activateScope(scope)
      api.browserAgent.setPanelBounds(
        { x: 0, y: 130, width: innerWidth, height: innerHeight - 130 },
        null,
        scope
      )
      setInterval(
        () =>
          api.browserAgent.setPanelBounds(
            { x: 0, y: 130, width: innerWidth, height: innerHeight - 130 },
            null,
            scope
          ),
        200
      )
    }, SCOPE)
    await seed(3)
    await navigate(`${site}/login`)
  })

  test.afterEach(async () => {
    await app?.close()
    rmSync(userData, { recursive: true, force: true })
    calls.clear()
  })
  test.afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  })

  async function seed(count: number) {
    const ciphertext = await app.evaluate(
      ({ safeStorage }, { site, count }) => {
        const records = Array.from({ length: count }, (_, index) => ({
          id: `account-${index}`,
          origin: site,
          username: `account${index + 1}@example.test`,
          password: `fixture-secret-${index}`,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          source: 'manual',
        }))
        return safeStorage.encryptString(JSON.stringify(records)).toString('base64')
      },
      { site, count }
    )
    writeFileSync(
      join(userData, 'browser-credentials.json'),
      JSON.stringify({ version: 1, ciphertext }),
      { mode: 0o600 }
    )
  }

  async function navigate(url: string) {
    const id = `fixture-${++serial}`
    calls.set(id, { chatId: SCOPE, toolName: 'browser_open_url', args: { url } })
    const result = await host.evaluate(
      async ({ id, url, scope }) => {
        const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
        return api.browserAgent.executeTool(id, 'browser_open_url', { url }, scope)
      },
      { id, url, scope: SCOPE }
    )
    expect(result.ok, result.error).toBe(true)
  }

  async function pageScript<T>(script: string): Promise<T> {
    return app.evaluate(
      async ({ webContents }, { site, script }) => {
        const page = webContents
          .getAllWebContents()
          .find((contents) => contents.getURL().startsWith(`${site}/login`))
        if (!page) throw new Error('Missing fixture page')
        return page.executeJavaScript(script)
      },
      { site, script }
    )
  }

  async function clickField(id = 'user') {
    await app.evaluate(
      async ({ webContents }, { site, id }) => {
        const page = webContents
          .getAllWebContents()
          .find((contents) => contents.getURL().startsWith(`${site}/login`))!
        const point = await page.executeJavaScript(
          `(() => {const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:Math.round(r.x+12),y:Math.round(r.y+12)}})()`
        )
        page.focus()
        page.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
        page.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
      },
      { site, id }
    )
  }

  async function picker() {
    await expect
      .poll(() => app.windows().some((page) => page.url().includes('credential-picker.html')))
      .toBe(true)
    const page = app.windows().find((page) => page.url().includes('credential-picker.html'))!
    await expect(page.getByRole('menu')).toBeVisible()
    return page
  }

  async function pickerKey(keyCode: string) {
    await app.evaluate(({ BrowserWindow }, keyCode) => {
      const contents = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes('credential-picker.html')
      )!.webContents
      contents.sendInputEvent({ type: 'keyDown', keyCode })
      contents.sendInputEvent({ type: 'keyUp', keyCode })
    }, keyCode)
  }

  test('uses shared emcn styling, fills a selected account, and never submits', async () => {
    await clickField()
    const menu = await picker()
    await expect(menu.getByRole('menuitem')).toHaveCount(3)
    const denied = await menu.evaluate(async () => {
      const api = (
        window as Window & { simCredentialPicker?: { select(id: string): Promise<string> } }
      ).simCredentialPicker
      return api?.select('account-0')
    })
    expect(denied).toBe('failed')
    expect(await pageScript('document.getElementById("pass").value')).toBe('')
    const placement = await app.evaluate(async ({ BrowserWindow, WebContentsView }) => {
      const picker = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes('credential-picker.html')
      )!
      const parent = picker.getParentWindow()!
      const view = parent.contentView.children.find(
        (view) => view instanceof WebContentsView && view.webContents.getURL().includes('/login')
      ) as InstanceType<typeof WebContentsView>
      const field = await view.webContents.executeJavaScript(
        '(() => { const r=document.getElementById("user").getBoundingClientRect(); return {x:r.x,y:r.y,height:r.height} })()'
      )
      const bounds = picker.getBounds()
      const zoom = view.webContents.getZoomFactor()
      return {
        x: bounds.x,
        y: bounds.y,
        height: bounds.height,
        fieldX: parent.getContentBounds().x + view.getBounds().x + field.x * zoom,
        fieldY: parent.getContentBounds().y + view.getBounds().y + field.y * zoom,
        fieldHeight: field.height * zoom,
      }
    })
    expect(Math.abs(placement.x - placement.fieldX)).toBeLessThanOrEqual(1)
    expect(
      Math.min(
        Math.abs(placement.y - placement.fieldY - placement.fieldHeight - 4),
        Math.abs(placement.y + placement.height + 4 - placement.fieldY)
      )
    ).toBeLessThanOrEqual(1)
    await menu.evaluate(async () => {
      await document.fonts.ready
      await new Promise(requestAnimationFrame)
      await Promise.all(document.getAnimations().map((animation) => animation.finished))
    })
    const geometry = await menu.getByRole('menu').evaluate((element) => ({
      x: element.getBoundingClientRect().x,
      width: element.getBoundingClientRect().width,
      overflow: element.scrollHeight > element.clientHeight,
      font: getComputedStyle(element).fontFamily,
      weight: getComputedStyle(element).fontWeight,
    }))
    expect(geometry).toMatchObject({ x: 0, width: 320, overflow: false, weight: '400' })
    expect(geometry.font).toContain('Season Sans')
    if (SCREENSHOTS) {
      mkdirSync(SCREENSHOTS, { recursive: true })
      for (const theme of ['light', 'dark']) {
        await host.evaluate((theme) => {
          document.documentElement.className = theme
          document.documentElement.style.colorScheme = theme
        }, theme)
        await expect(menu.locator('html')).toHaveClass(theme)
        await menu.screenshot({ path: join(SCREENSHOTS, `password-picker-${theme}.png`) })
      }
    }
    await menu.getByRole('menuitem', { name: 'account2@example.test', exact: true }).click()
    await expect
      .poll(() =>
        pageScript(
          '({user:document.getElementById("user").value,pass:document.getElementById("pass").value,submitted:document.body.dataset.submitted ?? null})'
        )
      )
      .toEqual({ user: 'account2@example.test', pass: 'fixture-secret-1', submitted: null })
    await expect
      .poll(() => app.windows().some((page) => page.url().includes('credential-picker.html')))
      .toBe(false)
  })

  test('supports keyboard selection and dismissal without unnecessary scrolling', async () => {
    await seed(15)
    await clickField()
    const menu = await picker()
    await app.evaluate(({ webContents }, site) => {
      const page = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().startsWith(`${site}/login`))!
      page.sendInputEvent({ type: 'keyDown', keyCode: 'Down' })
      page.sendInputEvent({ type: 'keyUp', keyCode: 'Down' })
    }, site)
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getFocusedWindow()?.webContents.getURL().includes('credential-picker.html')
        )
      )
      .toBe(true)
    await expect(menu.getByRole('menuitem')).toHaveCount(15)
    await pickerKey('End')
    await expect(menu.getByRole('menuitem').last()).toBeFocused()
    await pickerKey('Enter')
    await expect
      .poll(() => pageScript('document.getElementById("user").value'))
      .toBe('account9@example.test')
    await clickField()
    await picker()
    await pickerKey('Escape')
    await expect
      .poll(() => app.windows().some((page) => page.url().includes('credential-picker.html')))
      .toBe(false)
  })

  test('dismisses an inactive picker on outside input and hides it when its page disappears', async () => {
    await clickField()
    await picker()
    await host.getByRole('button', { name: 'Outside the browser' }).click()
    await expect
      .poll(() => app.windows().some((page) => page.url().includes('credential-picker.html')))
      .toBe(false)
    await clickField()
    await picker()
    await host.evaluate((scope) => {
      ;(
        globalThis as typeof globalThis & { simDesktop: SimDesktopApi }
      ).simDesktop.browserAgent.setPanelBounds(null, null, scope)
    }, SCOPE)
    await expect
      .poll(() => app.windows().some((page) => page.url().includes('credential-picker.html')))
      .toBe(false)
    expect(await pageScript('document.getElementById("pass").value')).toBe('')
  })

  test('rejects replaced fields and excludes account creation', async () => {
    await clickField()
    await picker()
    await pageScript(
      'document.querySelector("form").innerHTML = \'<input id="user" autocomplete="username"><input id="pass" type="password" autocomplete="new-password">\''
    )
    await expect
      .poll(() => app.windows().some((page) => page.url().includes('credential-picker.html')))
      .toBe(false)
    await clickField('pass')
    expect(await pageScript('document.getElementById("pass").value')).toBe('')
    expect(app.windows().some((page) => page.url().includes('credential-picker.html'))).toBe(false)
  })
  test('offers a focused manual chooser with one account', async () => {
    await seed(1)
    await host.evaluate((scope) => {
      document.getElementById('outside')!.onclick = () => {
        void (
          globalThis as typeof globalThis & { simDesktop: SimDesktopApi }
        ).simDesktop.browserCredentials.showChooser({ x: 20, y: 80 }, scope)
      }
    }, SCOPE)
    await host.getByRole('button', { name: 'Outside the browser' }).click()
    const menu = await picker()
    await expect(menu.getByRole('menuitem')).toHaveCount(1)
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getFocusedWindow()?.webContents.getURL().includes('credential-picker.html')
        )
      )
      .toBe(true)
    await menu.getByRole('menuitem').click()
    await expect
      .poll(() => pageScript('document.getElementById("pass").value'))
      .toBe('fixture-secret-0')
  })

  test('shows a fill failure when the page rejects the value', async () => {
    await pageScript(
      'document.getElementById("pass").addEventListener("input", (event) => { event.target.value = "" })'
    )
    await clickField()
    const menu = await picker()
    await menu.getByRole('menuitem').first().click()
    await expect(menu.getByRole('alert')).toHaveText(
      'Could not fill this form. Select the field again.'
    )
    expect(await pageScript('document.getElementById("pass").value')).toBe('')
    if (SCREENSHOTS) await menu.screenshot({ path: join(SCREENSHOTS, 'password-picker-error.png') })
  })

  test('closes on navigation and never fills the destination', async () => {
    await clickField()
    await picker()
    await navigate(`${site}/login?next=1`)
    await expect
      .poll(() => app.windows().some((page) => page.url().includes('credential-picker.html')))
      .toBe(false)
    expect(await pageScript('document.getElementById("pass").value')).toBe('')
  })

  test('fills the focused form in an open shadow root with composed events', async () => {
    await pageScript(`document.body.innerHTML = '<div id="shadow"></div>';
      const root = document.getElementById('shadow').attachShadow({mode:'open'});
      root.innerHTML = '<form><input id="user" autocomplete="username"><input id="pass" type="password"></form>';
      document.addEventListener('input', () => document.body.dataset.input = 'yes')`)
    await app.evaluate(async ({ webContents }, site) => {
      const page = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().startsWith(`${site}/login`))!
      const point = await page.executeJavaScript(
        '(() => {const r=document.getElementById("shadow").shadowRoot.getElementById("pass").getBoundingClientRect();return {x:Math.round(r.x+4),y:Math.round(r.y+4)}})()'
      )
      page.focus()
      page.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
      page.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
    }, site)
    const menu = await picker()
    await menu.getByRole('menuitem').first().click()
    await expect
      .poll(() =>
        pageScript('document.getElementById("shadow").shadowRoot.getElementById("pass").value')
      )
      .toBe('fixture-secret-0')
    expect(await pageScript('document.body.dataset.input')).toBe('yes')
  })
})
