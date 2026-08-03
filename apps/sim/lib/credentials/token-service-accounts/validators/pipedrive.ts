import {
  fetchProvider,
  parseProviderJson,
  TokenServiceAccountValidationError,
  throwForProviderResponse,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'

const USERS_ME_URL = 'https://api.pipedrive.com/v1/users/me'

interface PipedriveUsersMeResponse {
  success?: boolean
  data?: {
    id?: number
    name?: string
    company_id?: number
    company_name?: string
    company_domain?: string
  }
}

/**
 * Validates a Pipedrive personal API token via `GET /v1/users/me` with the
 * `x-api-token` header — the exact header shape the Sim Pipedrive tools use
 * for API-token credentials, so validation exercises the same auth path as
 * execution. Error mapping is status-based only (the 401 body envelope is
 * undocumented): 401/403 → `invalid_credentials`, everything else non-2xx
 * (including 429 rate limiting) → `provider_unavailable` via the shared
 * helpers.
 */
export async function validatePipedriveServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const res = await fetchProvider(
    USERS_ME_URL,
    {
      headers: {
        'x-api-token': fields.apiToken,
        Accept: 'application/json',
      },
    },
    'users_me'
  )
  await throwForProviderResponse(res, 'users_me')

  const payload = await parseProviderJson<PipedriveUsersMeResponse>(res, 'users_me')
  const user = payload.data
  if (payload.success !== true || typeof user?.id !== 'number') {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'users_me',
      reason: payload.success !== true ? 'success flag missing in response' : 'missing user id',
    })
  }

  const userName = typeof user.name === 'string' && user.name ? user.name : undefined
  const companyName =
    typeof user.company_name === 'string' && user.company_name ? user.company_name : undefined
  const companyId = typeof user.company_id === 'number' ? String(user.company_id) : undefined
  const companyDomain =
    typeof user.company_domain === 'string' && user.company_domain ? user.company_domain : undefined

  const storedMetadata: Record<string, string> = { userId: String(user.id) }
  if (companyId) storedMetadata.companyId = companyId
  if (companyDomain) storedMetadata.companyDomain = companyDomain

  const displayName = userName
    ? companyName
      ? `${userName} (${companyName})`
      : userName
    : companyId
      ? `Pipedrive company ${companyId}`
      : 'Pipedrive API token'

  return {
    displayName,
    auditMetadata: companyId ? { pipedriveCompanyId: companyId } : {},
    storedMetadata,
  }
}
