import { toRecord } from '@sim/utils/object'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import type {
  ClientCredentialAccountFields,
  ClientCredentialAccountMintOptions,
  ClientCredentialAccountMintResult,
} from '@/lib/credentials/client-credential-accounts/server'
import {
  fetchProvider,
  requireClientSecret,
  TokenServiceAccountValidationError,
  throwForProviderResponse,
} from '@/lib/credentials/token-service-accounts/errors'
import { GREENHOUSE_TOKEN_URL } from '@/lib/oauth/greenhouse'

const STEP = 'greenhouse_token_mint'
const MAX_GREENHOUSE_TOKEN_RESPONSE_BYTES = 64 * 1024

/**
 * Obtains a Harvest v3 access token for a customer's own Greenhouse API credential through the
 * client-credentials grant. The token acts as the credential's integration service user with the
 * scopes configured on the credential in Greenhouse, so the grant requests none. Greenhouse
 * documents no identity endpoint for this grant; a successful mint is the connect-time check.
 *
 * @see https://harvestdocs.greenhouse.io/docs/authentication
 */
export async function mintGreenhouseServiceAccountToken(
  fields: ClientCredentialAccountFields,
  options?: ClientCredentialAccountMintOptions
): Promise<ClientCredentialAccountMintResult> {
  options?.signal?.throwIfAborted()
  const clientSecret = requireClientSecret(fields.clientSecret, STEP, 'Greenhouse')
  const response = await fetchProvider(
    GREENHOUSE_TOKEN_URL,
    {
      method: 'POST',
      redirect: 'error',
      signal: options?.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${fields.clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    },
    STEP
  )
  await throwForProviderResponse(response, STEP)

  let token: Record<string, unknown>
  try {
    token = toRecord(
      await readResponseJsonWithLimit(response, {
        maxBytes: MAX_GREENHOUSE_TOKEN_RESPONSE_BYTES,
        label: 'Greenhouse token response',
        signal: options?.signal,
      })
    )
  } catch {
    options?.signal?.throwIfAborted()
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: STEP,
      reason: 'provider returned an invalid or oversized response',
    })
  }

  if (
    typeof token.access_token !== 'string' ||
    !token.access_token.trim() ||
    typeof token.expires_in !== 'number' ||
    !Number.isSafeInteger(token.expires_in) ||
    token.expires_in <= 0
  ) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: STEP,
      reason: 'token response missing a valid access token or lifetime',
    })
  }

  return {
    accessToken: token.access_token,
    expiresInSeconds: token.expires_in,
    identity: {
      displayName: 'Greenhouse API credential',
      principal: null,
      auditMetadata: { greenhouseClientId: fields.clientId },
    },
  }
}
