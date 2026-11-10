import {
  fetchProvider,
  TokenServiceAccountValidationError,
  throwForProviderResponse,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'

/**
 * Flint has no identity endpoint, so the key is checked against the documented get-task route
 * with an ID no organization owns: an accepted key gets 404, a rejected one gets 401.
 */
const FLINT_VERIFY_URL =
  'https://app.tryflint.com/api/v1/agent/tasks/bg-00000000-0000-4000-8000-000000000000-00000000'

/** Verifies a Flint API key. */
export async function validateFlintServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const response = await fetchProvider(
    FLINT_VERIFY_URL,
    {
      headers: { Authorization: `Bearer ${fields.apiToken.trim()}`, Accept: 'application/json' },
      redirect: 'error',
    },
    'get_task'
  )
  if (response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new TokenServiceAccountValidationError('provider_unavailable', response.status, {
      step: 'get_task',
      reason: 'expected 404 for an unknown task',
    })
  }
  if (response.status !== 404) await throwForProviderResponse(response, 'get_task')
  await response.body?.cancel().catch(() => undefined)

  return { displayName: 'Flint', principal: null, auditMetadata: {} }
}
