import {
  fetchProvider,
  TokenServiceAccountValidationError,
  throwForProviderResponse,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'
import { HIGGSFIELD_API_BASE, higgsfieldAuthHeaders } from '@/lib/media/higgsfield'

/**
 * Higgsfield has no identity endpoint, so the key is checked against the documented request
 * status route with an ID no account owns: an accepted key gets 404, a rejected one gets 401.
 */
const HIGGSFIELD_VERIFY_URL = `${HIGGSFIELD_API_BASE}/requests/00000000-0000-4000-8000-000000000000/status`
const KEY_PATTERN = /^([^:\s]+):[^:\s]+$/

/** Verifies a Higgsfield `KEY_ID:KEY_SECRET` pair. */
export async function validateHiggsfieldServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const keyId = KEY_PATTERN.exec(fields.apiToken.trim())?.[1]
  if (!keyId) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: 'format',
      reason: 'expected KEY_ID:KEY_SECRET',
    })
  }

  const response = await fetchProvider(
    HIGGSFIELD_VERIFY_URL,
    {
      headers: higgsfieldAuthHeaders(fields.apiToken),
      redirect: 'error',
    },
    'get_request_status'
  )
  if (response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new TokenServiceAccountValidationError('provider_unavailable', response.status, {
      step: 'get_request_status',
      reason: 'expected 404 for an unknown request',
    })
  }
  if (response.status !== 404) await throwForProviderResponse(response, 'get_request_status')
  await response.body?.cancel().catch(() => undefined)

  return {
    displayName: `Higgsfield (${keyId})`,
    principal: null,
    auditMetadata: { higgsfieldKeyId: keyId },
    storedMetadata: { keyId },
  }
}
