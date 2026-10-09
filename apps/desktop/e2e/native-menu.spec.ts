import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { ElectronApplication } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'
import { getErrorMessage } from '@sim/utils/errors'

const runFile = promisify(execFile)

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))

const PAGES: Record<string, string> = {
  '/home': `<!doctype html><html><head><title>Sim Fixture</title></head><body>
    <h1 id="app">fixture-app</h1>
    <button id="internal-blank" onclick="window.open('/workspace/two', '_blank')">internal</button>
    <button id="external-blank" onclick="window.open('https://docs.sim.ai/x', '_blank')">external</button>
    <button id="mcp-popup" onclick="window.open('/mcp', 'mcp-oauth-fixture')">mcp</button>
    <button id="external-navigate" onclick="location.href='https://docs.sim.ai/navigation'">navigate</button>
  </body></html>`,
  '/workspace/two': '<!doctype html><html><body><h1 id="two">second-route</h1></body></html>',
  '/login': '<!doctype html><html><body><h1 id="login">fixture-login</h1></body></html>',
}

/** `User-Agent` of every request the fixture origin has served, in arrival order. */
const requestUserAgents: string[] = []

function startFixtureServer(): Promise<{ server: Server; origin: string }> {
  return new Promise((resolvePromise) => {
    const server = createServer((request, response) => {
      requestUserAgents.push(request.headers['user-agent'] ?? '')
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      const sessionCookie = request.headers.cookie
        ?.split(';')
        .map((cookie) => cookie.trim())
        .includes('sim-e2e-session=shared')
      const body =
        path === '/mcp'
          ? sessionCookie
            ? '<!doctype html><html><body><h1 id="mcp">oauth-popup</h1></body></html>'
            : '<!doctype html><html><body><h1 id="unauthorized">sign-in-required</h1></body></html>'
          : PAGES[path]
      if (!body) {
        response.writeHead(404, { 'Content-Type': 'text/html' }).end('<h1>not found</h1>')
        return
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(body)
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolvePromise({ server, origin: `http://127.0.0.1:${port}` })
    })
  })
}

async function launchApp(origin: string): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    cwd: DESKTOP_DIR,
    env: {
      ...process.env,
      SIM_DESKTOP_ORIGIN: origin,
      SIM_DESKTOP_USER_DATA: mkdtempSync(join(tmpdir(), 'sim-desktop-e2e-')),
    },
  })
}

test.describe('desktop shell smoke', () => {
  test.describe.configure({ retries: 0 })
  let server: Server
  let origin: string
  let app: ElectronApplication

  test.beforeAll(async () => {
    ;({ server, origin } = await startFixtureServer())
  })

  test.afterAll(async () => {
    server.close()
  })

  test.afterEach(async () => {
    await app?.close().catch(() => {})
  })

  test('loads the configured origin top-level', async () => {
    app = await launchApp(origin)
    const window = await app.firstWindow()
    await expect(window.locator('#app')).toHaveText('fixture-app')
    expect(window.url()).toBe(`${origin}/home`)
  })

  for (
    let iteration = 1;
    iteration <= Number(process.env.DESKTOP_NATIVE_MENU_CASES ?? 10);
    iteration++
  ) {
    test(`Folder Access opens from the focused main window and server picker (${iteration})`, async () => {
      const checks: {
        name: string
        status: 'passed' | 'failed'
        durationMs: number
        shown?: boolean
        closed?: boolean
        callbackFinished?: boolean
        windowBefore?: unknown
        windowAfter?: unknown
        events?: unknown
        nativeActions?: unknown[]
        parentUrl?: string | null
        error?: string
      }[] = []
      const reportPath =
        process.env.DESKTOP_FOLDER_ACCESS_MENU_REPORT_PATH?.replace(
          '{iteration}',
          String(iteration)
        ) ?? test.info().outputPath('folder-access-menu.json')
      for (const surface of ['main window', 'server picker']) {
        const started = Date.now()
        const check: (typeof checks)[number] = {
          name: `Folder Access opens in the ${surface}`,
          status: 'failed',
          durationMs: 0,
        }
        checks.push(check)
        try {
          if (surface === 'main window') {
            app = await launchApp(origin)
            const window = await app.firstWindow()
            await expect(window.locator('#app')).toHaveText('fixture-app')
          }
          const expectedUrl =
            surface === 'main window' ? `${origin}/home` : 'sim-shell://pages/server.html'
          if (surface === 'server picker') {
            const opened = app.waitForEvent('window')
            await app.evaluate(({ Menu }) => {
              const item = Menu.getApplicationMenu()
                ?.items.flatMap((entry) => entry.submenu?.items ?? [])
                .find((entry) => entry.label === 'Server…')
              if (!item) throw new Error('Server menu item missing')
              item.click()
            })
            const picker = await opened
            await expect(picker).toHaveURL(expectedUrl)
            await expect(picker.getByLabel('Server URL')).toBeFocused()
          }
          await expect
            .poll(
              () =>
                app.evaluate(
                  ({ BrowserWindow }, url) =>
                    BrowserWindow.getAllWindows()
                      .find((candidate) => candidate.webContents.getURL() === url)
                      ?.isVisible(),
                  expectedUrl
                ),
              { message: `The ${surface} must be natively visible before menu interaction` }
            )
            .toBe(true)
          await app.evaluate(({ app, BrowserWindow }, url) => {
            const focused = BrowserWindow.getAllWindows().find(
              (candidate) => candidate.webContents.getURL() === url
            )
            if (!focused) throw new Error('Expected menu owner is missing')
            app.focus({ steal: true })
            focused.focus()
          }, expectedUrl)
          await expect
            .poll(() =>
              app.evaluate(({ BrowserWindow }) =>
                BrowserWindow.getFocusedWindow()?.webContents.getURL()
              )
            )
            .toBe(expectedUrl)
          const nativeActions: unknown[] = []
          check.nativeActions = nativeActions
          const native = async (command: string) => {
            const { stdout } = await runFile(
              process.env.DESKTOP_NATIVE_MENU_HELPER ?? '/tmp/sim-native-menu',
              [String(app.process().pid), command]
            )
            const result = JSON.parse(stdout) as {
              ok: boolean
              ready?: boolean
              item?: { enabled?: boolean }
            }
            nativeActions.push(result)
            return result
          }
          const observation = await app.evaluateHandle(({ BrowserWindow, Menu, screen }) => {
            const focused = BrowserWindow.getFocusedWindow()
            if (!focused) throw new Error('Focused menu owner missing')
            const state: {
              shown: boolean
              parentUrl: string | null
              closed: boolean
              menu: Electron.Menu | null
              owner: Electron.BrowserWindow
              callbackFinished: boolean
              events: { name: string; at: number }[]
              windowBefore: unknown
              windowAtPopup: unknown
              pointerBefore: unknown
              pointerAtPopup: unknown
              restore: () => void
            } = {
              shown: false,
              parentUrl: null,
              closed: false,
              menu: null,
              owner: focused,
              callbackFinished: false,
              events: [{ name: 'menu-invoked', at: Date.now() }],
              restore: () => {
                Menu.prototype.popup = originalPopup
              },
              pointerBefore: screen.getCursorScreenPoint(),
              pointerAtPopup: null,
              windowAtPopup: null,
              windowBefore: {
                visible: focused.isVisible(),
                focused: focused.isFocused(),
                modal: focused.isModal(),
                bounds: focused.getBounds(),
                parentId: focused.getParentWindow()?.id ?? null,
                url: focused.webContents.getURL(),
              },
            }
            const originalPopup = Menu.prototype.popup
            Menu.prototype.popup = function (options) {
              state.menu = this
              state.pointerAtPopup = screen.getCursorScreenPoint()
              state.windowAtPopup = {
                visible: focused.isVisible(),
                focused: focused.isFocused(),
                modal: focused.isModal(),
                bounds: focused.getBounds(),
                parentId: focused.getParentWindow()?.id ?? null,
                url: focused.webContents.getURL(),
              }
              state.events.push({ name: 'popup-invoked', at: Date.now() })
              const parent = options?.window
              if (parent instanceof BrowserWindow) state.parentUrl = parent.webContents.getURL()
              this.once('menu-will-show', () => {
                state.shown = true
                state.events.push({ name: 'menu-will-show', at: Date.now() })
              })
              this.once('menu-will-close', () => {
                state.closed = true
                state.events.push({ name: 'menu-will-close', at: Date.now() })
              })
              originalPopup.call(this, {
                ...options,
                callback: () => {
                  state.callbackFinished = true
                  state.events.push({ name: 'popup-callback', at: Date.now() })
                  options?.callback?.()
                },
              })
            }
            return state
          })
          try {
            expect((await native('open')).ok).toBe(true)
            await expect
              .poll(
                async () => {
                  const result = await native('inspect')
                  return result.ready && result.item?.enabled
                },
                { message: 'The real File menu must expose an enabled Folder Access item' }
              )
              .toBe(true)
            expect((await native('click')).ok).toBe(true)
            await expect
              .poll(() => observation.evaluate(({ shown, parentUrl }) => ({ shown, parentUrl })), {
                message: `Folder Access should open in the ${surface}`,
              })
              .toEqual({ shown: true, parentUrl: expectedUrl })
            await observation.evaluate(({ menu }) => menu?.closePopup())
            await expect
              .poll(() => observation.evaluate(({ closed }) => closed), {
                message: `Folder Access should close in the ${surface}`,
              })
              .toBe(true)
          } finally {
            Object.assign(
              check,
              await observation.evaluate(
                ({
                  shown,
                  parentUrl,
                  closed,
                  callbackFinished,
                  owner,
                  windowBefore,
                  windowAtPopup,
                  pointerBefore,
                  pointerAtPopup,
                  events,
                }) => ({
                  shown,
                  parentUrl,
                  closed,
                  callbackFinished,
                  windowBefore,
                  windowAtPopup,
                  pointerBefore,
                  pointerAtPopup,
                  events,
                  windowAfter: owner.isDestroyed()
                    ? { destroyed: true }
                    : {
                        visible: owner.isVisible(),
                        focused: owner.isFocused(),
                        modal: owner.isModal(),
                        bounds: owner.getBounds(),
                        parentId: owner.getParentWindow()?.id ?? null,
                        url: owner.webContents.getURL(),
                      },
                })
              )
            )
            await observation.evaluate(({ menu, restore }) => {
              menu?.closePopup()
              restore()
            })
            await observation.dispose()
          }
          check.status = 'passed'
        } catch (error) {
          check.error = getErrorMessage(error)
          throw error
        } finally {
          check.durationMs = Date.now() - started
          mkdirSync(dirname(reportPath), { recursive: true })
          writeFileSync(reportPath, JSON.stringify({ iteration, checks }, null, 2))
          process.stdout.write(
            `FOLDER_ACCESS_MENU_REPORT ${JSON.stringify({ iteration, checks })}\n`
          )
        }
      }
    })
  }
})
