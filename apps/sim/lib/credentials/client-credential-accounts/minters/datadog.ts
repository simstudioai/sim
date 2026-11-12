import { toRecord } from '@sim/utils/object'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import type {
  ClientCredentialAccountFields,
  ClientCredentialAccountMintOptions,
  ClientCredentialAccountMintResult,
} from '@/lib/credentials/client-credential-accounts/server'
import {
  assertCredentialText,
  fetchProvider,
  requireClientSecret,
  TokenServiceAccountValidationError,
  throwForProviderResponse,
} from '@/lib/credentials/token-service-accounts/errors'
import { datadogApiUrl, isDatadogSite } from '@/tools/datadog/utils'

const STEP = 'datadog_key_check'
/** Datadog keys do not expire on their own; the TTL only bounds the local token cache. */
const SYNTHETIC_TOKEN_TTL_SECONDS = 3600
const MAX_KEY_BYTES = 1_024
const MAX_VALIDATE_RESPONSE_BYTES = 16 * 1024

function invalidCredentials(reason: string): TokenServiceAccountValidationError {
  return new TokenServiceAccountValidationError('invalid_credentials', 400, { step: STEP, reason })
}

/**
 * Resolves a saved Datadog key pair. Datadog authenticates every request with
 * two static headers, so nothing is minted: the API key travels as the
 * credential's token, the application key beside it, and the site (one of
 * Datadog's published regional sites) as its domain, which the tools build
 * their host from.
 *
 * Connect-time verification calls `GET https://api.{site}/api/v1/validate`
 * with the API key alone, the documented check that answers 403 for an
 * invalid API key. The application key is deliberately not probed: Datadog
 * publishes no reference for an application-key check, and any other read
 * would refuse a correctly scoped key with a permission 403. Datadog reports a
 * bad application key on the first request that needs one.
 *
 * @see https://docs.datadoghq.com/api/latest/authentication/#validate-api-key
 */
export async function mintDatadogServiceAccountToken(
  fields: ClientCredentialAccountFields,
  options?: ClientCredentialAccountMintOptions
): Promise<ClientCredentialAccountMintResult> {
  options?.signal?.throwIfAborted()
  const apiKey = fields.clientId.trim()
  const applicationKey = requireClientSecret(fields.clientSecret, STEP, 'Datadog').trim()
  assertCredentialText(apiKey, 'API key', STEP, { maxBytes: MAX_KEY_BYTES, forbidSpaces: true })
  assertCredentialText(applicationKey, 'application key', STEP, {
    maxBytes: MAX_KEY_BYTES,
    forbidSpaces: true,
  })
  const site = fields.dataCenter?.trim()
  if (!isDatadogSite(site)) throw invalidCredentials('unknown Datadog site')

  const resolved = {
    accessToken: apiKey,
    applicationKey,
    domain: site,
    expiresInSeconds: SYNTHETIC_TOKEN_TTL_SECONDS,
  }
  if (options?.skipIdentity) return resolved

  const response = await fetchProvider(
    datadogApiUrl(site, '/api/v1/validate'),
    {
      method: 'GET',
      signal: options?.signal,
      headers: { Accept: 'application/json', 'DD-API-KEY': apiKey },
    },
    STEP
  )
  await throwForProviderResponse(response, STEP, { site })

  let body: Record<string, unknown>
  try {
    body = toRecord(
      await readResponseJsonWithLimit(response, {
        maxBytes: MAX_VALIDATE_RESPONSE_BYTES,
        label: 'Datadog validate response',
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
  if (typeof body.valid !== 'boolean') {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: STEP,
      reason: 'Datadog validate response did not report whether the key is valid',
    })
  }
  if (!body.valid) throw invalidCredentials('Datadog did not report the API key valid')

  return {
    ...resolved,
    identity: {
      displayName: `Datadog ${site}`,
      principal: null,
      auditMetadata: { datadogSite: site },
      storedMetadata: { site },
    },
  }
}
