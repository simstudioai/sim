import { createLogger } from '@sim/logger'
import type { Session, WebContents } from 'electron'
import { BrowserWindow, dialog } from 'electron'
import { clearBrowserProfile as clearAgentBrowserProfile } from '@/main/browser-agent/driver'
import { isSafeInternalPath } from '@/main/config'
import { isAuthSurfacePath, openExternalSafe } from '@/main/navigation'
import type { EventRecorder } from '@/main/observability'

const logger = createLogger('DesktopSessionLifecycle')

const EXPIRY_PROMPT_COOLDOWN_MS = 30_000
const SESSION_PROBE_TIMEOUT_MS = 5000
const START_ROUTE_PROBE_TIMEOUT_MS = 1500
const TEARDOWN_COOLDOWN_MS = 3000

const CLEARED_STORAGES = [
  'cookies',
  'localstorage',
  'indexdb',
  'cachestorage',
  'serviceworkers',
] as const

export type SessionProbeResult = 'valid' | 'invalid' | 'unknown'

/**
 * Matches the better-auth session cookie across secure and non-secure hosts:
 * `better-auth.session_token` (http/localhost) and
 * `__Secure-better-auth.session_token` (https). Keying off the better-auth
 * cookie name — a stable library contract — is far more robust than sniffing
 * a Sim UI redirect URL, and it catches every sign-out path (settings, invite
 * page, stale-session recovery) uniformly.
 */
export function isSessionCookieName(name: string): boolean {
  return name.endsWith('session_token')
}

/**
 * Detects the web app's sign-out navigation (general settings routes to
 * /login?fromLogout=true on sign-out). This is the fast path; the cookie
 * watcher below is the robust backstop for sign-out paths that don't use it.
 */
export function isLogoutNavigation(rawUrl: string, appOrigin: string): boolean {
  try {
    const url = new URL(rawUrl)
    return (
      url.origin === appOrigin &&
      url.pathname === '/login' &&
      url.searchParams.get('fromLogout') === 'true'
    )
  } catch {
    return false
  }
}

/**
 * Picks the route to load at launch: the last visited route (when safe and
 * not itself an auth surface), falling back to /workspace. A signed-out
 * partition is handled by the web app's own login redirect.
 */
export function decideStartRoute(lastRoute: string | undefined): string {
  if (lastRoute && isSafeInternalPath(lastRoute) && !isAuthSurfacePath(lastRoute)) {
    return lastRoute
  }
  return '/workspace'
}

function workspaceIdFromRoute(route: string): string | null {
  try {
    const pathname = new URL(route, 'https://internal.invalid').pathname
    const match = /^\/workspace\/([^/]+)/.exec(pathname)
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

/**
 * Validates a workspace-specific saved route before Desktop restores it.
 * Only a confirmed 403 discards the route; auth, network, timeout, and server
 * failures preserve normal web-app recovery instead of masquerading as a
 * revoked workspace.
 */
export async function resolveStartRoute(
  session: Session,
  origin: string,
  lastRoute: string | undefined,
  timeoutMs: number = START_ROUTE_PROBE_TIMEOUT_MS
): Promise<string> {
  const route = decideStartRoute(lastRoute)
  const workspaceId = workspaceIdFromRoute(route)
  if (!workspaceId) {
    return route
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await session.fetch(
      `${origin}/api/workspaces/${encodeURIComponent(workspaceId)}/host-context`,
      {
        signal: controller.signal,
        headers: { accept: 'application/json' },
        cache: 'no-store',
      }
    )
    if (response.status === 403) {
      logger.info('Saved workspace route is no longer accessible; opening workspace picker')
      return '/workspace'
    }
    return route
  } catch {
    return route
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Checks whether the partition currently holds a valid session by asking
 * better-auth's get-session endpoint with the partition's cookies. Network
 * trouble reports 'unknown' so offline never masquerades as signed-out.
 */
export async function probeSession(
  session: Session,
  origin: string,
  timeoutMs: number = SESSION_PROBE_TIMEOUT_MS
): Promise<SessionProbeResult> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const response = await session.fetch(`${origin}/api/auth/get-session`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
    clearTimeout(timer)
    if (!response.ok) {
      return 'unknown'
    }
    const data = (await response.json().catch(() => null)) as {
      session?: unknown
      user?: unknown
    } | null
    return data && (data.session || data.user) ? 'valid' : 'invalid'
  } catch {
    return 'unknown'
  }
}

/**
 * Clears every session-bearing storage in the app partition plus any pending
 * handoff secrets — the desktop analogue of a browser profile sign-out.
 *
 * The embedded browser has its own partition, which this clears too: it holds
 * the signed-in user's cookies for third-party sites, so leaving it behind
 * would hand the next account on this machine a set of live sessions. Passed
 * as a defaulted parameter purely so tests can observe it without a live
 * browser session.
 */
export async function tearDownSession(
  session: Session,
  clearHandoffState: () => void | Promise<void>,
  events: EventRecorder,
  clearBrowserProfile: () => Promise<void> = clearAgentBrowserProfile
): Promise<void> {
  events.record('sign_out')
  await clearHandoffState()
  // A failure here must not strand the app-partition clear, which is the part
  // that actually signs the user out.
  await clearBrowserProfile().catch((error) =>
    logger.error('Browser profile teardown failed', { error })
  )
  await session.clearStorageData({ storages: [...CLEARED_STORAGES] })
}

export interface SessionLifecycleDeps {
  appSession: Session
  origin: () => string
  events: EventRecorder
  clearHandoffState: () => void | Promise<void>
  onReauthRequested: () => void
}

export interface SessionLifecycleCoordinator {
  attachWindow(win: BrowserWindow): void
}

interface SessionLifecycleCoordinatorDeps extends SessionLifecycleDeps {
  getWindow: () => BrowserWindow | null
  getWindows: () => BrowserWindow[]
}

/**
 * Owns shared app-session observers once per Electron process while allowing
 * every full Sim window to contribute navigation signals. This prevents
 * duplicate cookie listeners, storage clears, and expiry dialogs when
 * multiple application windows are open.
 */
export function createSessionLifecycleCoordinator(
  deps: SessionLifecycleCoordinatorDeps
): SessionLifecycleCoordinator {
  let tearingDown = false
  const runTeardown = () => {
    if (tearingDown) return
    tearingDown = true
    logger.info('Sign-out detected; clearing partition')
    void tearDownSession(deps.appSession, deps.clearHandoffState, deps.events)
      .catch((error) => logger.error('Session teardown failed', { error }))
      .finally(() => {
        for (const win of deps.getWindows()) {
          if (!win.isDestroyed()) {
            void win.loadURL(`${deps.origin()}/login`).catch(() => {})
          }
        }
        // Re-arm after clearStorageData's own cookie-removal events have
        // drained, so self-induced deletions never re-trigger teardown.
        setTimeout(() => {
          tearingDown = false
        }, TEARDOWN_COOLDOWN_MS)
      })
  }

  // Robust backstop: when the better-auth session cookie is deleted by ANY
  // path (not just the fromLogout redirect), confirm the session is really
  // gone with a probe — so cookie rotation can't cause a false teardown — then
  // clear the partition. This closes the cross-account residue gap.
  deps.appSession.cookies.on('changed', (_event, cookie, cause, removed) => {
    if (tearingDown || !removed || cause === 'overwrite') {
      return
    }
    if (!isSessionCookieName(cookie.name)) {
      return
    }
    void probeSession(deps.appSession, deps.origin()).then((state) => {
      if (state === 'invalid') {
        runTeardown()
      }
    })
  })

  let lastExpiryPromptAt = 0
  deps.appSession.webRequest.onCompleted({ urls: [`${deps.origin()}/api/*`] }, (details) => {
    if (details.statusCode !== 401 || details.url.includes('/api/auth/')) {
      return
    }
    const nowTs = Date.now()
    if (nowTs - lastExpiryPromptAt < EXPIRY_PROMPT_COOLDOWN_MS) {
      return
    }
    lastExpiryPromptAt = nowTs
    void probeSession(deps.appSession, deps.origin()).then((state) => {
      const win = deps.getWindow()
      if (state !== 'invalid' || !win || win.isDestroyed()) return
      deps.events.record('session_expired')
      void dialog
        .showMessageBox(win, {
          type: 'info',
          buttons: ['Sign In', 'Not Now'],
          defaultId: 0,
          cancelId: 1,
          message: 'Your session has expired',
          detail: 'Sign in again to keep working.',
        })
        .then(({ response }) => {
          if (response === 0) {
            deps.onReauthRequested()
          }
        })
    })
  })

  return {
    attachWindow(win) {
      const onNavigation = (url: string) => {
        if (isLogoutNavigation(url, deps.origin())) {
          runTeardown()
        }
      }
      // The web app signs out with a Next.js soft navigation to
      // /login?fromLogout=true, which fires did-navigate-in-page — not
      // did-navigate — so both events must be observed or teardown never runs.
      win.webContents.on('did-navigate', (_event, url) => onNavigation(url))
      win.webContents.on('did-navigate-in-page', (_event, url) => onNavigation(url))
    },
  }
}

/**
 * Single-window compatibility wrapper. Multi-window callers create one
 * coordinator and attach every application window to it.
 */
export function attachSessionLifecycle(win: BrowserWindow, deps: SessionLifecycleDeps): void {
  createSessionLifecycleCoordinator({
    ...deps,
    getWindow: () => (win.isDestroyed() ? null : win),
    getWindows: () => (win.isDestroyed() ? [] : [win]),
  }).attachWindow(win)
}

/**
 * Explains that Google/Microsoft connections must finish in the browser and
 * reopens the current page there — the browser holds its own signed-in
 * session after the login handoff, so the connect completes and tokens land
 * server-side. Back in the app, a refresh picks the connection up.
 */
export async function handleConnectIntercept(
  contents: WebContents,
  allowHttpLocalhost: boolean
): Promise<void> {
  const pageUrl = contents.getURL()
  const win = BrowserWindow.fromWebContents(contents)
  const options = {
    type: 'info' as const,
    buttons: ['Open in Browser', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: 'Finish connecting in your browser',
    detail:
      'This provider requires completing the connection in your web browser. Sim will open this page there — connect the account, then come back to the app and refresh.',
  }
  const { response } = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options)
  if (response === 0) {
    await openExternalSafe(pageUrl, allowHttpLocalhost)
  }
}
