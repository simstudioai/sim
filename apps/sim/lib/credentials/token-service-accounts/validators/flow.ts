import { toRecord } from '@sim/utils/object'
import { EgressRefusedError } from '@/lib/core/network/transport.server'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { userPrincipal } from '@/lib/credentials/principal'
import {
  isHostNotFound,
  isTransientProviderStatus,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'
import { flowHeaders, normalizeFlowOrigin, normalizeFlowWorkspaceId } from '@/lib/flow/client'

export async function validateFlowServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  let origin: string
  let providerWorkspaceId: string
  try {
    origin = normalizeFlowOrigin(fields.domain)
    providerWorkspaceId = normalizeFlowWorkspaceId(fields.providerWorkspaceId ?? '')
  } catch {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400)
  }
  try {
    const response = await secureFetchWithValidation(`${origin}/users/me`, {
      profile: 'configuredEndpoint',
      headers: flowHeaders({ accessToken: fields.apiToken, providerWorkspaceId }),
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
    const person = toRecord(await response.json())
    if (
      typeof person.id !== 'string' ||
      !person.id.trim() ||
      typeof person.email !== 'string' ||
      !person.email.trim() ||
      person.deactivated_at !== null
    ) {
      throw new TokenServiceAccountValidationError('invalid_credentials', 400)
    }
    return {
      displayName: person.email,
      principal: person.is_bot === true ? null : userPrincipal(person.id, person.email),
      normalizedDomain: origin,
      auditMetadata: { providerWorkspaceId },
    }
  } catch (error) {
    if (error instanceof TokenServiceAccountValidationError) throw error
    // A host the egress policy refuses, or one that doesn't exist, is the user's input.
    if (error instanceof EgressRefusedError) {
      throw new TokenServiceAccountValidationError('host_not_allowed', 400)
    }
    if (error instanceof Error && isHostNotFound(error.cause)) {
      throw new TokenServiceAccountValidationError('site_not_found', 400)
    }
    throw new TokenServiceAccountValidationError('provider_unavailable', 502)
  }
}
