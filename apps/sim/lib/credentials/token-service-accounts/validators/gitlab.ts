import { toRecord } from '@sim/utils/object'
import {
  type SecureFetchResponse,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'
import {
  providerFailureCode,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'
import { normalizeGitLabHost } from '@/tools/gitlab/utils'

/** Scopes that let the GitLab tools call the REST API. */
const API_SCOPES = new Set(['api', 'read_api'])

/**
 * Verifies a GitLab personal, project, or group access token against the
 * instance it was typed with (gitlab.com or self-managed). GitLab's token
 * self-lookup answers for any of the three; the token must be active and carry
 * an API scope. The host is normalized exactly as the tools normalize it and
 * stored as the credential's domain, so runs only ever reach the verified host.
 */
export async function validateGitLabServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  let host: string
  try {
    host = normalizeGitLabHost(fields.domain)
  } catch {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: 'verify',
      reason: 'invalid host',
    })
  }
  let response: SecureFetchResponse
  try {
    response = await secureFetchWithValidation(
      `https://${host}/api/v4/personal_access_tokens/self`,
      {
        profile: 'configuredEndpoint',
        headers: { 'PRIVATE-TOKEN': fields.apiToken, Accept: 'application/json' },
        timeout: 10_000,
        maxResponseBytes: 64 * 1024,
        maxRedirects: 0,
        logUrlValidationDetails: false,
      }
    )
  } catch (error) {
    // Only ENOTFOUND proves the host doesn't exist; other lookup and network failures may pass.
    if ((error as { cause?: { code?: unknown } })?.cause?.code === 'ENOTFOUND') {
      throw new TokenServiceAccountValidationError('site_not_found', 400, {
        step: 'verify',
        reason: 'host does not resolve',
      })
    }
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'verify',
      reason: 'could not reach the GitLab host',
    })
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new TokenServiceAccountValidationError(
      providerFailureCode(response.status),
      response.status,
      { step: 'verify' }
    )
  }
  const token = toRecord(await response.json().catch(() => null))
  if (typeof token.active !== 'boolean' || !Array.isArray(token.scopes)) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'verify',
      reason: 'GitLab returned an unexpected token lookup',
    })
  }
  if (
    !token.active ||
    token.revoked === true ||
    !token.scopes.some((scope) => API_SCOPES.has(String(scope)))
  ) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: 'verify',
      reason: 'inactive token or no API scope',
    })
  }
  const name = typeof token.name === 'string' && token.name.trim() ? token.name.trim() : 'GitLab'
  return {
    displayName: `${name} (${host})`,
    principal: null,
    normalizedDomain: host,
    auditMetadata: { host },
  }
}
