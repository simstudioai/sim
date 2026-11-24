import type { Page } from '@playwright/test'
import { type DesktopBridge, expect, test } from './harness'
import { serveSignedIn } from './session-fixture'

/** Runs a computer tool call from the page; resolves 'rejected' when the desktop refuses it. */
function runTool(window: Page, toolCallId: string): Promise<string> {
  return window.evaluate(async (toolCallId) => {
    const api = (globalThis as DesktopBridge).simDesktop
    try {
      await api.computerUse?.executeTool(toolCallId, { action: 'status' })
      return 'unexpected success'
    } catch {
      return 'rejected'
    }
  }, toolCallId)
}

test('computer use reaches the actual helper only with canonical one-shot authorization', async ({
  desktop,
}) => {
  test.skip(process.platform !== 'darwin', 'The native helper is macOS-only.')
  let claimed = false
  /** The body of every authorization request, checked in the test rather than the handler. */
  const authorizationBodies: unknown[] = []
  let releaseAuthorization: () => void = () => {}
  let markAuthorizationStarted: () => void = () => {}
  const authorizationStarted = new Promise<void>((resolve) => {
    markAuthorizationStarted = resolve
  })
  const authorizationReleased = new Promise<void>((resolve) => {
    releaseAuthorization = resolve
  })
  const fixture = await serveSignedIn({
    page: `<!doctype html><title>Computer Use fixture</title><h1>Computer Use</h1><button id="disable">Disable Computer Use</button><output id="status"></output><script>document.getElementById('disable').onclick=async()=>{const state=await window.simDesktop.computerUse.setEnabled(false);document.getElementById('status').textContent=String(state.enabled)}</script>`,
    handle: async (request, response, url) => {
      if (url.pathname !== '/api/desktop/computer/authorize') return false
      let body = ''
      for await (const chunk of request) body += chunk.toString()
      const input = JSON.parse(body)
      authorizationBodies.push(input)
      if (Object.keys(input).join() !== 'toolCallId') {
        response.writeHead(400, { 'Content-Type': 'application/json' }).end('{}')
        return true
      }
      if (input.toolCallId === 'delayed') {
        markAuthorizationStarted()
        await authorizationReleased
      } else if (input.toolCallId !== 'status-once' || claimed) {
        response.writeHead(403, { 'Content-Type': 'application/json' }).end('{}')
        return true
      }
      claimed = true
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          chatId: 'computer-chat',
          toolName: 'computer',
          args: { action: 'status' },
        })
      )
      return true
    },
  })
  try {
    const { app } = await desktop.launch({
      origin: fixture.origin,
      settings: { origin: fixture.origin, computerUseEnabled: true },
    })
    const window = await app.firstWindow()
    await expect(window.getByRole('heading')).toHaveText('Computer Use')

    await test.step('an authorized call reaches the helper once and a replay is refused', async () => {
      const status = await window.evaluate(() =>
        (globalThis as DesktopBridge).simDesktop.computerUse?.getStatus()
      )
      expect(status).toMatchObject({ supported: true, enabled: true, activeAction: null })
      const result = await window.evaluate(() =>
        (globalThis as DesktopBridge).simDesktop.computerUse?.executeTool('status-once', {
          action: 'get_app_state',
          bundleId: 'com.apple.systempreferences',
        })
      )
      expect(result).toMatchObject({ kind: 'status', platform: 'darwin' })
      expect(await runTool(window, 'status-once')).toBe('rejected')
      expect(authorizationBodies).toEqual([
        { toolCallId: 'status-once' },
        { toolCallId: 'status-once' },
      ])
    })

    await test.step('cancelling while authorization is pending stops the call', async () => {
      const delayed = runTool(window, 'delayed')
      await authorizationStarted
      await window.evaluate(() =>
        (globalThis as DesktopBridge).simDesktop.computerUse?.cancel('delayed')
      )
      releaseAuthorization()
      expect(await delayed).toBe('rejected')
      expect(authorizationBodies).toHaveLength(3)
    })

    await test.step('turning computer use off refuses calls before asking Sim', async () => {
      await window.getByRole('button', { name: 'Disable Computer Use' }).click()
      await expect(window.locator('#status')).toHaveText('false')
      expect(await runTool(window, 'disabled')).toBe('rejected')
      expect(authorizationBodies).toHaveLength(3)
    })
  } finally {
    releaseAuthorization()
    await fixture.close()
  }
})
