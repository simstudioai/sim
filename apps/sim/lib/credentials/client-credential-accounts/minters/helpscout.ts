import { toRecord } from '@sim/utils/object'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import type {
  ClientCredentialAccountFields,
  ClientCredentialAccountMintOptions,
  ClientCredentialAccountMintResult,
} from '@/lib/credentials/client-credential-accounts/server'
import { userPrincipal } from '@/lib/credentials/principal'
import {
  fetchProvider,
  isTransientProviderStatus,
  requireClientSecret,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'

const MAX_HELPSCOUT_AUTH_RESPONSE_BYTES = 64 * 1024

async function readHelpScoutAuthResponse(
  response: Response,
  step: string,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  signal?.throwIfAborted()
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
        maxBytes: MAX_HELPSCOUT_AUTH_RESPONSE_BYTES,
        label: 'Help Scout authentication response',
        signal,
      })
    )
  } catch {
    signal?.throwIfAborted()
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step,
      reason: 'provider returned an invalid or oversized response',
    })
  }
}

/**
 * Obtains an access token for a customer's own Help Scout app (client credentials grant) and,
 * at connect time, verifies the user the token acts as.
 */
export async function mintHelpScoutServiceAccountToken(
  fields: ClientCredentialAccountFields,
  options?: ClientCredentialAccountMintOptions
): Promise<ClientCredentialAccountMintResult> {
  options?.signal?.throwIfAborted()
  const clientSecret = requireClientSecret(
    fields.clientSecret,
    'helpscout_token_mint',
    'Help Scout'
  )
  const tokenResponse = await fetchProvider(
    'https://api.helpscout.net/v2/oauth2/token',
    {
      method: 'POST',
      redirect: 'error',
      signal: options?.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: fields.clientId,
        client_secret: clientSecret,
      }).toString(),
    },
    'helpscout_token_mint'
  )
  const token = await readHelpScoutAuthResponse(
    tokenResponse,
    'helpscout_token_mint',
    options?.signal
  )
  if (
    typeof token.access_token !== 'string' ||
    !token.access_token.trim() ||
    typeof token.expires_in !== 'number' ||
    !Number.isSafeInteger(token.expires_in) ||
    token.expires_in <= 0
  ) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'helpscout_token_mint',
      reason: 'token response missing a valid access token or lifetime',
    })
  }

  const result: ClientCredentialAccountMintResult = {
    accessToken: token.access_token,
    expiresInSeconds: token.expires_in,
  }
  if (options?.skipIdentity) return result

  const userResponse = await fetchProvider(
    'https://api.helpscout.net/v2/users/me',
    {
      method: 'GET',
      redirect: 'error',
      signal: options?.signal,
      headers: { Authorization: `Bearer ${result.accessToken}`, Accept: 'application/json' },
    },
    'helpscout_user_lookup'
  )
  const user = await readHelpScoutAuthResponse(
    userResponse,
    'helpscout_user_lookup',
    options?.signal
  )
  if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id)) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'helpscout_user_lookup',
      reason: 'user response missing an identifier',
    })
  }

  const userId = String(user.id)
  const email = typeof user.email === 'string' && user.email.trim() ? user.email.trim() : null
  const name = [user.firstName, user.lastName]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join(' ')
  const companyId =
    typeof user.companyId === 'number' && Number.isSafeInteger(user.companyId)
      ? String(user.companyId)
      : null
  return {
    ...result,
    identity: {
      displayName: name || email || `Help Scout user ${userId}`,
      principal: userPrincipal(userId, email),
      auditMetadata: {
        helpScoutAppId: fields.clientId,
        ...(companyId ? { helpScoutCompanyId: companyId } : {}),
      },
    },
  }
}
