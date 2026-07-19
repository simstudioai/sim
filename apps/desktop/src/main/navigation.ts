import { createLogger } from '@sim/logger'
import { isLoopbackHostname } from '@sim/security/ssrf'
import { shell } from 'electron'

const logger = createLogger('DesktopNavigation')

export type MainNavigationAction =
  | 'in-app'
  | 'idp-in-window'
  | 'idp-system-login'
  | 'idp-system-connect'
  | 'external'
  | 'deny'

export type WindowOpenAction = 'popup-mcp' | 'popup-blank' | 'popup-internal' | 'external' | 'deny'

export type BlankChildAction = 'internal' | 'external' | 'ignore' | 'deny'

export interface NavigationContext {
  appOrigin: string
  currentUrl?: string
  isPopup?: boolean
}

/**
 * IdP hosts that hard-block OAuth inside embedded user agents. Navigation to
 * these hosts is cancelled and rerouted: from an auth surface the app starts
 * the system-browser login handoff; from anywhere else it offers to finish the
 * integration connect in the browser (tokens land server-side either way).
 */
export const SYSTEM_BROWSER_IDP_HOSTS: readonly string[] = [
  'accounts.google.com',
  'accounts.youtube.com',
  'login.microsoftonline.com',
  'login.live.com',
  'login.windows.net',
  'sts.windows.net',
]

/**
 * IdP hosts verified lenient toward embedded user agents (the U5 provider
 * matrix). Only consulted for navigations leaving an auth surface — everywhere
 * else unknown hosts already stay in-window because same-window departures
 * from workspace pages are OAuth connect flows in this app.
 */
export const IN_WINDOW_IDP_HOSTS: readonly string[] = ['github.com']

const AUTH_SURFACE_PREFIXES: readonly string[] = [
  '/login',
  '/signup',
  '/sso',
  '/reset-password',
  '/verify',
  '/desktop/auth',
]

const MCP_POPUP_NAME_PREFIX = 'mcp-oauth-'

export function parseHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }
    return url
  } catch {
    return null
  }
}

/**
 * Matches a hostname against a list of registrable domains, including their
 * subdomains ('login.live.com' matches 'live.com'-style entries and itself).
 */
export function matchesHostList(hostname: string, hosts: readonly string[]): boolean {
  return hosts.some((entry) => hostname === entry || hostname.endsWith(`.${entry}`))
}

/**
 * True when a URL is on the app origin, compared by parsed origin equality.
 * Never use `url.startsWith(origin)` for this — that prefix-matches lookalike
 * hosts (`https://sim.ai.evil.com` starts with `https://sim.ai`).
 */
export function isAppOrigin(rawUrl: string, appOrigin: string): boolean {
  const url = parseHttpUrl(rawUrl)
  return url !== null && url.origin === appOrigin
}

/**
 * Auth surfaces are routes where a non-origin departure means an identity
 * flow (social login, SSO) rather than an integration connect.
 */
export function isAuthSurfacePath(pathname: string): boolean {
  return AUTH_SURFACE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

/**
 * Classifies a top-level navigation (will-navigate / will-redirect).
 *
 * Same-window departures to non-origin hosts are OAuth flows in this app —
 * regular external links always go through window.open — so unknown hosts stay
 * in-window (lenient IdP assumption) except for the known embedded-blocking
 * hosts, which are rerouted through the system browser. Departures from auth
 * surfaces default to the system browser because SSO IdPs need real-browser
 * device claims.
 */
export function classifyNavigation(rawUrl: string, ctx: NavigationContext): MainNavigationAction {
  if (rawUrl === 'about:blank') {
    return 'in-app'
  }
  const url = parseHttpUrl(rawUrl)
  if (!url) {
    return 'deny'
  }
  if (url.origin === ctx.appOrigin) {
    return 'in-app'
  }
  if (ctx.isPopup) {
    return 'in-app'
  }
  const current = ctx.currentUrl ? parseHttpUrl(ctx.currentUrl) : null
  const fromAuthSurface = current
    ? current.origin === ctx.appOrigin && isAuthSurfacePath(current.pathname)
    : false
  if (matchesHostList(url.hostname, SYSTEM_BROWSER_IDP_HOSTS)) {
    return fromAuthSurface ? 'idp-system-login' : 'idp-system-connect'
  }
  if (matchesHostList(url.hostname, IN_WINDOW_IDP_HOSTS)) {
    return 'idp-in-window'
  }
  if (current && current.origin !== ctx.appOrigin) {
    return 'idp-in-window'
  }
  return fromAuthSurface ? 'idp-system-login' : 'idp-in-window'
}

/**
 * Classifies a window.open request (setWindowOpenHandler). Internal popups
 * collapse into the single main window; the MCP OAuth popup and the
 * blank-then-assign pattern (Stripe portal, deployed-chat tabs) are allowed as
 * guarded children in the same partition.
 */
export function classifyWindowOpen(
  rawUrl: string,
  frameName: string,
  appOrigin: string
): WindowOpenAction {
  if (rawUrl === '' || rawUrl === 'about:blank') {
    return 'popup-blank'
  }
  const url = parseHttpUrl(rawUrl)
  if (!url) {
    return 'deny'
  }
  if (url.origin === appOrigin) {
    if (frameName.startsWith(MCP_POPUP_NAME_PREFIX)) {
      return 'popup-mcp'
    }
    return 'popup-internal'
  }
  // The MCP OAuth popup opens the provider's cross-origin authorization URL
  // (always https). The frame name is renderer-controlled, so gate the in-app
  // popup on https too — an http(s-less) page can never ride the mcp-oauth name
  // into an in-app window; it goes to the system browser like any external URL.
  if (frameName.startsWith(MCP_POPUP_NAME_PREFIX) && url.protocol === 'https:') {
    return 'popup-mcp'
  }
  return 'external'
}

/**
 * Classifies the first real navigation of an about:blank child window created
 * by the blank-then-assign pattern.
 */
export function classifyBlankChildNavigation(rawUrl: string, appOrigin: string): BlankChildAction {
  if (rawUrl === '' || rawUrl === 'about:blank') {
    return 'ignore'
  }
  const url = parseHttpUrl(rawUrl)
  if (!url) {
    return 'deny'
  }
  if (url.origin === appOrigin) {
    return 'internal'
  }
  return 'external'
}

/**
 * Validates a URL for handing to the system browser: https always, http only
 * for loopback hosts when explicitly allowed, never credentials in the URL,
 * never non-web schemes.
 */
export function isSafeExternalUrl(raw: string, allowHttpLocalhost = false): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.username || url.password) {
    return false
  }
  if (url.protocol === 'https:') {
    return true
  }
  if (url.protocol === 'http:') {
    return allowHttpLocalhost && isLoopbackHostname(url.hostname)
  }
  return false
}

/**
 * Opens a URL in the system browser after validation. Every openExternal in
 * the app goes through here — menu items, IPC, and navigation policy.
 */
export async function openExternalSafe(raw: string, allowHttpLocalhost = false): Promise<boolean> {
  if (!isSafeExternalUrl(raw, allowHttpLocalhost)) {
    logger.warn('Blocked unsafe external URL', { url: raw.slice(0, 200) })
    return false
  }
  try {
    await shell.openExternal(raw)
    return true
  } catch (error) {
    logger.error('Failed to open external URL', { error })
    return false
  }
}
