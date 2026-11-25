import type { ElectronApplication, Page } from '@playwright/test'
import {
  attachBrowserPanel,
  expect,
  type FixtureServer,
  type LaunchOptions,
  ToolAuthorizer,
  test,
} from './harness'
import { serveSignedIn } from './session-fixture'

const SCOPE = 'session-cookies-fixture'

/**
 * Electron drops every expiry-less cookie on quit, so a site that keeps its
 * login in a session cookie signed the user out of the built-in browser on
 * every restart. This drives a real quit and relaunch against one profile.
 */
test.describe('built-in browser session cookies', () => {
  let fixture: FixtureServer
  let lastCookieHeader: string | undefined
  const authorizer = new ToolAuthorizer('fixture')

  test.beforeAll(async () => {
    fixture = await serveSignedIn({
      page: '<!doctype html><title>Sim fixture</title><h1>Session cookie fixture</h1>',
      handle: async (request, response, url) => {
        if (await authorizer.handle(request, response, url)) return true
        if (url.pathname === '/sign-in') {
          // A login redirect that sets a short-lived cookie the next hop deletes.
          response.writeHead(302, {
            'Set-Cookie': 'oauth_state=pending; HttpOnly; Path=/',
            Location: '/signed-in',
          })
          response.end()
          return true
        }
        if (url.pathname === '/signed-in') {
          response.writeHead(200, {
            'Content-Type': 'text/html',
            'Set-Cookie': [
              'oauth_state=; Path=/; Max-Age=0',
              'login=fixture; HttpOnly; SameSite=Lax; Path=/',
              'remember=1; Path=/; Max-Age=3600',
            ],
          })
          response.end('<!doctype html><title>Signed in</title>')
          return true
        }
        if (url.pathname === '/account') {
          lastCookieHeader = request.headers.cookie ?? ''
          response.writeHead(200, { 'Content-Type': 'text/html' })
          response.end('<!doctype html><title>Account</title>')
          return true
        }
        if (request.headers.host?.startsWith('localhost')) {
          // Favicon and other stray site requests must not set the app session cookie on the site.
          response.writeHead(404)
          response.end()
          return true
        }
        return false
      },
    })
  })

  test.afterAll(async () => {
    await fixture.close()
  })

  async function openShell(app: ElectronApplication) {
    const host = await app.firstWindow()
    await expect(host.getByRole('heading')).toHaveText('Session cookie fixture')
    await attachBrowserPanel(host, SCOPE)
    return host
  }

  /** The cookies the built-in browser sends to the site (`fixture.site`, its own partition). */
  async function cookiesSentToSite(host: Page): Promise<string[]> {
    lastCookieHeader = undefined
    await authorizer.execute(host, SCOPE, 'browser_open_url', { url: `${fixture.site}/account` })
    await expect.poll(() => lastCookieHeader).not.toBeUndefined()
    return (lastCookieHeader ?? '')
      .split(';')
      .map((pair) => pair.trim())
      .filter(Boolean)
      .sort()
  }

  test('keeps a session-cookie login across a restart without reviving deleted cookies', async ({
    desktop,
  }) => {
    const options: LaunchOptions = {
      origin: fixture.origin,
    }
    const first = await desktop.launch(options)
    const host = await openShell(first.app)
    await authorizer.execute(host, SCOPE, 'browser_open_url', { url: `${fixture.site}/sign-in` })
    expect(await cookiesSentToSite(host)).toEqual(['login=fixture', 'remember=1'])

    await first.app.evaluate(({ session }) =>
      session.fromPartition('persist:sim-browser-agent').cookies.flushStore()
    )
    await desktop.close(first)

    const relaunched = await desktop.launch({ ...options, userData: first.userData })
    expect(await cookiesSentToSite(await openShell(relaunched.app))).toEqual([
      'login=fixture',
      'remember=1',
    ])
  })
})
