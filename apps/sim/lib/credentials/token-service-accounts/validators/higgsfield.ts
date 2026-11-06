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
 * Higgsfield has no identity endpoint, so the cheapest authenticated read — one page of the
 * account's Soul ID characters — proves the key ID and secret are accepted.
 */
const HIGGSFIELD_VERIFY_URL =
  'https://api.higgsfield.ai/v1/custom-references/list?page=1&page_size=1'
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
      headers: { Authorization: `Key ${fields.apiToken.trim()}`, Accept: 'application/json' },
      redirect: 'error',
    },
    'list_custom_references'
  )
  await throwForProviderResponse(response, 'list_custom_references')
  await response.body?.cancel().catch(() => undefined)

  return {
    displayName: `Higgsfield (${keyId})`,
    principal: null,
    auditMetadata: { higgsfieldKeyId: keyId },
    storedMetadata: { keyId },
  }
}
