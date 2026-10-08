import { toRecord } from '@sim/utils/object'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import type {
  ClientCredentialAccountFields,
  ClientCredentialAccountMintOptions,
  ClientCredentialAccountMintResult,
} from '@/lib/credentials/client-credential-accounts/server'
import { tenantPrincipal } from '@/lib/credentials/principal'
import {
  fetchProvider,
  isTransientProviderStatus,
  requireClientSecret,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import { getScopesForService } from '@/lib/oauth/utils'

const MAX_RAMP_AUTH_RESPONSE_BYTES = 64 * 1024

async function readRampAuthResponse(
  response: Response,
  step: string
): Promise<Record<string, unknown>> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new TokenServiceAccountValidationError(
      response.status >= 400 && response.status < 500 && !isTransientProviderStatus(response.status)
        ? 'invalid_credentials'
        : 'provider_unavailable',
      response.status,
      { step }
    )
  }

  try {
    return toRecord(
      await readResponseJsonWithLimit(response, {
        maxBytes: MAX_RAMP_AUTH_RESPONSE_BYTES,
        label: 'Ramp authentication response',
      })
    )
  } catch {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step,
      reason: 'provider returned an invalid or oversized response',
    })
  }
}

/** Obtains an access token for a customer's own Ramp app and verifies its business on connection. */
export async function mintRampServiceAccountToken(
  fields: ClientCredentialAccountFields,
  options?: ClientCredentialAccountMintOptions
): Promise<ClientCredentialAccountMintResult> {
  const clientSecret = requireClientSecret(fields.clientSecret, 'ramp_token_mint', 'Ramp')
  const scopes = getScopesForService('ramp')
  const tokenResponse = await fetchProvider(
    'https://api.ramp.com/developer/v1/token',
    {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Basic ${Buffer.from(`${fields.clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: scopes.join(' '),
      }).toString(),
    },
    'ramp_token_mint'
  )
  const token = await readRampAuthResponse(tokenResponse, 'ramp_token_mint')
  if (
    typeof token.access_token !== 'string' ||
    !token.access_token.trim() ||
    typeof token.expires_in !== 'number' ||
    !Number.isSafeInteger(token.expires_in) ||
    token.expires_in <= 0
  ) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'ramp_token_mint',
      reason: 'token response missing a valid access token or lifetime',
    })
  }

  const result: ClientCredentialAccountMintResult = {
    accessToken: token.access_token,
    expiresInSeconds: token.expires_in,
    grantedScopes:
      typeof token.scope === 'string' ? token.scope.split(/\s+/).filter(Boolean) : scopes,
  }
  if (options?.skipIdentity) return result

  const businessResponse = await fetchProvider(
    'https://api.ramp.com/developer/v1/business',
    {
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: `Bearer ${result.accessToken}` },
    },
    'ramp_business_lookup'
  )
  const business = await readRampAuthResponse(businessResponse, 'ramp_business_lookup')
  if (typeof business.id !== 'string' || !business.id.trim()) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'ramp_business_lookup',
      reason: 'business response missing an identifier',
    })
  }

  const displayName =
    typeof business.business_name_legal === 'string' && business.business_name_legal.trim()
      ? business.business_name_legal.trim()
      : `Ramp business ${business.id}`
  return {
    ...result,
    identity: {
      displayName,
      principal: tenantPrincipal(business.id),
      auditMetadata: { rampClientId: fields.clientId },
    },
  }
}
