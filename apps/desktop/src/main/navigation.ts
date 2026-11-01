import { createLogger } from '@sim/logger'
import { isLoopbackHostname } from '@sim/security/ssrf'
import { isValidEmailSyntax } from '@sim/utils/string'
import { shell } from 'electron'
import { scrubUrl } from '@/main/observability'

const logger = createLogger('DesktopNavigation')

export type MainNavigationAction =
  | 'in-app'
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
 * Integration connects use the explicit desktop handoff IPC. A cross-origin
 * departure from any other app page is therefore an ordinary external
 * navigation, not evidence of OAuth, and must never replace the privileged
 * app document that owns the preload bridge.
 */
export function classifyNavigation(rawUrl: string, ctx: NavigationContext): MainNavigationAction {
  if (rawUrl === 'about:blank') {
    return 'in-app'
  }
  if (isMailtoUrl(rawUrl)) {
    return 'external'
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
  return 'external'
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
  if (isBlankPopupUrl(rawUrl)) {
    return 'popup-blank'
  }
  if (isMailtoUrl(rawUrl)) {
    return 'external'
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
  if (isBlankPopupUrl(rawUrl)) {
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

/** The URL `window.open('')` and `window.open('about:blank')` hand a popup handler. */
export function isBlankPopupUrl(url: string): boolean {
  return url === '' || url === 'about:blank'
}

function isMailtoUrl(raw: string): boolean {
  return /^mailto:/i.test(raw)
}

/** RFC 6068 fields a mail client fills in; anything else (`attach=`, arbitrary headers) is refused. */
const MAILTO_FIELDS = new Set(['to', 'cc', 'bcc', 'subject', 'body'])

function isMailtoAddressList(encoded: string): boolean {
  if (encoded === '') return true
  try {
    return decodeURIComponent(encoded)
      .split(',')
      .every((address) => isValidEmailSyntax(address.trim()))
  } catch {
    return false
  }
}

/**
 * A `mailto:` of printable ASCII, plain addresses, and compose fields only: some mail clients
 * honour `attach=` and other headers, which would let a page attach a local file.
 */
function isSafeMailtoUrl(raw: string): boolean {
  if (!isMailtoUrl(raw) || raw.length > 4_096 || !/^[\x21-\x7e]+$/.test(raw)) {
    return false
  }
  const [addresses = '', query, ...rest] = raw.slice(7).split('?')
  if (rest.length > 0 || addresses.includes('#') || !isMailtoAddressList(addresses)) {
    return false
  }
  if (query === undefined) return true
  for (const field of query.split('&')) {
    const separator = field.indexOf('=')
    const name = (separator === -1 ? field : field.slice(0, separator)).toLowerCase()
    if (!MAILTO_FIELDS.has(name)) return false
    const value = separator === -1 ? '' : field.slice(separator + 1)
    if ((name === 'to' || name === 'cc' || name === 'bcc') && !isMailtoAddressList(value)) {
      return false
    }
  }
  return true
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
 * Schemes that reach local files, network shares, script, browser internals,
 * or Windows/macOS handlers with a record of remote-code abuse. A browser page
 * never opens them, even with a registered handler and the user's click.
 */
const DENIED_APP_LINK_SCHEMES: ReadonlySet<string> = new Set([
  'about',
  'afp',
  'applescript',
  'blob',
  'chrome',
  'chrome-extension',
  'chrome-untrusted',
  'data',
  'dav',
  'devtools',
  'disk',
  'disks',
  'file',
  'filesystem',
  'ftp',
  'hcp',
  'help',
  'ie.http',
  'its',
  'jar',
  'javascript',
  'jnlp',
  'localfs',
  'mk',
  'ms-appinstaller',
  'ms-excel',
  'ms-help',
  'ms-its',
  'ms-msdt',
  'ms-officecmd',
  'ms-powerpoint',
  'ms-settings',
  'ms-word',
  'nfs',
  'nntp',
  'res',
  'search',
  'search-ms',
  'shell',
  'sim-shell',
  'smb',
  'vbscript',
  'view-source',
  'vnd.ms.radio',
  'webdav',
  'x-man-page',
])
const DENIED_APP_LINK_SCHEME_PREFIXES = ['ms-cxh', 'local+'] as const
const MAX_APP_LINK_LENGTH = 2_048
/** C0 controls, space, DEL, and C1 controls: never valid in a URL handed to the OS. */
const URL_CONTROL_CHARACTERS = /[\u0000-\u0020\u007f-\u009f]/

function isDeniedAppLinkScheme(scheme: string): boolean {
  return (
    scheme.length < 2 ||
    scheme === 'http' ||
    scheme === 'https' ||
    DENIED_APP_LINK_SCHEMES.has(scheme) ||
    DENIED_APP_LINK_SCHEME_PREFIXES.some((prefix) => scheme.startsWith(prefix))
  )
}

/**
 * The link to another app a browser page may hand the OS, rebuilt by the URL
 * parser, or null when the scheme is denied or the URL is malformed, oversized,
 * carries credentials or control characters, or is an unsafe mail link.
 */
export function appLinkTarget(raw: unknown): { url: string; scheme: string } | null {
  if (typeof raw !== 'string' || raw.length > MAX_APP_LINK_LENGTH) return null
  if (URL_CONTROL_CHARACTERS.test(raw)) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const scheme = url.protocol.slice(0, -1).toLowerCase()
  if (!/^[a-z][a-z0-9+.-]*$/.test(scheme) || isDeniedAppLinkScheme(scheme)) return null
  if (url.username || url.password) return null
  if (scheme === 'mailto' && !isSafeMailtoUrl(raw)) return null
  const rebuilt = url.href
  if (rebuilt.length > MAX_APP_LINK_LENGTH || URL_CONTROL_CHARACTERS.test(rebuilt)) return null
  return { url: rebuilt, scheme }
}

/**
 * Opens a URL in the system browser, a `mailto:` in the system mail client, or, with
 * `appLink`, a validated link to another app, after validation. Every openExternal in the
 * app goes through here — menu items, IPC, navigation policy, and browser-tab app links.
 */
export async function openExternalSafe(
  raw: string,
  allowHttpLocalhost = false,
  { appLink = false }: { appLink?: boolean } = {}
): Promise<boolean> {
  if (
    !isSafeExternalUrl(raw, allowHttpLocalhost) &&
    !isSafeMailtoUrl(raw) &&
    !(appLink && appLinkTarget(raw)?.url === raw)
  ) {
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
