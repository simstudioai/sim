import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test'
import type { SimDesktopApi } from '@sim/desktop-bridge'

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))
const SCOPE = 'session-cookies-fixture'

/**
 * Electron drops every expiry-less cookie on quit, so a site that keeps its
 * login in a session cookie signed the user out of the built-in browser on
 * every restart. This drives a real quit and relaunch against one profile.
 */
test.describe('built-in browser session cookies', () => {
  let server: Server
  let origin: string
  let site: string
  let userData: string
  let app: ElectronApplication | undefined
  let serial = 0
  let lastCookieHeader: string | undefined
  const calls = new Map<
    string,
    { chatId: string; toolName: string; args: Record<string, unknown> }
  >()

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
      if (path === '/sign-in') {
        // A login redirect that sets a short-lived cookie the next hop deletes.
        response.writeHead(302, {
          'Set-Cookie': 'oauth_state=pending; HttpOnly; Path=/',
          Location: '/signed-in',
        })
        response.end()
        return
      }
      if (path === '/signed-in') {
        response.writeHead(200, {
          'Content-Type': 'text/html',
          'Set-Cookie': [
            'oauth_state=; Path=/; Max-Age=0',
            'login=fixture; HttpOnly; SameSite=Lax; Path=/',
            'remember=1; Path=/; Max-Age=3600',
          ],
        })
        response.end('<!doctype html><title>Signed in</title>')
        return
      }
      if (path === '/account') {
        lastCookieHeader = request.headers.cookie ?? ''
        response.writeHead(200, { 'Content-Type': 'text/html' })
        response.end('<!doctype html><title>Account</title>')
        return
      }
      if (request.headers.host?.startsWith('localhost')) {
        // Favicon and other stray site requests must not set the app session cookie on the site.
        response.writeHead(404)
        response.end()
        return
      }
      response.writeHead(200, {
        'Content-Type': 'text/html',
        'Set-Cookie': 'better-auth.session_token=fixture; HttpOnly; SameSite=Lax; Path=/',
      })
      response.end('<!doctype html><title>Sim fixture</title><h1>Session cookie fixture</h1>')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    origin = `http://127.0.0.1:${address.port}`
    /** Pages outside the app origin browse in the built-in browser's own partition. */
    site = `http://localhost:${address.port}`
  })

  test.beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'sim-session-cookies-e2e-'))
  })

  test.afterEach(async () => {
    await app?.close()
    app = undefined
    rmSync(userData, { recursive: true, force: true })
    calls.clear()
  })

  test.afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  })

  async function launch(): Promise<ElectronApplication> {
    const launched = await electron.launch({
      args: [process.env.SIM_DESKTOP_E2E_MAIN ?? '.'],
      cwd: DESKTOP_DIR,
      env: { ...process.env, SIM_DESKTOP_ORIGIN: origin, SIM_DESKTOP_USER_DATA: userData },
    })
    const host = await launched.firstWindow()
    await expect(host.getByRole('heading')).toHaveText('Session cookie fixture')
    await host.evaluate(async (scope) => {
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
    return launched
  }

  async function navigate(target: ElectronApplication, url: string) {
    const id = `fixture-${++serial}`
    calls.set(id, { chatId: SCOPE, toolName: 'browser_open_url', args: { url } })
    const host = await target.firstWindow()
    const result = await host.evaluate(
      async ({ id, url, scope }) => {
        const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
        return api.browserAgent.executeTool(id, 'browser_open_url', { url }, scope)
      },
      { id, url, scope: SCOPE }
    )
    expect(result.ok, result.error).toBe(true)
  }

  async function cookiesSentToSite(target: ElectronApplication): Promise<string[]> {
    lastCookieHeader = undefined
    await navigate(target, `${site}/account`)
    await expect.poll(() => lastCookieHeader).not.toBeUndefined()
    return (lastCookieHeader ?? '')
      .split(';')
      .map((pair) => pair.trim())
      .filter(Boolean)
      .sort()
  }

  test('keeps a session-cookie login across a restart without reviving deleted cookies', async () => {
    app = await launch()
    await navigate(app, `${site}/sign-in`)
    expect(await cookiesSentToSite(app)).toEqual(['login=fixture', 'remember=1'])

    await app.evaluate(({ session }) =>
      session.fromPartition('persist:sim-browser-agent').cookies.flushStore()
    )
    await app.close()

    app = await launch()
    expect(await cookiesSentToSite(app)).toEqual(['login=fixture', 'remember=1'])
  })
})
