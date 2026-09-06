import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import type { Session, WebContents } from 'electron'
import { BrowserWindow, dialog } from 'electron'
import {
  beginAccountDataTeardown,
  completeAccountDataTeardown,
  waitForAccountDataMutations,
} from '@/main/account-data-generation'
import { APP_ENTRY_ROUTE } from '@/main/app-routes'
import { isSafeInternalPath } from '@/main/config'
import { isAuthSurfacePath, openExternalSafe } from '@/main/navigation'
import type { EventRecorder } from '@/main/observability'

const logger = createLogger('DesktopSessionLifecycle')

const SESSION_PROBE_TIMEOUT_MS = 5000
const START_ROUTE_PROBE_TIMEOUT_MS = 1500
const TEARDOWN_COOLDOWN_MS = 3000
const TEARDOWN_WAIT_TIMEOUT_MS = 5000

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
 * not itself an auth surface), falling back to the app entry. A signed-out
 * partition is handled by the web app's own login redirect.
 */
export function decideStartRoute(lastRoute: string | undefined): string {
  if (lastRoute && isSafeInternalPath(lastRoute) && !isAuthSurfacePath(lastRoute)) {
    return lastRoute
  }
  return APP_ENTRY_ROUTE
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
      logger.info('Saved workspace route is no longer accessible; opening the app entry')
      return APP_ENTRY_ROUTE
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
  const controller = new AbortController()
  // `finally`, not an inline clear after the await: a thrown fetch is the case
  // this function exists for, and an inline clear is skipped on that path.
  // The body read is inside the deadline too, so a stalled response cannot
  // outlive the timeout.
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await session.fetch(`${origin}/api/auth/get-session`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
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
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The user id the app partition is currently signed in as, or null when signed
 * out or unreachable.
 *
 * The OAuth connect handoff runs entirely in the system browser, which holds a
 * session of its own — since the app no longer shares the browser's session row,
 * the two can be different accounts. Passing this id into `/desktop/connect`
 * lets the server refuse rather than silently attach the credential to whichever
 * account the browser happens to be signed into.
 */
export async function readSessionUserId(
  session: Session,
  origin: string,
  timeoutMs: number = SESSION_PROBE_TIMEOUT_MS
): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await session.fetch(`${origin}/api/auth/get-session`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
    if (!response.ok) {
      return null
    }
    const data = (await response.json().catch(() => null)) as {
      user?: { id?: unknown }
    } | null
    return typeof data?.user?.id === 'string' ? data.user.id : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

const SIGN_OUT_SCRIPT = `(async () => {
  try {
    const response = await fetch('/api/auth/sign-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: '{}',
    })
    return response.status
  } catch {
    return 0
  }
})()`

/**
 * Whether this window can carry the sign-out request. The trailing slash makes
 * the prefix an origin test rather than a string test, so a lookalike host
 * (`https://sim.ai.evil.example`) is never asked to sign the user out.
 */
export function canRevokeIn(win: BrowserWindow, origin: string): boolean {
  return !win.isDestroyed() && win.webContents.getURL().startsWith(`${origin}/`)
}

/**
 * Revokes the app's session row server-side.
 *
 * The desktop holds a session of its own (see
 * `apps/sim/lib/auth/desktop-handoff.ts`), so clearing the partition alone
 * would leave a live 30-day credential on the server that nothing can revoke —
 * there is no device-management UI. "Sign Out" has to reach the server.
 *
 * Runs in the app-origin renderer rather than `session.fetch`: Better Auth
 * rejects a cookie-bearing POST that carries no `Origin` header
 * (`MISSING_OR_NULL_ORIGIN`), and only a renderer request is genuinely
 * same-origin — the same reason the token redeem runs there. Best-effort by
 * design: sign-out must still clear local state when offline or when the
 * window is showing the offline page, and `/sign-out` is a no-op when the
 * cookie is already gone (the cookie-deletion backstop path).
 */
export async function revokeAppSession(win: BrowserWindow, origin: string): Promise<void> {
  if (!canRevokeIn(win, origin)) {
    return
  }
  try {
    await win.webContents.executeJavaScript(SIGN_OUT_SCRIPT, true)
  } catch (error) {
    logger.warn('Could not revoke the session server-side', { error })
  }
}

/**
 * Revokes the session server-side, then clears every session-bearing storage in
 * the app partition plus any pending handoff secrets — the desktop analogue of
 * a browser profile sign-out.
 *
 * The embedded browser has its own partition, which this clears too: it holds
 * the signed-in user's cookies for third-party sites, so leaving it behind
 * would hand the next account on this machine a set of live sessions. Injected
 * rather than imported, so this module does not pull the whole browser-agent
 * subsystem — and its module-load side effects — into the auth path.
 */
export async function tearDownSession(
  session: Session,
  origin: string,
  clearHandoffState: () => void | Promise<void>,
  events: EventRecorder,
  clearBrowserProfile: () => Promise<void>,
  revokeSession: () => Promise<void>
): Promise<void> {
  if (!beginAccountDataTeardown('account', origin)) {
    throw new Error('Could not persist account-data recovery marker.')
  }
  events.record('sign_out')
  // Server-side first, while the partition still holds the session cookie the
  // revoke needs. Revocation remains best-effort because offline sign-out must
  // still erase the device, but every local erasure below is fail-closed.
  await revokeSession().catch((error) => logger.error('Session revoke failed', { error }))
  await waitForAccountDataMutations()

  const failures: unknown[] = []
  const clear = async (label: string, operation: () => void | Promise<void>) => {
    try {
      await operation()
    } catch (error) {
      failures.push(error)
      logger.error(label, { error })
    }
  }

  await clear('Local account-state teardown failed', clearHandoffState)
  await clear('Browser profile teardown failed', clearBrowserProfile)
  await clear('App partition storage teardown failed', () =>
    session.clearStorageData({ storages: [...CLEARED_STORAGES] })
  )
  await clear('App partition cache teardown failed', () => session.clearCache())

  if (failures.length > 0) {
    throw new AggregateError(failures, 'One or more account-data stores could not be cleared.')
  }
  completeAccountDataTeardown()
}

export interface SessionLifecycleDeps {
  appSession: Session
  origin: () => string
  events: EventRecorder
  clearHandoffState: () => void | Promise<void>
  /** Clears the embedded browser's own partition. See {@link tearDownSession}. */
  clearBrowserProfile: () => Promise<void>
}

export interface SessionLifecycleCoordinator {
  attachWindow(win: BrowserWindow): void
  /**
   * Signs out through the same path web sign-out takes. Callers must use this
   * rather than calling {@link tearDownSession} directly: a direct call skips
   * the in-progress guard, and its own cookie removal then trips the cookie
   * watcher into a second concurrent teardown.
   */
  signOut(): Promise<boolean>
  /** Waits for an active teardown without allowing shutdown to hang indefinitely. */
  awaitTeardown(timeoutMs?: number): Promise<boolean>
  isTeardownActive(): boolean
}

interface SessionLifecycleCoordinatorDeps extends SessionLifecycleDeps {
  getWindows: () => BrowserWindow[]
}

/**
 * Owns shared app-session observers once per Electron process while allowing
 * every full Sim window to contribute navigation signals. This prevents
 * duplicate cookie listeners and storage clears when multiple application
 * windows are open.
 *
 * Session *expiry* is deliberately not handled here. The web app owns it: its
 * session query settles to `null` and `SessionExpired` signs out and redirects,
 * by the same mechanism in the browser and the app. (The app's session row is
 * its own, so the two expire on independent clocks — `updateAge` refreshes only
 * the row that made the request.) A shell-side detector could only infer that
 * state from cookie events and 401 statuses, which is how it ended up prompting
 * on ordinary sign-outs and on launching signed out.
 */
export function createSessionLifecycleCoordinator(
  deps: SessionLifecycleCoordinatorDeps
): SessionLifecycleCoordinator {
  let teardownPromise: Promise<boolean> | null = null
  let teardownSettled = true
  let lastTeardownSucceeded: boolean | null = null
  const runTeardown = (): Promise<boolean> => {
    if (teardownPromise) return teardownPromise
    teardownSettled = false
    lastTeardownSucceeded = null
    logger.info('Sign-out detected; clearing partition')
    const pending = tearDownSession(
      deps.appSession,
      deps.origin(),
      deps.clearHandoffState,
      deps.events,
      deps.clearBrowserProfile,
      // One revoke, not one per window: every window shares the partition's
      // single session, so the first on-origin renderer can speak for all of
      // them and the rest would be no-ops against an already-deleted row.
      async () => {
        const origin = deps.origin()
        const win = deps.getWindows().find((candidate) => canRevokeIn(candidate, origin))
        if (win) {
          await revokeAppSession(win, origin)
        }
      }
    )
      .then(() => {
        for (const win of deps.getWindows()) {
          if (!win.isDestroyed()) {
            void win.loadURL(`${deps.origin()}/login`).catch(() => {})
          }
        }
        lastTeardownSucceeded = true
        return true
      })
      .catch((error) => {
        logger.error('Session teardown failed; refusing to report a clean sign-out', { error })
        void dialog.showMessageBox({
          type: 'error',
          message: 'Sim could not finish signing out',
          detail:
            'Some account data could not be removed from this device. Try signing out again before another account uses the app.',
          buttons: ['OK'],
        })
        lastTeardownSucceeded = false
        return false
      })
      .finally(() => {
        teardownSettled = true
        // Re-arm after clearStorageData's own cookie-removal events have
        // drained, so self-induced deletions never re-trigger teardown.
        setTimeout(() => {
          if (teardownPromise === pending) {
            teardownPromise = null
          }
        }, TEARDOWN_COOLDOWN_MS)
      })
    teardownPromise = pending
    return pending
  }

  // Robust backstop: when the better-auth session cookie is deleted by ANY
  // path (not just the fromLogout redirect), confirm the session is really
  // gone with a probe — so cookie rotation can't cause a false teardown — then
  // clear the partition. This closes the cross-account residue gap.
  deps.appSession.cookies.on('changed', (_event, cookie, cause, removed) => {
    if (teardownPromise !== null || !removed || cause === 'overwrite') {
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

  return {
    signOut: runTeardown,
    async awaitTeardown(timeoutMs = TEARDOWN_WAIT_TIMEOUT_MS) {
      const pending = teardownPromise
      if (!pending) return lastTeardownSucceeded !== false
      return Promise.race([pending, sleep(timeoutMs).then(() => false)])
    },
    isTeardownActive() {
      return teardownPromise !== null && !teardownSettled
    },
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
