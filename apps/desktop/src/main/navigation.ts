import { createLogger } from '@sim/logger'
import { isLoopbackHostname } from '@sim/security/ssrf'
import { shell } from 'electron'
import { scrubUrl } from '@/main/observability'

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
 * IdP hosts that hard-block OAuth inside embedded user agents. An integration
 * connect heading for one of these is cancelled and offered as a finish-in-the-
 * browser flow instead (tokens land server-side either way). Sign-in never
 * consults this list — see {@link classifyNavigation}.
 */
export const SYSTEM_BROWSER_IDP_HOSTS: readonly string[] = [
  'accounts.google.com',
  'accounts.youtube.com',
  'login.microsoftonline.com',
  'login.live.com',
  'login.windows.net',
  'sts.windows.net',
]

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
 * regular external links always go through window.open.
 *
 * A departure from an auth surface is a *sign-in*, and sign-in always runs in
 * the system browser (RFC 8252), whatever the IdP. Embedding one is a one-way
 * door: the shell has no browser chrome, so a user who reaches the IdP and
 * decides not to continue has no way back to the app. It also splits the flow
 * across two cookie jars — better-auth binds its OAuth state cookie to the user
 * agent that started the flow, so an in-window start that finishes anywhere
 * else comes back `state_mismatch`. The handoff keeps the whole flow in one
 * jar and hands a one-time token back over the loopback.
 *
 * Everything else is an integration connect from a workspace page: those stay
 * in-window (the session cookie is already in this partition) unless the IdP
 * hard-blocks embedded user agents, which is what {@link
 * SYSTEM_BROWSER_IDP_HOSTS} enumerates.
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
  if (fromAuthSurface) {
    return 'idp-system-login'
  }
  if (matchesHostList(url.hostname, SYSTEM_BROWSER_IDP_HOSTS)) {
    return 'idp-system-connect'
  }
  return 'idp-in-window'
}

/**
 * Classifies a window.open request (setWindowOpenHandler). Internal requests
 * become full Sim application windows; the MCP OAuth popup and the
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
    logger.warn('Blocked unsafe external URL', { url: scrubUrl(raw) })
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
