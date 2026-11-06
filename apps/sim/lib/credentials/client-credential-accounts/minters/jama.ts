import { toRecord } from '@sim/utils/object'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import type {
  ClientCredentialAccountFields,
  ClientCredentialAccountMintOptions,
  ClientCredentialAccountMintResult,
} from '@/lib/credentials/client-credential-accounts/server'
import { userPrincipal } from '@/lib/credentials/principal'
import {
  isTransientProviderStatus,
  requireClientSecret,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import { normalizeJamaInstanceUrl } from '@/lib/jama/client'

/** Jama issues expiring tokens for the user who created the API credentials. */
export async function mintJamaServiceAccountToken(
  fields: ClientCredentialAccountFields,
  options?: ClientCredentialAccountMintOptions
): Promise<ClientCredentialAccountMintResult> {
  let instanceUrl: string
  try {
    instanceUrl = normalizeJamaInstanceUrl(fields.orgId)
  } catch {
    throw new TokenServiceAccountValidationError('site_not_found', 400)
  }
  const secret = requireClientSecret(fields.clientSecret, 'jama_token', 'Jama Connect')
  if (!fields.clientId || fields.clientId.includes(':') || /[\r\n]/.test(fields.clientId)) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400)
  }
  async function request(path: string, headers: Record<string, string>, body?: string) {
    try {
      const response = await secureFetchWithValidation(`${instanceUrl}/rest/${path}`, {
        profile: 'configuredEndpoint',
        method: body === undefined ? 'GET' : 'POST',
        headers: { Accept: 'application/json', ...headers },
        body,
        signal: options?.signal,
        timeout: 10_000,
        maxResponseBytes: 64 * 1024,
        maxRedirects: 0,
        logUrlValidationDetails: false,
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new TokenServiceAccountValidationError(
          response.status >= 400 &&
            response.status < 500 &&
            !isTransientProviderStatus(response.status)
            ? 'invalid_credentials'
            : 'provider_unavailable',
          response.status
        )
      }
      return toRecord(await response.json())
    } catch (error) {
      options?.signal?.throwIfAborted()
      if (error instanceof TokenServiceAccountValidationError) throw error
      if (toRecord(toRecord(error).cause).code === 'ENOTFOUND') {
        throw new TokenServiceAccountValidationError('site_not_found', 400)
      }
      throw new TokenServiceAccountValidationError('provider_unavailable', 502)
    }
  }
  const token = await request(
    'oauth/token',
    {
      Authorization: `Basic ${Buffer.from(`${fields.clientId}:${secret}`, 'utf8').toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    new URLSearchParams({ grant_type: 'client_credentials' }).toString()
  )
  if (
    typeof token.access_token !== 'string' ||
    !token.access_token.trim() ||
    typeof token.expires_in !== 'number' ||
    !Number.isSafeInteger(token.expires_in) ||
    token.expires_in <= 0
  ) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502)
  }
  const result = {
    accessToken: token.access_token,
    expiresInSeconds: token.expires_in,
    instanceUrl,
  }
  if (options?.skipIdentity) return result
  const person = toRecord(
    (
      await request('v1/users/current', {
        Authorization: `Bearer ${result.accessToken}`,
      })
    ).data
  )
  if (
    typeof person.id !== 'number' ||
    !Number.isSafeInteger(person.id) ||
    person.id <= 0 ||
    person.active !== true
  ) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400)
  }
  const email = typeof person.email === 'string' ? person.email.trim() : undefined
  return {
    ...result,
    identity: {
      displayName: email || `Jama user ${person.id}`,
      principal: userPrincipal(String(person.id), email),
      auditMetadata: { instanceUrl },
    },
  }
}
