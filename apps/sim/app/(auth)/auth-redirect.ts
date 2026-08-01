/**
 * Where the user goes once authentication finishes, carried across the login →
 * signup → verify hops. Written only after `validateCallbackUrl` accepts it, and
 * re-validated on read.
 */
export const POST_AUTH_REDIRECT_STORAGE_KEY = 'postAuthRedirectUrl'

interface AuthCrossLinkParams {
  /** Validated post-auth destination to carry over, or null to drop it. */
  callbackUrl: string | null
  isInviteFlow: boolean
}

/**
 * Builds the login ⇄ signup cross-link, preserving the post-auth destination so
 * a visitor who signs up instead of signing in still lands where they were
 * headed. `URLSearchParams` does the encoding — a destination that carries its
 * own query string (`/cli/auth?callback=…&state=…`) must survive intact.
 */
export function buildAuthCrossLink(
  path: '/login' | '/signup',
  { callbackUrl, isInviteFlow }: AuthCrossLinkParams
): string {
  const params = new URLSearchParams()
  if (isInviteFlow) params.set('invite_flow', 'true')
  if (callbackUrl) params.set('callbackUrl', callbackUrl)

  const query = params.toString()
  return query ? `${path}?${query}` : path
}
