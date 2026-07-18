import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { generateShortId } from '@sim/utils/id'
import type { BrowserWindow } from 'electron'
import { app, dialog } from 'electron'
import type { EventRecorder } from '@/main/observability'

const logger = createLogger('DesktopHandoff')

const TOKEN_PATTERN = /^[A-Za-z0-9_.-]{8,512}$/
const STATE_PATTERN = /^[A-Za-z0-9_-]{16,256}$/
const STATE_LENGTH = 32
const REDEEM_PATH = '/api/auth/one-time-token/verify'
const CALLBACK_PATH = '/auth/callback'
// Measured from begin() (when the browser opens) so it comfortably covers a
// full interactive login — email/OTP round-trips or OAuth consent — not just
// the redirect back. Bounds how long the loopback listener and the CSRF state
// stay valid.
const HANDOFF_TTL_MS = 30 * 60 * 1000

const CALLBACK_RESPONSE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Sim</title></head>
<body style="font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<p>You’re signed in — return to the Sim app. You can close this tab.</p>
</body></html>`

export interface HandoffCallback {
  token: string
  state: string
}

export interface HandoffManagerDeps {
  origin: () => string
  openExternal: (url: string) => Promise<boolean>
  events: EventRecorder
  now?: () => number
}

export interface HandoffManager {
  begin(): Promise<boolean>
  consume(state: string): boolean
  clear(): void
}

/**
 * Owns the system-browser login handoff. The only callback channel is a
 * one-shot 127.0.0.1 loopback server (RFC 8252 §7.3) — no OS scheme
 * registration, works identically in dev and packaged builds. Because the app
 * is always running when the browser redirects back (it started the loopback),
 * the pending state lives in memory: single-use, constant-time compared,
 * TTL-bounded. There is no second delivery mechanism and nothing to persist.
 */
export function createHandoffManager(
  deps: HandoffManagerDeps,
  onCallback: (callback: HandoffCallback) => void
): HandoffManager {
  const now = deps.now ?? Date.now
  let loopbackServer: Server | null = null
  let loopbackTimer: NodeJS.Timeout | undefined
  let pending: { state: string; createdAt: number } | null = null

  const stopLoopback = () => {
    clearTimeout(loopbackTimer)
    loopbackTimer = undefined
    if (loopbackServer) {
      loopbackServer.close()
      loopbackServer = null
    }
  }

  const startLoopback = async (): Promise<number | undefined> => {
    stopLoopback()
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
        response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
        return
      }
      const token = url.searchParams.get('token') ?? ''
      const state = url.searchParams.get('state') ?? ''
      if (!TOKEN_PATTERN.test(token) || !STATE_PATTERN.test(state)) {
        response.writeHead(400, { 'Content-Type': 'text/plain' }).end('Invalid request')
        return
      }
      response
        .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(CALLBACK_RESPONSE_HTML)
      stopLoopback()
      onCallback({ token, state })
    })
    loopbackServer = server
    try {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        server.once('error', rejectPromise)
        server.listen(0, '127.0.0.1', () => resolvePromise())
      })
    } catch (error) {
      logger.error('Could not start the loopback server', { error })
      loopbackServer = null
      return undefined
    }
    loopbackTimer = setTimeout(stopLoopback, HANDOFF_TTL_MS)
    const address = server.address()
    return typeof address === 'object' && address ? address.port : undefined
  }

  const clear = () => {
    stopLoopback()
    pending = null
  }

  return {
    async begin() {
      const state = generateShortId(STATE_LENGTH)
      const port = await startLoopback()
      if (!port) {
        return false
      }
      pending = { state, createdAt: now() }
      const landing = new URL('/desktop/auth', deps.origin())
      landing.searchParams.set('state', state)
      landing.searchParams.set('port', String(port))
      deps.events.record('handoff_started')
      const opened = await deps.openExternal(landing.toString())
      if (!opened) {
        clear()
      }
      return opened
    },
    consume(state: string) {
      if (!pending) {
        return false
      }
      if (now() - pending.createdAt > HANDOFF_TTL_MS) {
        clear()
        return false
      }
      if (!safeCompare(pending.state, state)) {
        return false
      }
      clear()
      return true
    },
    clear,
  }
}

/**
 * Builds the renderer-side script that redeems a one-time token. Running it in
 * the app-origin renderer makes the request genuinely same-origin, so
 * better-auth's trustedOrigins/CSRF checks pass and the Set-Cookie lands in the
 * app partition.
 */
export function buildRedeemScript(token: string): string {
  const body = JSON.stringify(JSON.stringify({ token }))
  return `(async () => {
  try {
    const response = await fetch('${REDEEM_PATH}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: ${body},
    })
    return response.ok
  } catch {
    return false
  }
})()`
}

/**
 * Redeems a one-time token from the app-partition renderer. If the window is
 * currently off-origin (offline page, in-window IdP flow) it first loads the
 * login page so the redeem fetch is same-origin.
 */
export async function redeemToken(
  win: BrowserWindow,
  origin: string,
  token: string
): Promise<boolean> {
  if (win.isDestroyed()) {
    return false
  }
  const contents = win.webContents
  if (!contents.getURL().startsWith(`${origin}/`)) {
    try {
      await win.loadURL(`${origin}/login`)
    } catch {
      return false
    }
  }
  try {
    const result = await contents.executeJavaScript(buildRedeemScript(token), true)
    return result === true
  } catch (error) {
    logger.error('Token redeem failed', { error })
    return false
  }
}

export interface AuthFlowDeps {
  handoff: HandoffManager
  origin: () => string
  events: EventRecorder
  ensureMainWindow: () => Promise<BrowserWindow>
}

export interface AuthFlow {
  beginLoginHandoff(): Promise<void>
  handleCallback(callback: HandoffCallback): Promise<void>
}

/**
 * Orchestrates the login handoff: opening the system browser, consuming the
 * loopback callback, redeeming the token, and navigating to the workspace. A
 * failed or expired callback never leaves a partial session — the window lands
 * back on /login.
 */
export function createAuthFlow(deps: AuthFlowDeps): AuthFlow {
  const failInWindow = async (win: BrowserWindow, reason: string) => {
    deps.events.record('handoff_redeem_fail', { reason })
    void dialog.showMessageBox(win, {
      type: 'error',
      message: 'Sign-in failed',
      detail: 'The sign-in could not be completed. Try signing in again.',
    })
    try {
      await win.loadURL(`${deps.origin()}/login`)
    } catch {}
  }

  return {
    async beginLoginHandoff() {
      const opened = await deps.handoff.begin()
      if (!opened) {
        const win = await deps.ensureMainWindow()
        void dialog.showMessageBox(win, {
          type: 'error',
          message: 'Couldn’t start sign-in',
          detail: 'Sim could not open your browser to sign in. Try again.',
        })
      }
    },
    async handleCallback(callback: HandoffCallback) {
      const win = await deps.ensureMainWindow()
      if (!deps.handoff.consume(callback.state)) {
        await failInWindow(win, 'state')
        return
      }
      const origin = deps.origin()
      if (!(await redeemToken(win, origin, callback.token))) {
        await failInWindow(win, 'redeem')
        return
      }
      deps.events.record('handoff_redeem_ok')
      try {
        await win.loadURL(`${origin}/workspace`)
      } catch {}
      win.show()
      win.focus()
      app.focus({ steal: true })
    },
  }
}
