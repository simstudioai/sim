import { toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import type {
  ClientCredentialAccountFields,
  ClientCredentialAccountMintOptions,
  ClientCredentialAccountMintResult,
} from '@/lib/credentials/client-credential-accounts/server'
import { tenantPrincipal, userPrincipal } from '@/lib/credentials/principal'
import {
  fetchProvider,
  parseProviderJson,
  requireClientSecret,
  TokenServiceAccountValidationError,
  throwForProviderResponse,
} from '@/lib/credentials/token-service-accounts/errors'

const FIVETRAN_ACCOUNT_INFO_URL = 'https://api.fivetran.com/v1/account/info'
const STEP = 'fivetran_basic_auth'
/** Fivetran keys do not expire on their own; the TTL only bounds the local token cache. */
const SYNTHETIC_TOKEN_TTL_SECONDS = 3600
const MAX_AUTH_VALUE_BYTES = 1_024
const FORBIDDEN_CREDENTIAL_TEXT = /[\u0000-\u001f\u007f]/

function invalidCredentials(reason: string): TokenServiceAccountValidationError {
  return new TokenServiceAccountValidationError('invalid_credentials', 400, { step: STEP, reason })
}

function assertCredentialText(value: string, label: string): void {
  if (
    !value ||
    FORBIDDEN_CREDENTIAL_TEXT.test(value) ||
    Buffer.byteLength(value, 'utf8') > MAX_AUTH_VALUE_BYTES
  ) {
    throw invalidCredentials(`${label} is invalid`)
  }
}

/**
 * Builds Fivetran's HTTP Basic credential (API key as username, API secret as
 * password). Connect-time verification calls `GET /v1/account/info`, which
 * also names the account and the user or system key behind the credential;
 * execution-time resolution skips the call because the credential is static.
 */
export async function mintFivetranServiceAccountToken(
  fields: ClientCredentialAccountFields,
  options?: ClientCredentialAccountMintOptions
): Promise<ClientCredentialAccountMintResult> {
  const apiKey = fields.clientId.trim()
  const apiSecret = requireClientSecret(fields.clientSecret, STEP, 'Fivetran').trim()
  assertCredentialText(apiKey, 'API key')
  if (apiKey.includes(':')) throw invalidCredentials('API key is invalid')
  assertCredentialText(apiSecret, 'API secret')

  const accessToken = Buffer.from(`${apiKey}:${apiSecret}`, 'utf8').toString('base64')
  if (options?.skipIdentity) {
    return { accessToken, expiresInSeconds: SYNTHETIC_TOKEN_TTL_SECONDS }
  }

  const res = await fetchProvider(
    FIVETRAN_ACCOUNT_INFO_URL,
    {
      method: 'GET',
      headers: { Authorization: `Basic ${accessToken}`, Accept: 'application/json' },
      redirect: 'error',
      signal: options?.signal,
    },
    STEP
  )
  await throwForProviderResponse(res, STEP)

  const data = toRecord(toRecord(await parseProviderJson<unknown>(res, STEP)).data)
  const accountId = toStringOrNull(data.account_id)
  if (!accountId) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: STEP,
      reason: 'account info response missing account_id',
    })
  }
  const accountName = toStringOrNull(data.account_name)
  const userId = toStringOrNull(data.user_id)
  const systemKeyId = toStringOrNull(data.system_key_id)

  return {
    accessToken,
    expiresInSeconds: SYNTHETIC_TOKEN_TTL_SECONDS,
    identity: {
      displayName: `Fivetran ${accountName ?? accountId}`,
      principal: userId ? userPrincipal(userId) : tenantPrincipal(accountId, accountName),
      auditMetadata: {
        fivetranAccountId: accountId,
        ...(systemKeyId ? { fivetranSystemKeyId: systemKeyId } : {}),
      },
      storedMetadata: { accountId },
    },
  }
}
