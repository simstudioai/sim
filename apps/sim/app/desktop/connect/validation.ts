/**
 * OAuth providerIds are kebab-case service slugs (e.g. "google-email"). The
 * value is only used to start a better-auth oauth2.link flow, which validates
 * it against the configured providers — this pattern just keeps junk out of
 * URLs and logs.
 */
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/

/** OAuth error codes forwarded to the desktop app's loopback (short slugs). */
const ERROR_SLUG_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export function isValidOAuthProviderId(value: unknown): value is string {
  return typeof value === 'string' && PROVIDER_ID_PATTERN.test(value)
}

/**
 * Sanitizes a provider/better-auth error code for the loopback URL. Anything
 * that isn't a short slug collapses to a generic code rather than being
 * forwarded verbatim.
 */
export function sanitizeOAuthErrorSlug(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') {
    return null
  }
  return ERROR_SLUG_PATTERN.test(value) ? value : 'oauth_error'
}

/** Workspace/credential ids are opaque tokens; anything else never reaches a URL. */
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function isValidOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && OPAQUE_ID_PATTERN.test(value)
}

/** Optional connect scope forwarded from the desktop app's credential chips. */
export interface ConnectScope {
  workspaceId?: string
  credentialId?: string
}

/**
 * Rebuilds the connect launcher's own path from validated parameters, for use
 * as the post-login callbackUrl.
 */
export function buildDesktopConnectPath(
  providerId: string,
  state: string,
  port: number,
  scope: ConnectScope = {}
): string {
  const params = new URLSearchParams({ provider: providerId, state, port: String(port) })
  if (scope.workspaceId) params.set('workspaceId', scope.workspaceId)
  if (scope.credentialId) params.set('credentialId', scope.credentialId)
  return `/desktop/connect?${params.toString()}`
}

/**
 * The same-origin path better-auth redirects the browser to after the OAuth
 * callback — the complete page then bounces to the desktop app's loopback.
 */
export function buildConnectCompletePath(state: string, port: number): string {
  const params = new URLSearchParams({ state, port: String(port) })
  return `/desktop/connect/complete?${params.toString()}`
}

/**
 * Builds the desktop app's loopback URL for a finished connect flow (RFC 8252
 * §7.3 — the `127.0.0.1` IP literal, mirroring the login handoff). A present
 * `error` marks the flow failed; the app surfaces it as a toast.
 */
export function buildConnectLoopbackUrl(state: string, port: number, error?: string): string {
  const params = new URLSearchParams({ state })
  if (error) {
    params.set('error', error)
  }
  return `http://127.0.0.1:${port}/connect/callback?${params.toString()}`
}
