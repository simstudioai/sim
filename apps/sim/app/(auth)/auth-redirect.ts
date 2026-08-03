/**
 * Where the user goes once authentication finishes, carried across the login →
 * signup → verify hops. Written only after `validateCallbackUrl` accepts it, and
 * re-validated on read.
 */
export const POST_AUTH_REDIRECT_STORAGE_KEY = 'postAuthRedirectUrl'

/** Route the verify hop lives at, entered only from signup. */
export const VERIFY_FROM_SIGNUP_ROUTE = '/verify?fromSignup=true'

/** Default post-auth destination when no callback URL was carried in. */
export const DEFAULT_POST_AUTH_ROUTE = '/workspace'

/**
 * Where a successful email signup goes next.
 * - `verify`: the verification hop, which owns the post-auth redirect from there
 * - `redirect`: the validated callback URL the visitor arrived with
 * - `workspace`: the default destination
 */
export type PostSignupDestination =
  | { kind: 'verify' }
  | { kind: 'redirect'; url: string }
  | { kind: 'workspace' }

interface PostSignupDestinationParams {
  /** The server-derived effective flag — verification enabled AND deliverable. */
  emailVerificationEnabled: boolean
  /** Callback URL that already passed `validateCallbackUrl`, or `''`. */
  redirectUrl: string
}

/**
 * `/verify` is a destination only when the deployment can actually deliver the
 * code. A deployment with no mail provider would otherwise strand every new
 * account on a screen no email can ever satisfy, so signup continues straight
 * to the normal post-auth destination instead.
 */
export function resolvePostSignupDestination({
  emailVerificationEnabled,
  redirectUrl,
}: PostSignupDestinationParams): PostSignupDestination {
  if (emailVerificationEnabled) return { kind: 'verify' }
  return redirectUrl ? { kind: 'redirect', url: redirectUrl } : { kind: 'workspace' }
}

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
