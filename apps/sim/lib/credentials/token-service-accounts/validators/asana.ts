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

const ASANA_ME_URL = 'https://app.asana.com/api/1.0/users/me?opt_fields=gid,name,email'

interface AsanaMeResponse {
  data?: {
    gid?: string
    name?: string
    email?: string
  }
}

/**
 * Validates an Asana service-account (or personal access) token by calling
 * `GET /users/me`. Asana tokens are documented as opaque, so no format checks
 * are performed — the live API call is the only gate. 401/403 mean the token
 * was rejected; any other non-2xx means Asana is unavailable.
 */
export async function validateAsanaServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const res = await fetchProvider(
    ASANA_ME_URL,
    {
      headers: {
        Authorization: `Bearer ${fields.apiToken}`,
        Accept: 'application/json',
      },
    },
    'users_me'
  )
  await throwForProviderResponse(res, 'users_me')

  const body = await parseProviderJson<AsanaMeResponse>(res, 'users_me')
  const gid = body.data?.gid
  if (!gid) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'users_me',
      reason: 'missing data.gid in response',
    })
  }

  const name = body.data?.name
  const email = body.data?.email
  const storedMetadata: Record<string, string> = { userGid: gid }
  if (email) storedMetadata.email = email

  return {
    displayName: name || email || `Asana user ${gid}`,
    auditMetadata: { asanaUserGid: gid },
    storedMetadata,
  }
}
