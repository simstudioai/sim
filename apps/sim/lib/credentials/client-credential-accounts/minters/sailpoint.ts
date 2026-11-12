import { normalizeSailPointTenantHost } from '@/lib/credentials/client-credential-accounts/descriptors'
import type {
  ClientCredentialAccountFields,
  ClientCredentialAccountMintOptions,
  ClientCredentialAccountMintResult,
} from '@/lib/credentials/client-credential-accounts/server'
import {
  isHostNotFound,
  providerFailureCode,
  providerFailureReason,
  requireClientSecret,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import {
  requestSailPointToken,
  resolveSailPointHosts,
  SailPointAuthError,
} from '@/lib/internal/sailpoint/client'

const STEP = 'sailpoint_token_mint'
/** Bounds the whole exchange, including its 429 backoff retries. */
const TOKEN_EXCHANGE_TIMEOUT_MS = 30_000

/**
 * Mints a SailPoint Identity Security Cloud access token for an API client or
 * personal access token through the client-credentials grant at the tenant's
 * documented token endpoint, `https://{tenant}.api.identitynow.com/oauth/token` (or the same
 * path on `api.identitynowgov.com` for a government tenant).
 * The tenant comes only from {@link normalizeSailPointTenantHost}, and the
 * exchange (shared with the legacy block's inline credentials) refuses
 * redirects, so the secret reaches no other host. The token's lifetime comes
 * from `expires_in`; the credential cache re-mints before it lapses.
 *
 * The token response names no identity, so the connect-time check is the mint.
 *
 * @see https://developer.sailpoint.com/docs/api/authentication
 */
export async function mintSailPointServiceAccountToken(
  fields: ClientCredentialAccountFields,
  options?: ClientCredentialAccountMintOptions
): Promise<ClientCredentialAccountMintResult> {
  options?.signal?.throwIfAborted()
  const clientSecret = requireClientSecret(fields.clientSecret, STEP, 'SailPoint')
  const host = normalizeSailPointTenantHost(fields.orgId)
  if (!host) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: STEP,
      reason: 'tenant is not a SailPoint Identity Security Cloud API host',
    })
  }

  const { tokenUrl } = resolveSailPointHosts(host)
  const timeout = AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS)
  let minted: { token: string; expiresInSeconds: number }
  try {
    minted = await requestSailPointToken(
      tokenUrl,
      fields.clientId,
      clientSecret,
      options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    )
  } catch (error) {
    options?.signal?.throwIfAborted()
    if (error instanceof SailPointAuthError) {
      throw new TokenServiceAccountValidationError(
        providerFailureCode(error.status),
        error.status,
        {
          step: STEP,
          tenant: host,
        }
      )
    }
    if (isHostNotFound(error)) {
      throw new TokenServiceAccountValidationError('site_not_found', 400, {
        step: STEP,
        reason: 'tenant host does not resolve',
        tenant: host,
      })
    }
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: STEP,
      reason: providerFailureReason(error),
    })
  }

  return {
    accessToken: minted.token,
    expiresInSeconds: minted.expiresInSeconds,
    domain: host,
    identity: {
      displayName: `SailPoint ${host.split('.')[0]}`,
      principal: null,
      auditMetadata: { sailpointTenant: host, sailpointClientId: fields.clientId },
      storedMetadata: { tenant: host },
    },
  }
}
