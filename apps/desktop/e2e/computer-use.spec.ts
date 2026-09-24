import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test'
import type { SimDesktopApi } from '@sim/desktop-bridge'

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))

test('computer use reaches the actual helper only with canonical one-shot authorization', async () => {
  test.skip(process.platform !== 'darwin', 'The native helper is macOS-only.')
  const root = mkdtempSync(join(tmpdir(), 'sim-computer-use-e2e-'))
  let server: Server | undefined
  let app: ElectronApplication | undefined
  let claimed = false
  let authorizationCount = 0
  let releaseAuthorization: () => void = () => {}
  let markAuthorizationStarted: () => void = () => {}
  const authorizationStarted = new Promise<void>((resolve) => {
    markAuthorizationStarted = resolve
  })
  const authorizationReleased = new Promise<void>((resolve) => {
    releaseAuthorization = resolve
  })
  try {
    server = createServer(async (request, response) => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      if (path === '/api/auth/get-session') {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            user: { id: 'computer-test' },
            session: { id: 'computer-test-session' },
          })
        )
        return
      }
      if (path === '/api/desktop/computer/authorize') {
        authorizationCount += 1
        let body = ''
        for await (const chunk of request) body += chunk.toString()
        const input = JSON.parse(body)
        expect(Object.keys(input)).toEqual(['toolCallId'])
        if (input.toolCallId === 'delayed') {
          markAuthorizationStarted()
          await authorizationReleased
        } else if (input.toolCallId !== 'status-once' || claimed) {
          response.writeHead(403, { 'Content-Type': 'application/json' }).end('{}')
          return
        }
        claimed = true
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            chatId: 'computer-chat',
            toolName: 'computer',
            args: { action: 'status' },
          })
        )
        return
      }
      response
        .writeHead(200, {
          'Content-Type': 'text/html',
          'Set-Cookie': 'better-auth.session_token=fixture; HttpOnly; SameSite=Lax; Path=/',
        })
        .end(
          `<!doctype html><title>Computer Use fixture</title><h1>Computer Use</h1><button id="disable">Disable Computer Use</button><output id="status"></output><script>document.getElementById('disable').onclick=async()=>{const state=await window.simDesktop.computerUse.setEnabled(false);document.getElementById('status').textContent=String(state.enabled)}</script>`
        )
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing local fixture port')
    const profile = join(root, 'profile')
    mkdirSync(profile)
    writeFileSync(
      join(profile, 'settings.json'),
      JSON.stringify({ origin: `http://127.0.0.1:${address.port}`, computerUseEnabled: true })
    )
    app = await electron.launch({
      args: ['.'],
      cwd: DESKTOP_DIR,
      env: {
        ...process.env,
        SIM_DESKTOP_ORIGIN: `http://127.0.0.1:${address.port}`,
        SIM_DESKTOP_USER_DATA: profile,
      },
    })
    const window = await app.firstWindow()
    await expect(window.getByRole('heading')).toHaveText('Computer Use')
    const status = await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
      return api.computerUse?.getStatus()
    })
    expect(status).toMatchObject({ supported: true, enabled: true, activeAction: null })
    const result = await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
      return api.computerUse?.executeTool('status-once', {
        action: 'get_app_state',
        bundleId: 'com.apple.systempreferences',
      })
    })
    expect(result).toMatchObject({ kind: 'status', platform: 'darwin' })
    const replay = await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
      try {
        await api.computerUse?.executeTool('status-once', { action: 'status' })
        return 'unexpected success'
      } catch {
        return 'rejected'
      }
    })
    expect(replay).toBe('rejected')
    expect(authorizationCount).toBe(2)
    const delayed = window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
      try {
        await api.computerUse?.executeTool('delayed', { action: 'status' })
        return 'unexpected success'
      } catch {
        return 'stopped'
      }
    })
    await authorizationStarted
    await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
      await api.computerUse?.cancel('delayed')
    })
    releaseAuthorization()
    expect(await delayed).toBe('stopped')
    expect(authorizationCount).toBe(3)
    await window.getByRole('button', { name: 'Disable Computer Use' }).click()
    await expect(window.locator('#status')).toHaveText('false')
    const disabled = await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
      try {
        await api.computerUse?.executeTool('disabled', { action: 'status' })
        return 'unexpected success'
      } catch {
        return 'rejected'
      }
    })
    expect(disabled).toBe('rejected')
    expect(authorizationCount).toBe(3)
  } finally {
    releaseAuthorization()
    await app?.close()
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    rmSync(root, { recursive: true, force: true })
  }
})
