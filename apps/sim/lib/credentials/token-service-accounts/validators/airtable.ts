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

/**
 * Validates an Airtable personal access token (including Enterprise
 * service-account PATs) by calling the `whoami` meta endpoint, which requires
 * no scopes. Airtable documents no body shape for 401 responses, so failures
 * key off the status code alone: 401/403 mean the token was rejected, any
 * other non-2xx means Airtable is unavailable.
 *
 * `email` is present only when the token has the `user.email:read` scope, and
 * `scopes` is returned only for OAuth access tokens (never PATs) — both are
 * optional and their absence is not a failure.
 */
export async function validateAirtableServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const whoamiRes = await fetchProvider(
    'https://api.airtable.com/v0/meta/whoami',
    {
      headers: {
        Authorization: `Bearer ${fields.apiToken}`,
        Accept: 'application/json',
      },
    },
    'whoami'
  )
  await throwForProviderResponse(whoamiRes, 'whoami')

  const whoami = await parseProviderJson<{
    id?: string
    email?: string
    scopes?: string[]
  }>(whoamiRes, 'whoami')
  if (!whoami.id) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'whoami',
      reason: 'missing id in response',
    })
  }

  const storedMetadata: Record<string, string> = { userId: whoami.id }
  if (whoami.scopes) {
    storedMetadata.scopes = whoami.scopes.join(' ')
  }

  return {
    displayName: whoami.email ?? `Airtable user ${whoami.id}`,
    auditMetadata: { airtableUserId: whoami.id },
    storedMetadata,
  }
}
