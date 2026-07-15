import {
  fetchProvider,
  parseProviderJson,
  throwForProviderResponse,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'

const CALCOM_ME_URL = 'https://api.cal.com/v2/me'

interface CalcomMeResponse {
  status?: string
  data?: {
    id?: number
    username?: string
    email?: string
  }
}

/**
 * Validates a Cal.com API key by calling `GET /v2/me`. Cal.com accepts an API
 * key in the same `Authorization: Bearer` slot the tools use for OAuth tokens,
 * and this endpoint needs no `cal-api-version` header (unlike the per-resource
 * tool endpoints). 401/403 mean the key was rejected; any other non-2xx — or a
 * 200 without the standard `{ status: 'success', data }` envelope — means
 * Cal.com is unavailable.
 */
export async function validateCalcomServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const res = await fetchProvider(
    CALCOM_ME_URL,
    {
      headers: {
        Authorization: `Bearer ${fields.apiToken}`,
        Accept: 'application/json',
      },
    },
    'me'
  )
  await throwForProviderResponse(res, 'me')

  const body = await parseProviderJson<CalcomMeResponse>(res, 'me')
  if (body.status !== 'success' || body.data?.id === undefined) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'me',
      reason: 'unexpected response envelope from /v2/me',
    })
  }

  const userId = String(body.data.id)
  const username = body.data.username
  const email = body.data.email
  const storedMetadata: Record<string, string> = { userId }
  if (email) storedMetadata.email = email

  return {
    displayName: username || email || 'Cal.com account',
    auditMetadata: { calcomUserId: userId },
    storedMetadata,
  }
}
