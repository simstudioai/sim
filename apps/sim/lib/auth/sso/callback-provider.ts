const DYNAMIC_SSO_CALLBACK_PATHS = new Set([
  '/sso/callback/:providerId',
  '/sso/saml2/callback/:providerId',
  '/sso/saml2/sp/acs/:providerId',
])

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

function decodeProviderId(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  try {
    const providerId = decodeURIComponent(value)
    return providerId && !providerId.includes('/') && !providerId.includes('\\') ? providerId : null
  } catch {
    return null
  }
}

/** Resolves the provider identity from Better Auth's callback route context. */
export function resolveSsoCallbackProviderId({
  path,
  routeProviderId,
  stateProviderId,
}: SsoCallbackProviderContext): string | null {
  if (DYNAMIC_SSO_CALLBACK_PATHS.has(path)) {
    return decodeProviderId(routeProviderId)
  }
  if (path === '/sso/callback') {
    return decodeProviderId(stateProviderId)
  }

  const concreteMatch = CONCRETE_SSO_CALLBACK_PATH.exec(path)
  return decodeProviderId(concreteMatch?.[1])
}
