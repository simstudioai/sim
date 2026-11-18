const DYNAMIC_SSO_CALLBACK_PATHS = new Set([
  '/sso/callback/:providerId',
  '/sso/saml2/callback/:providerId',
  '/sso/saml2/sp/acs/:providerId',
])

/**
 * Provider IDs travel unescaped in callback URLs (`/sso/callback/{providerId}`),
 * so they are limited to characters that survive a URL path unchanged. A
 * percent-escape would let the plugin and the admission hook disagree on which
 * provider a sign-in came from, and `.`/`..` are dot-segments a URL collapses.
 */
export const SSO_PROVIDER_ID_PATTERN = /^(?!\.{1,2}$)[a-zA-Z0-9_.:-]{1,128}$/

const CONCRETE_SSO_CALLBACK_PATH = /^\/sso\/(?:callback|saml2\/callback|saml2\/sp\/acs)\/([^/]+)$/

/**
 * Whether the endpoint is one the SSO plugin mints sessions from. Better Auth
 * dispatches with the declared path (`/sso/callback/:providerId`), while other
 * callers see the concrete one, so both forms are recognized.
 */
export function isSsoCallbackPath(path: string): boolean {
  return (
    DYNAMIC_SSO_CALLBACK_PATHS.has(path) ||
    path === '/sso/callback' ||
    CONCRETE_SSO_CALLBACK_PATH.test(path)
  )
}

export interface SsoCallbackProviderContext {
  path: string
  routeProviderId?: string
  stateProviderId?: unknown
}

function providerIdFrom(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

/**
 * Resolves the provider identity from Better Auth's callback route context.
 * Returns the value exactly as the SSO plugin used it for its own provider
 * lookup and account linking (route params are not percent-decoded), so the
 * admission check always names the provider that actually minted the session.
 */
export function resolveSsoCallbackProviderId({
  path,
  routeProviderId,
  stateProviderId,
}: SsoCallbackProviderContext): string | undefined {
  if (DYNAMIC_SSO_CALLBACK_PATHS.has(path)) {
    return providerIdFrom(routeProviderId)
  }
  if (path === '/sso/callback') {
    return providerIdFrom(stateProviderId)
  }

  return providerIdFrom(CONCRETE_SSO_CALLBACK_PATH.exec(path)?.[1])
}
