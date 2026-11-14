import { resolveOAuthClientCapabilityId } from '@sim/deployment-config/env-capabilities'
import { isHosted } from '@/lib/core/config/env-flags'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { getCanonicalScopesForProvider } from '@/lib/oauth/utils'

const REVIEW_PROVIDERS = new Set(['google-ads', 'google-chat', 'google-meet'])

const UNVERIFIED_SCOPES = new Set([
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/meetings.space.created',
  'https://www.googleapis.com/auth/meetings.space.readonly',
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/chat.messages.readonly',
])

/** Restricts new hosted grants without changing existing credentials or their refresh policy. */
export async function getGoogleOAuthVerificationRefusal(
  providerId: unknown,
  scopes: unknown = []
): Promise<string | undefined> {
  if (
    !isHosted ||
    typeof providerId !== 'string' ||
    resolveOAuthClientCapabilityId(providerId) !== 'google'
  )
    return undefined

  const requestedScopes = Array.isArray(scopes)
    ? scopes.flatMap((scope) =>
        typeof scope === 'string' ? scope.split(/\s+/).filter(Boolean) : []
      )
    : []
  if (REVIEW_PROVIDERS.has(providerId)) {
    const allowedScopes = new Set(['openid', ...getCanonicalScopesForProvider(providerId)])
    if (requestedScopes.some((scope) => !allowedScopes.has(scope))) {
      return 'This Google connection cannot request permissions for another service.'
    }
    if (await isFeatureEnabled('google-unverified-oauth')) return undefined
  } else if (!requestedScopes.some((scope) => UNVERIFIED_SCOPES.has(scope))) {
    return undefined
  }
  return 'This Google connection is awaiting verification and is not available in this environment.'
}
