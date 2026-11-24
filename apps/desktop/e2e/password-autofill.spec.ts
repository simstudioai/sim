import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { getErrorMessage } from '@sim/utils/errors'
import {
  attachBrowserPanel,
  type DesktopBridge,
  expect,
  type FixtureServer,
  focusFirstWindow,
  ToolAuthorizer,
  test,
} from './harness'
import { serveSignedIn } from './session-fixture'

const SCOPE = 'password-fixture'
const PICKER_PAGE = 'credential-picker.html'
const LOGIN = `<!doctype html><html><head><title>Account sign in</title><style>
body { font: 16px system-ui; color: #222; background: #fafafa; padding: 60px }
form { width: 340px; margin: auto } input { display: block; box-sizing: border-box; width: 100%; height: 42px; margin: 8px 0 24px; padding: 8px; border: 1px solid #aaa; border-radius: 6px } button { padding: 10px 16px } h1 { font-size: 24px }
</style></head><body><form onsubmit="event.preventDefault();document.body.dataset.submitted='yes'"><h1>Sign in to your account</h1><label>Email<input id="user" autocomplete="username"></label><label>Password<input id="pass" type="password" autocomplete="current-password"></label><button>Sign in</button></form></body></html>`

test.describe('saved password autofill', () => {
  let fixture: FixtureServer
  let app: ElectronApplication
  let host: Page
  let userData: string
  const authorizer = new ToolAuthorizer('fixture')

  test.beforeAll(async () => {
    fixture = await serveSignedIn({
      page: '<!doctype html><title>Sim fixture</title><h1>Password fixture</h1><button id="outside">Outside the browser</button>',
      handle: async (request, response, url) => {
        if (await authorizer.handle(request, response, url)) return true
        if (url.pathname !== '/login') return false
        response.writeHead(200, { 'Content-Type': 'text/html' }).end(LOGIN)
        return true
      },
    })
  })

  test.afterAll(async () => {
    await fixture.close()
  })

  test.beforeEach(async ({ desktop }) => {
    ;({ app, userData } = await desktop.launch({ origin: fixture.origin }))
    host = await app.firstWindow()
    await expect(host.getByRole('heading')).toHaveText('Password fixture')
    await focusFirstWindow(app)
    await attachBrowserPanel(host, SCOPE, 130)
    await seed(3)
    await navigate(`${fixture.site}/login`)
  })

  async function seed(count: number, prefix = 'account') {
    const ciphertext = await app.evaluate(
      ({ safeStorage }, { site, count, prefix }) => {
        const records = Array.from({ length: count }, (_, index) => ({
          id: `account-${index}`,
          origin: site,
          username: `${prefix}${index + 1}@example.test`,
          password: `fixture-secret-${index}`,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          source: 'manual',
        }))
        return safeStorage.encryptString(JSON.stringify(records)).toString('base64')
      },
      { site: fixture.site, count, prefix }
    )
    writeFileSync(
      join(userData, 'browser-credentials.json'),
      JSON.stringify({ version: 1, ciphertext }),
      { mode: 0o600 }
    )
  }

  async function navigate(url: string) {
    await authorizer.execute(host, SCOPE, 'browser_open_url', { url })
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
      { site: fixture.site, script }
    )
  }

  /** Clicks a login field with native input, as a user would. */
  async function clickField(id = 'user') {
    await app.evaluate(
      async ({ webContents }, { site, id }) => {
        const page = webContents
          .getAllWebContents()
          .find((contents) => contents.getURL().startsWith(`${site}/login`))
        if (!page) throw new Error('Missing fixture page')
        const point = await page.executeJavaScript(
          `(() => {const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:Math.round(r.x+12),y:Math.round(r.y+12)}})()`
        )
        page.focus()
        page.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
        page.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
      },
      { site: fixture.site, id }
    )
  }

  /** Sends a key to the login page with native input. */
  async function loginKey(keyCode: string) {
    await app.evaluate(
      ({ webContents }, { site, keyCode }) => {
        const page = webContents
          .getAllWebContents()
          .find((contents) => contents.getURL().startsWith(`${site}/login`))
        if (!page) throw new Error('Missing fixture page')
        page.sendInputEvent({ type: 'keyDown', keyCode })
        page.sendInputEvent({ type: 'keyUp', keyCode })
      },
      { site: fixture.site, keyCode }
    )
  }

  const pickerPage = () => app.windows().find((page) => page.url().includes(PICKER_PAGE))
  const pickerOpen = () => pickerPage() !== undefined

  async function picker(): Promise<Page> {
    await expect.poll(pickerOpen).toBe(true)
    const page = pickerPage()
    if (!page) throw new Error('The picker closed before it could be read')
    await expect(page.getByRole('menu')).toBeVisible()
    return page
  }

  const pickerFocused = () =>
    app.evaluate(
      ({ BrowserWindow }, pickerUrl) =>
        BrowserWindow.getFocusedWindow()?.webContents.getURL().includes(pickerUrl),
      PICKER_PAGE
    )

  async function pickerKey(keyCode: string) {
    await app.evaluate(
      ({ BrowserWindow }, { keyCode, pickerUrl }) => {
        const picker = BrowserWindow.getAllWindows().find((window) =>
          window.webContents.getURL().includes(pickerUrl)
        )
        if (!picker) throw new Error('The picker is not open')
        picker.webContents.sendInputEvent({ type: 'keyDown', keyCode })
        picker.webContents.sendInputEvent({ type: 'keyUp', keyCode })
      },
      { keyCode, pickerUrl: PICKER_PAGE }
    )
  }

  /** Chooses an account; the picker closes under the click, the only error tolerated. */
  async function choose(menu: Page, item: Locator) {
    const closed = menu.waitForEvent('close')
    await item.click().catch((error: unknown) => {
      if (!getErrorMessage(error).includes('Target page, context or browser has been closed')) {
        throw error
      }
    })
    await closed
  }

  /** Whether the picker sits flush with the username field, below it or above it. */
  const placement = () =>
    app.evaluate(async ({ BrowserWindow, WebContentsView }, pickerUrl) => {
      const picker = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes(pickerUrl)
      )
      const parent = picker?.getParentWindow()
      const view = parent?.contentView.children.find(
        (child): child is InstanceType<typeof WebContentsView> =>
          child instanceof WebContentsView && child.webContents.getURL().includes('/login')
      )
      if (!picker || !parent || !view) return null
      const field = await view.webContents.executeJavaScript(
        '(() => { const r=document.getElementById("user").getBoundingClientRect(); return {x:r.x,y:r.y,height:r.height} })()'
      )
      const bounds = picker.getBounds()
      const zoom = view.webContents.getZoomFactor()
      const fieldX = parent.getContentBounds().x + view.getBounds().x + field.x * zoom
      const fieldY = parent.getContentBounds().y + view.getBounds().y + field.y * zoom
      const fieldHeight = field.height * zoom
      return {
        alignedX: Math.abs(bounds.x - fieldX) <= 1,
        adjacentY:
          Math.min(
            Math.abs(bounds.y - fieldY - fieldHeight - 4),
            Math.abs(bounds.y + bounds.height + 4 - fieldY)
          ) <= 1,
      }
    }, PICKER_PAGE)

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
    await expect.poll(placement).toEqual({ alignedX: true, adjacentY: true })
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
    await choose(menu, menu.getByRole('menuitem', { name: 'account2@example.test', exact: true }))
    await expect
      .poll(() =>
        pageScript(
          '({user:document.getElementById("user").value,pass:document.getElementById("pass").value,submitted:document.body.dataset.submitted ?? null})'
        )
      )
      .toEqual({ user: 'account2@example.test', pass: 'fixture-secret-1', submitted: null })
  })

  test('supports keyboard selection and dismissal without unnecessary scrolling', async () => {
    await seed(15)
    await clickField()
    const menu = await picker()
    await loginKey('Down')
    await expect.poll(pickerFocused).toBe(true)
    await expect(menu.getByRole('menuitem')).toHaveCount(15)
    await pickerKey('End')
    await expect(menu.getByRole('menuitem').last()).toBeFocused()
    await pickerKey('Enter')
    await expect
      .poll(() => pageScript('document.getElementById("user").value'))
      .toBe('account9@example.test')
    await expect.poll(pickerOpen).toBe(false)
    await clickField()
    await picker()
    await pickerKey('Escape')
    await expect.poll(pickerOpen).toBe(false)
  })

  for (const count of [1, 3]) {
    test(`keeps full account tooltips inside a ${count}-account picker`, async () => {
      const prefix = 'person.with.a.long.name.and.department.for.signin'
      await seed(count, prefix)
      await clickField()
      const menu = await picker()
      await menu.getByRole('menuitem').first().hover()
      const tooltip = menu.locator('body > [data-native-surface-overlay][aria-hidden="true"]')
      await expect(tooltip).toBeVisible()
      await expect(tooltip).toHaveText(`${prefix}1@example.test`)
      await expect
        .poll(() =>
          tooltip.evaluate((element) => {
            const rect = element.getBoundingClientRect()
            return (
              rect.left >= 0 &&
              rect.top >= 0 &&
              rect.right <= innerWidth &&
              rect.bottom <= innerHeight
            )
          })
        )
        .toBe(true)
      await app.evaluate(({ BrowserWindow }, pickerUrl) => {
        BrowserWindow.getAllWindows()
          .find((window) => window.webContents.getURL().includes(pickerUrl))
          ?.setContentSize(800, 600)
      }, PICKER_PAGE)
      await menu
        .getByRole('menuitem')
        .first()
        .hover({ position: { x: 100, y: 14 } })
      await expect
        .poll(() =>
          tooltip.evaluate((element) => {
            const rect = element.getBoundingClientRect()
            return (
              rect.left >= 100 &&
              rect.top >= 0 &&
              rect.right <= innerWidth &&
              rect.bottom <= innerHeight
            )
          })
        )
        .toBe(true)
    })
  }

  test('dismisses an inactive picker on outside input and hides it when its page disappears', async () => {
    await clickField()
    await picker()
    await host.getByRole('button', { name: 'Outside the browser' }).click()
    await expect.poll(pickerOpen).toBe(false)
    await expect(host.getByRole('button', { name: 'Outside the browser' })).toBeFocused()
    await clickField()
    await picker()
    await host.evaluate((scope) => {
      ;(globalThis as DesktopBridge).simDesktop.browserAgent.setPanelBounds(null, null, scope)
    }, SCOPE)
    await expect.poll(pickerOpen).toBe(false)
    expect(await pageScript('document.getElementById("pass").value')).toBe('')
  })

  test('returns keyboard focus to the login after dismissal and selection', async () => {
    await clickField()
    await picker()
    await loginKey('Down')
    await expect.poll(pickerFocused).toBe(true)
    await pickerKey('Escape')
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow, webContents }) => ({
          window: BrowserWindow.getFocusedWindow()?.webContents.getURL(),
          page: webContents.getFocusedWebContents()?.getURL(),
        }))
      )
      .toEqual({ window: host.url(), page: `${fixture.site}/login` })
    await app.evaluate(({ webContents }) => {
      const page = webContents.getFocusedWebContents()
      if (!page) throw new Error('No focused page')
      page.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
      page.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
    })
    await expect.poll(() => pageScript('document.activeElement.id')).toBe('pass')
    const menu = await picker()
    await choose(menu, menu.getByRole('menuitem').first())
    await expect
      .poll(() => app.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL()))
      .toBe(`${fixture.site}/login`)
  })

  test('rejects replaced fields and excludes account creation', async () => {
    await clickField()
    await picker()
    await pageScript(
      'document.querySelector("form").innerHTML = \'<input id="user" autocomplete="username"><input id="pass" type="password" autocomplete="new-password">\''
    )
    await expect.poll(pickerOpen).toBe(false)
    await clickField('pass')
    // The click must have landed, or the checks below would pass without exercising anything.
    await expect.poll(() => pageScript('document.activeElement.id')).toBe('pass')
    expect(await pageScript('document.getElementById("pass").value')).toBe('')
    expect(pickerOpen()).toBe(false)
  })

  test('offers a focused manual chooser with one account', async () => {
    await seed(1)
    await host.evaluate(async (scope) => {
      const api = (globalThis as DesktopBridge).simDesktop
      await api.browserAgent.capturePanelSnapshot(scope)
      if (!(await api.browserAgent.setPanelOccluded(true, scope))) {
        throw new Error('Could not open the toolbar overlay')
      }
    }, SCOPE)
    await host.evaluate((scope) => {
      const outside = document.getElementById('outside')
      if (!outside) throw new Error('Missing outside button')
      outside.onclick = async () => {
        const api = (globalThis as DesktopBridge).simDesktop
        await api.browserAgent.setPanelOccluded(false, scope)
        await api.browserCredentials.showChooser({ x: 20, y: 80 }, scope)
      }
    }, SCOPE)
    await host.getByRole('button', { name: 'Outside the browser' }).click()
    const menu = await picker()
    await expect(menu.getByRole('menuitem')).toHaveCount(1)
    await expect.poll(pickerFocused).toBe(true)
    await choose(menu, menu.getByRole('menuitem'))
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
    // A failed fill keeps the picker open to show why.
    await menu.getByRole('menuitem').first().click()
    await expect(menu.getByRole('alert')).toHaveText(
      'Could not fill this form. Select the field again.'
    )
    expect(await pageScript('document.getElementById("pass").value')).toBe('')
  })

  test('closes on navigation and never fills the destination', async () => {
    await clickField()
    await picker()
    await navigate(`${fixture.site}/login?next=1`)
    await expect.poll(pickerOpen).toBe(false)
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
        .find((contents) => contents.getURL().startsWith(`${site}/login`))
      if (!page) throw new Error('Missing fixture page')
      const point = await page.executeJavaScript(
        '(() => {const r=document.getElementById("shadow").shadowRoot.getElementById("pass").getBoundingClientRect();return {x:Math.round(r.x+4),y:Math.round(r.y+4)}})()'
      )
      page.focus()
      page.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
      page.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
    }, fixture.site)
    const menu = await picker()
    await choose(menu, menu.getByRole('menuitem').first())
    await expect
      .poll(() =>
        pageScript('document.getElementById("shadow").shadowRoot.getElementById("pass").value')
      )
      .toBe('fixture-secret-0')
    expect(await pageScript('document.body.dataset.input')).toBe('yes')
  })
})
