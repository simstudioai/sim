import {
  type SecureFetchResponse,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  normalizeOracleFusionApplicationOrigin,
  normalizeOracleFusionTokenUrl,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import type {
  ClientCredentialAccountFields,
  ClientCredentialAccountMintOptions,
  ClientCredentialAccountMintResult,
} from '@/lib/credentials/client-credential-accounts/server'
import { tenantPrincipal } from '@/lib/credentials/principal'
import {
  isTransientProviderStatus,
  requireClientSecret,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'

const TOKEN_EXCHANGE_TIMEOUT_MS = 30_000
const TOKEN_RESPONSE_MAX_BYTES = 1024 * 1024
const MAX_TOKEN_EXPIRES_IN_SECONDS = 3_600
const TOKEN_MINT_STEP = 'oracle_fusion_token_mint'

interface OracleFusionTokenResponse {
  access_token?: unknown
  expires_in?: unknown
  token_type?: unknown
}

function validationError(
  code: 'invalid_credentials' | 'site_not_found' | 'provider_unavailable',
  status: number,
  reason: string
): TokenServiceAccountValidationError {
  return new TokenServiceAccountValidationError(code, status, {
    step: TOKEN_MINT_STEP,
    reason,
  })
}

async function validatePublicOracleUrl(url: string, label: string): Promise<string> {
  const validation = await validateUrlWithDNS(url, label, 'configuredEndpoint')
  if (!validation.isValid) {
    throw validationError('site_not_found', 400, `${label} is not a public Oracle endpoint`)
  }
  return validation.resolvedIP
}

async function readTokenResponse(
  response: SecureFetchResponse,
  signal?: AbortSignal
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  let body: string
  try {
    body = await response.text()
  } catch {
    signal?.throwIfAborted()
    throw validationError('provider_unavailable', 502, 'token response could not be read')
  }
  if (!response.ok) {
    const callerError =
      response.status >= 400 && response.status < 500 && !isTransientProviderStatus(response.status)
    throw new TokenServiceAccountValidationError(
      callerError ? 'invalid_credentials' : 'provider_unavailable',
      response.status,
      {
        step: TOKEN_MINT_STEP,
        reason: 'token endpoint rejected the client-credentials request',
      }
    )
  }

  let payload: OracleFusionTokenResponse
  try {
    payload = JSON.parse(body) as OracleFusionTokenResponse
  } catch {
    throw validationError(
      'provider_unavailable',
      502,
      'provider returned a non-JSON token response'
    )
  }
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload) ||
    typeof payload.access_token !== 'string' ||
    !payload.access_token.trim()
  ) {
    throw validationError('provider_unavailable', 502, 'token response missing access_token')
  }
  if (
    typeof payload.expires_in !== 'number' ||
    !Number.isFinite(payload.expires_in) ||
    payload.expires_in <= 0
  ) {
    throw validationError(
      'provider_unavailable',
      502,
      'token response missing a positive finite expires_in'
    )
  }
  if (
    typeof payload.token_type !== 'string' ||
    payload.token_type.trim().toLowerCase() !== 'bearer'
  ) {
    throw validationError('provider_unavailable', 502, 'token response missing bearer token_type')
  }
  return {
    accessToken: payload.access_token.trim(),
    expiresInSeconds: Math.min(payload.expires_in, MAX_TOKEN_EXPIRES_IN_SECONDS),
  }
}

/** Mints a Fusion Applications token with an OCI IAM confidential application. */
export async function mintOracleFusionServiceAccountToken(
  fields: ClientCredentialAccountFields,
  options?: ClientCredentialAccountMintOptions
): Promise<ClientCredentialAccountMintResult> {
  options?.signal?.throwIfAborted()
  const instanceUrl = normalizeOracleFusionApplicationOrigin(fields.instanceUrl ?? '')
  if (!instanceUrl) {
    throw validationError(
      'site_not_found',
      400,
      'Fusion Applications URL must be a canonical Oracle-assigned HTTPS origin'
    )
  }
  const tokenUrl = normalizeOracleFusionTokenUrl(fields.tokenUrl ?? '')
  if (!tokenUrl) {
    throw validationError(
      'site_not_found',
      400,
      'Access token URL must be an OCI IAM identity-domain /oauth2/v1/token endpoint'
    )
  }
  const clientId = fields.clientId.trim()
  const clientSecret = requireClientSecret(
    fields.clientSecret,
    TOKEN_MINT_STEP,
    'Oracle Fusion Cloud Financials'
  )
  const scope = fields.scope?.trim()
  if (!clientId || !scope) {
    throw validationError('invalid_credentials', 400, 'client ID and scope are required')
  }

  await validatePublicOracleUrl(instanceUrl, 'Fusion Applications URL')
  options?.signal?.throwIfAborted()
  const tokenResolvedIP = await validatePublicOracleUrl(tokenUrl, 'Access token URL')
  options?.signal?.throwIfAborted()
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  let response: SecureFetchResponse
  try {
    response = await secureFetchWithPinnedIP(tokenUrl, tokenResolvedIP, {
      profile: 'configuredEndpoint',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope }).toString(),
      timeout: TOKEN_EXCHANGE_TIMEOUT_MS,
      maxRedirects: 0,
      maxResponseBytes: TOKEN_RESPONSE_MAX_BYTES,
      signal: options?.signal,
    })
  } catch {
    options?.signal?.throwIfAborted()
    throw validationError('provider_unavailable', 502, 'network error reaching token endpoint')
  }

  options?.signal?.throwIfAborted()
  const minted = await readTokenResponse(response, options?.signal)
  const hostname = new URL(instanceUrl).hostname
  return {
    ...minted,
    instanceUrl,
    ...(!options?.skipIdentity
      ? {
          identity: {
            displayName: `Oracle Fusion Cloud Financials ${hostname.split('.')[0]}`,
            principal: tenantPrincipal(hostname, hostname),
            auditMetadata: { oracleFusionApplicationOrigin: instanceUrl },
            storedMetadata: {
              applicationOrigin: instanceUrl,
              identityDomainHost: new URL(tokenUrl).hostname,
            },
          },
        }
      : {}),
  }
}
