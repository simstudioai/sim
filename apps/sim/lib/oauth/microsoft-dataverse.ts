export const MICROSOFT_DATAVERSE_PROVIDER_ID = 'microsoft-dataverse'

const DATAVERSE_ORGANIZATION_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
const DATAVERSE_PUBLIC_HOST_PATTERN = new RegExp(
  `^(${DATAVERSE_ORGANIZATION_LABEL})(?:\\.api)?\\.(crm\\d*)\\.dynamics\\.com$`
)
const RESERVED_DATAVERSE_ORGANIZATION_LABELS = new Set(['disco', 'globaldisco'])
const DATAVERSE_REQUEST_SCOPE_SUFFIX = '/.default'
const DATAVERSE_RESOURCE_SCOPE_SUFFIX = '/user_impersonation'
const DATAVERSE_INSTANCE_MARKER_PREFIX = '__sim_dataverse_instance__:'
const DATAVERSE_OAUTH_CALLBACK_ENVIRONMENT_PARAM = '__sim_dataverse_environment'
const RELATIVE_CALLBACK_BASE = 'https://sim.invalid'
const UUID_SUFFIX_RE = /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Validates and canonicalizes a public-cloud Dataverse environment root. The current Microsoft
 * provider uses the global Entra authority; national clouds require separate authorities and app
 * registrations, so their hosts must not share this credential.
 */
export function normalizeMicrosoftDataverseEnvironmentUrl(environmentUrl: unknown): string {
  if (typeof environmentUrl !== 'string' || environmentUrl.trim().length === 0) {
    throw new Error('Dataverse environment URL must be a non-empty HTTPS URL')
  }

  let url: URL
  try {
    url = new URL(environmentUrl.trim())
  } catch {
    throw new Error('Dataverse environment URL must be a valid HTTPS URL')
  }

  const hostMatch = url.hostname.match(DATAVERSE_PUBLIC_HOST_PATTERN)
  const organizationLabel = hostMatch?.[1]
  const regionLabel = hostMatch?.[2]
  const hasTrustedHost =
    organizationLabel !== undefined &&
    regionLabel !== undefined &&
    !RESERVED_DATAVERSE_ORGANIZATION_LABELS.has(organizationLabel)

  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search !== '' ||
    url.hash !== '' ||
    !hasTrustedHost
  ) {
    throw new Error(
      'Dataverse environment URL must be an HTTPS root URL on a supported public-cloud Microsoft Dynamics host'
    )
  }

  return `https://${organizationLabel}.api.${regionLabel}.dynamics.com`
}

/** Builds the exact delegated OAuth grant Microsoft documents for one Dataverse environment. */
export function getMicrosoftDataverseOAuthScopes(environmentUrl: unknown): string[] {
  const origin = normalizeMicrosoftDataverseEnvironmentUrl(environmentUrl)
  return [
    'openid',
    'profile',
    'email',
    `${origin}${DATAVERSE_REQUEST_SCOPE_SUFFIX}`,
    'offline_access',
  ]
}

/** Returns the trusted internal marker used to match a Dynamics credential in block UIs. */
export function getMicrosoftDataverseRequiredScope(environmentUrl: unknown): string {
  const origin = normalizeMicrosoftDataverseEnvironmentUrl(environmentUrl)
  return `${DATAVERSE_INSTANCE_MARKER_PREFIX}${origin}`
}

function parseOAuthCallbackUrl(callbackURL: unknown): { url: URL; relative: boolean } {
  if (typeof callbackURL !== 'string' || callbackURL.trim().length === 0) {
    throw new Error('Microsoft Dataverse OAuth callback URL is missing')
  }

  const value = callbackURL.trim()
  const relative = value.startsWith('/') && !value.startsWith('//')
  try {
    return {
      url: relative ? new URL(value, RELATIVE_CALLBACK_BASE) : new URL(value),
      relative,
    }
  } catch {
    throw new Error('Microsoft Dataverse OAuth callback URL is invalid')
  }
}

export function getBoundMicrosoftDataverseEnvironment(callbackURL: unknown): string | undefined {
  if (callbackURL === undefined || callbackURL === null) return undefined
  const { url } = parseOAuthCallbackUrl(callbackURL)
  const bindings = url.searchParams.getAll(DATAVERSE_OAUTH_CALLBACK_ENVIRONMENT_PARAM)
  if (bindings.length === 0) return undefined
  if (bindings.length !== 1) {
    throw new Error('Microsoft Dataverse OAuth state contains duplicate environment bindings')
  }
  return normalizeMicrosoftDataverseEnvironmentUrl(bindings[0])
}

/**
 * Binds the requested Dataverse audience to Better Auth's protected OAuth state. Better Auth
 * restores the callback URL request-locally before getUserInfo runs, so this remains flow-specific
 * without a second provider, cookie, route, or database field.
 */
export function bindMicrosoftDataverseEnvironmentToOAuthCallback(
  callbackURL: unknown,
  environmentUrl: unknown
): string {
  const { url, relative } = parseOAuthCallbackUrl(callbackURL)
  const environment = normalizeMicrosoftDataverseEnvironmentUrl(environmentUrl)
  url.searchParams.set(DATAVERSE_OAUTH_CALLBACK_ENVIRONMENT_PARAM, environment)
  return relative ? `${url.pathname}${url.search}${url.hash}` : url.toString()
}

/** Removes the non-secret state-binding marker after Better Auth returns to the product UI. */
export function stripMicrosoftDataverseEnvironmentFromOAuthCallback(callbackURL: unknown): string {
  const { url, relative } = parseOAuthCallbackUrl(callbackURL)
  url.searchParams.delete(DATAVERSE_OAUTH_CALLBACK_ENVIRONMENT_PARAM)
  return relative ? `${url.pathname}${url.search}${url.hash}` : url.toString()
}

export function assertMicrosoftDataverseOAuthLinkRequest(
  callbackURL: unknown,
  requestedScopes: unknown,
  legacyScopes: readonly string[]
): void {
  const environment = getBoundMicrosoftDataverseEnvironment(callbackURL)
  if (!environment) {
    if (requestedScopes === undefined || requestedScopes === null) return
    if (
      !Array.isArray(requestedScopes) ||
      !requestedScopes.every((scope) => typeof scope === 'string')
    ) {
      throw new Error('Microsoft Dataverse OAuth link requires its exact legacy scopes')
    }
    const actualScopes = new Set(requestedScopes)
    if (
      requestedScopes.length !== legacyScopes.length ||
      actualScopes.size !== legacyScopes.length ||
      legacyScopes.some((scope) => !actualScopes.has(scope))
    ) {
      throw new Error('Unbound Microsoft Dataverse OAuth links may use only the legacy scopes')
    }
    return
  }
  if (
    !Array.isArray(requestedScopes) ||
    !requestedScopes.every((scope) => typeof scope === 'string')
  ) {
    throw new Error('Microsoft Dataverse OAuth link requires its canonical environment scopes')
  }

  const expectedScopes = getMicrosoftDataverseOAuthScopes(environment)
  const actualScopes = new Set(requestedScopes)
  if (
    requestedScopes.length !== expectedScopes.length ||
    actualScopes.size !== expectedScopes.length ||
    expectedScopes.some((scope) => !actualScopes.has(scope))
  ) {
    throw new Error('Microsoft Dataverse OAuth link scopes do not match its environment binding')
  }
}

/**
 * Resolves the scopes Better Auth should persist after a Dataverse callback. Resource-qualified
 * scopes must match the environment protected by OAuth state. Microsoft may omit scopes or return
 * only bare permissions; those cases retain the provider scopes and append the trusted environment
 * marker from the protected flow binding until the live Better Auth response shape is verified.
 */
export function resolveMicrosoftDataverseOAuthCallbackScopes(
  callbackURL: unknown,
  returnedScopes: readonly string[] | null | undefined
): string[] {
  const expectedEnvironment = getBoundMicrosoftDataverseEnvironment(callbackURL)
  if (!expectedEnvironment) {
    throw new Error('Microsoft Dataverse OAuth state is missing its environment binding')
  }

  if (!returnedScopes?.length) {
    return [
      ...getMicrosoftDataverseOAuthScopes(expectedEnvironment),
      getMicrosoftDataverseRequiredScope(expectedEnvironment),
    ]
  }

  const providerScopes = returnedScopes.filter(
    (scope) => typeof scope === 'string' && !scope.startsWith(DATAVERSE_INSTANCE_MARKER_PREFIX)
  )
  const resourceScopes = providerScopes.filter(
    (scope) => typeof scope === 'string' && /^https:\/\//i.test(scope)
  )
  if (resourceScopes.length > 1) {
    throw new Error('Microsoft Dataverse OAuth returned an invalid resource scope set')
  }
  for (const scope of resourceScopes) {
    const suffix = scope.endsWith(DATAVERSE_RESOURCE_SCOPE_SUFFIX)
      ? DATAVERSE_RESOURCE_SCOPE_SUFFIX
      : scope.endsWith(DATAVERSE_REQUEST_SCOPE_SUFFIX)
        ? DATAVERSE_REQUEST_SCOPE_SUFFIX
        : undefined
    if (!suffix) {
      throw new Error('Microsoft Dataverse OAuth returned an invalid resource scope')
    }
    const returnedEnvironment = normalizeMicrosoftDataverseEnvironmentUrl(
      scope.slice(0, -suffix.length)
    )
    if (returnedEnvironment !== expectedEnvironment) {
      throw new Error('Microsoft Dataverse OAuth returned a different environment scope')
    }
  }

  return [...providerScopes, getMicrosoftDataverseRequiredScope(expectedEnvironment)]
}

/**
 * Preserves legacy Dataverse callbacks while refusing a returned token audience for another
 * resource. Some OAuth clients normalize a resource permission to a bare scope, so non-URL scope
 * sets remain unchanged until their live Better Auth shape is verified.
 */
export function assertMicrosoftDataverseLegacyOAuthCallbackScopes(
  returnedScopes: readonly string[] | null | undefined,
  legacyScopes: readonly string[]
): void {
  if (!returnedScopes?.length) return

  const returnedResourceScopes = returnedScopes.filter((scope) => /^https:\/\//i.test(scope))
  if (returnedResourceScopes.length === 0) return

  const legacyResourceScopes = new Set(legacyScopes.filter((scope) => /^https:\/\//i.test(scope)))
  if (
    returnedResourceScopes.length !== new Set(returnedResourceScopes).size ||
    returnedResourceScopes.some((scope) => !legacyResourceScopes.has(scope))
  ) {
    throw new Error('Unbound Microsoft Dataverse OAuth returned an invalid resource scope')
  }
}

/**
 * Extracts the single trusted environment origin from Sim's internal account-scope marker.
 * Legacy Dataverse grants do not contain this marker and intentionally remain unbound.
 */
export function extractMicrosoftDataverseEnvironmentUrl(
  scopes: string | readonly string[] | null | undefined
): string | undefined {
  const values = Array.isArray(scopes)
    ? scopes
    : typeof scopes === 'string'
      ? scopes.split(/[\s,]+/)
      : []
  const origins = new Set<string>()

  for (const value of values) {
    if (!value.startsWith(DATAVERSE_INSTANCE_MARKER_PREFIX)) continue
    const candidate = value.slice(DATAVERSE_INSTANCE_MARKER_PREFIX.length)
    try {
      origins.add(normalizeMicrosoftDataverseEnvironmentUrl(candidate))
    } catch {}
  }

  if (origins.size > 1) {
    throw new Error('Microsoft Dataverse credential contains multiple environment scopes')
  }
  return origins.values().next().value
}

export type MicrosoftDataverseCredentialEnvironmentState =
  | 'unbound'
  | 'matching'
  | 'different'
  | 'invalid'

/**
 * Classifies whether a stored Dataverse grant can be used for a requested environment. A bound
 * grant for a different environment must never be reconnected in place because that credential
 * may be shared by workflows that still target its original environment.
 */
export function classifyMicrosoftDataverseCredentialEnvironment(
  scopes: string | readonly string[] | null | undefined,
  requestedEnvironmentUrl: unknown
): MicrosoftDataverseCredentialEnvironmentState {
  const requestedEnvironment = normalizeMicrosoftDataverseEnvironmentUrl(requestedEnvironmentUrl)
  let credentialEnvironment: string | undefined
  try {
    credentialEnvironment = extractMicrosoftDataverseEnvironmentUrl(scopes)
  } catch {
    return 'invalid'
  }
  if (!credentialEnvironment) return 'unbound'
  return credentialEnvironment === requestedEnvironment ? 'matching' : 'different'
}

/**
 * Dataverse credentials are scoped to one environment. Including its hostname in the stable
 * external account prefix lets the existing reconnect hook replace the same user/environment
 * grant without collapsing that user's credentials for other environments.
 */
export function bindMicrosoftDataverseEnvironmentToUserInfo<T extends { id: string }>(
  userInfo: T,
  scopes: readonly string[] | null | undefined
): T {
  const environmentUrl = extractMicrosoftDataverseEnvironmentUrl(scopes)
  if (!environmentUrl) {
    throw new Error('Microsoft Dynamics 365 OAuth requires a trusted environment marker')
  }

  const environmentHost = new URL(environmentUrl).hostname
  return {
    ...userInfo,
    id: userInfo.id.replace(UUID_SUFFIX_RE, `:${environmentHost}$&`),
  }
}
