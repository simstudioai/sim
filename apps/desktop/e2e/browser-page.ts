/**
 * Shared pieces for specs that drive a page in the desktop's native browser panel from a Sim shell
 * fixture: the fixture server, the shell bring-up, browser-chrome actions, and reads and trusted
 * input aimed at the page with an exact URL.
 */
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import type { BrowserPanelAction } from '@sim/browser-protocol'
import {
  attachBrowserPanel,
  type DesktopBridge,
  expect,
  type FixtureHandler,
  type FixtureServer,
  focusFirstWindow,
  SIM_DIR,
  type SimFixtureBundle,
  serve,
  type ToolAuthorizer,
} from './harness'

export const BROWSER_SESSION_COMPONENTS = join(
  SIM_DIR,
  'app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session'
)

interface ShellFixtureOptions {
  heading: string
  /** Where the native browser panel starts below the shell's own UI. */
  top: number
}

/**
 * Serves the shell on the app origin (with a session cookie) and hands requests to the `site`
 * alias, which the browser panel treats as the web, to `site`.
 */
export function serveShellAndSite(
  options: ShellFixtureOptions & {
    bundle: SimFixtureBundle
    authorizer: ToolAuthorizer
    site: FixtureHandler
  }
): Promise<FixtureServer> {
  const html = `<!doctype html><title>Sim fixture</title><link rel="stylesheet" href="/fixture.css"><h1>${options.heading}</h1><div id="root"></div><div id="native-panel" style="position:absolute;top:${options.top}px;bottom:0;left:0;right:0"></div><script src="/fixture.js"></script>`
  return serve(async (request, response, url) => {
    if (url.pathname === '/fixture.js' || url.pathname === '/fixture.css') {
      const js = url.pathname.endsWith('.js')
      response.setHeader('Content-Type', js ? 'text/javascript' : 'text/css')
      response.end(js ? options.bundle.js : options.bundle.css)
      return
    }
    if (await options.authorizer.handle(request, response, url)) return
    if (request.headers.host?.startsWith('localhost')) {
      await options.site(request, response, url)
      return
    }
    response.writeHead(200, {
      'Content-Type': 'text/html',
      'Set-Cookie': 'better-auth.session_token=fixture; HttpOnly; Path=/',
    })
    response.end(html)
  })
}

/** Focuses the shell window, waits for its fixture UI, and puts the browser panel below it. */
export async function openShell(
  app: ElectronApplication,
  scope: string,
  options: ShellFixtureOptions
): Promise<Page> {
  const shell = await app.firstWindow()
  await focusFirstWindow(app)
  await expect(shell.getByRole('heading')).toHaveText(options.heading)
  await attachBrowserPanel(shell, scope, options.top)
  return shell
}

/** Browser-chrome actions are user gestures, so each follows a real click in Sim. */
export async function panelAction(
  shell: Page,
  scope: string,
  action: BrowserPanelAction
): Promise<void> {
  await shell.getByRole('heading').click()
  await shell.evaluate(
    ({ action, scope }) =>
      (globalThis as DesktopBridge).simDesktop.browserAgent.panelAction(action, scope),
    { action, scope }
  )
}

/** Runs a script in the page at exactly `url`; throws while no page is there, so polls retry. */
export function inPage<T>(
  app: ElectronApplication,
  url: string,
  script: string,
  { userGesture = false } = {}
): Promise<T> {
  return app.evaluate(
    async ({ webContents }, { url, script, userGesture }) => {
      const contents = webContents
        .getAllWebContents()
        .find((candidate) => !candidate.isDestroyed() && candidate.getURL() === url)
      if (!contents) throw new Error(`No page at ${url}`)
      return (await contents.executeJavaScript(script, userGesture)) as T
    },
    { url, script, userGesture }
  )
}

/** Read from the main process: a script cannot run in a page while its dialog is open. */
export function titleAt(app: ElectronApplication, url: string): Promise<string | null> {
  return app.evaluate(
    ({ webContents }, url) =>
      webContents
        .getAllWebContents()
        .find((candidate) => !candidate.isDestroyed() && candidate.getURL() === url)
        ?.getTitle() ?? null,
    url
  )
}

export function focusedPageUrl(app: ElectronApplication): Promise<string | undefined> {
  return app.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())
}

/**
 * Trusted input into the page at `url`, the way the user's own mouse and keys arrive: a click on
 * `selector`, then `text` typed. The events are queued, so callers wait for their effect.
 */
export function userInput(
  app: ElectronApplication,
  url: string,
  selector: string,
  text = ''
): Promise<void> {
  return app.evaluate(
    async ({ webContents }, { url, selector, text }) => {
      const contents = webContents
        .getAllWebContents()
        .find((candidate) => !candidate.isDestroyed() && candidate.getURL() === url)
      if (!contents) throw new Error(`No page at ${url}`)
      const rect: { x: number; y: number } = await contents.executeJavaScript(
        `(() => { const { x, y } = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x, y } })()`
      )
      const point = { x: Math.round(rect.x + 3), y: Math.round(rect.y + 3) }
      contents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
      contents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
      for (const character of text) contents.sendInputEvent({ type: 'char', keyCode: character })
    },
    { url, selector, text }
  )
}
