import type {
  ClientCredentialAccountFields,
  ClientCredentialAccountMintOptions,
  ClientCredentialAccountMintResult,
} from '@/lib/credentials/client-credential-accounts/server'
import {
  assertCredentialText,
  providerFailureCode,
  providerFailureReason,
  requireClientSecret,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import { requestZoomInfoToken, ZoomInfoTokenError } from '@/lib/internal/zoominfo/client'

const STEP = 'zoominfo_token_mint'
const MAX_CREDENTIAL_BYTES = 1_024

/**
 * Mints a ZoomInfo API access token for a client-credentials app through the
 * same exchange the legacy block uses: `POST
 * https://api.zoominfo.com/gtm/oauth/v1/token` with `grant_type=client_credentials`
 * and the client id and secret in HTTP Basic auth, redirects refused. The token
 * acts as the app's integration user with the app's configured scopes; its
 * lifetime comes from `expires_in`.
 *
 * The connect-time check is the mint alone, so connecting calls no data
 * endpoint that could consume credits.
 *
 * @see https://docs.zoominfo.com/docs/client-credentials-flow
 */
export async function mintZoomInfoServiceAccountToken(
  fields: ClientCredentialAccountFields,
  options?: ClientCredentialAccountMintOptions
): Promise<ClientCredentialAccountMintResult> {
  options?.signal?.throwIfAborted()
  const clientSecret = requireClientSecret(fields.clientSecret, STEP, 'ZoomInfo')
  assertCredentialText(fields.clientId, 'client ID', STEP, { maxBytes: MAX_CREDENTIAL_BYTES })
  // A colon would end the Basic auth user and shift the rest into the password.
  if (fields.clientId.includes(':')) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: STEP,
      reason: 'client ID is invalid',
    })
  }
  assertCredentialText(clientSecret, 'client secret', STEP, { maxBytes: MAX_CREDENTIAL_BYTES })

  let minted: Awaited<ReturnType<typeof requestZoomInfoToken>>
  try {
    minted = await requestZoomInfoToken(
      { clientId: fields.clientId, clientSecret },
      { signal: options?.signal }
    )
  } catch (error) {
    options?.signal?.throwIfAborted()
    if (error instanceof ZoomInfoTokenError) {
      throw new TokenServiceAccountValidationError(
        providerFailureCode(error.tokenStatus),
        error.tokenStatus,
        { step: STEP }
      )
    }
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: STEP,
      reason: providerFailureReason(error),
    })
  }

  const grantedScopes = minted.scope?.split(/\s+/).filter(Boolean)
  return {
    accessToken: minted.accessToken,
    expiresInSeconds: minted.expiresInSeconds,
    grantedScopes,
    identity: {
      displayName: 'ZoomInfo API credential',
      principal: null,
      auditMetadata: { zoominfoClientId: fields.clientId },
      ...(grantedScopes?.length
        ? { storedMetadata: { grantedScopes: grantedScopes.join(' ') } }
        : {}),
    },
  }
}
