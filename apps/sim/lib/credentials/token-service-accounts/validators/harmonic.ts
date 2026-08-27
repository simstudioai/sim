import {
  fetchProvider,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'

const HARMONIC_SAVED_SEARCHES_URL = 'https://api.harmonic.ai/savedSearches'

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    return
  }
}

/**
 * Validates a Harmonic team API key by listing saved searches. Harmonic does
 * not expose an identity endpoint for API keys, so the documented HTTP 200 is
 * the entire validation contract and the response body is discarded. Provider
 * error bodies are discarded too: they are not needed for this decision and
 * must never be able to echo the submitted key into logs.
 */
export async function validateHarmonicServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const response = await fetchProvider(
    HARMONIC_SAVED_SEARCHES_URL,
    {
      headers: {
        apikey: fields.apiToken,
        Accept: 'application/json',
      },
      redirect: 'error',
    },
    'saved_searches'
  )

  if (response.status !== 200) {
    await discardResponseBody(response)
    throw new TokenServiceAccountValidationError(
      response.status === 401 || response.status === 403
        ? 'invalid_credentials'
        : 'provider_unavailable',
      response.status,
      {
        step: 'saved_searches',
        reason: `provider returned HTTP ${response.status}`,
      }
    )
  }

  await discardResponseBody(response)

  return {
    displayName: `Harmonic (…${fields.apiToken.slice(-4)})`,
    principal: null,
    auditMetadata: {},
  }
}
