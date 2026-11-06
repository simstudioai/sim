import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import type { OrganizationMembershipContext } from '@/lib/core/application/organization-authorization'
import { rejectManagedOAuthToken, resolveManagedOAuthToken } from '@/lib/credentials/managed-oauth'
import { recordCredentialAccess } from '@/lib/oauth/token-resolution'
import { HomeProviderReadError } from '@/lib/organizations/home/provider-reads'

export interface ProviderTokenInput {
  context: OrganizationMembershipContext
  credentialId: string
  providerId: string
}

/** Runs a provider read with an account's token, however many reads one widget request needs. */
export type AccountTokenRead = <T>(read: (accessToken: string) => Promise<T>) => Promise<T>

function resolveToken({ context, credentialId, providerId }: ProviderTokenInput) {
  return resolveManagedOAuthToken({
    credentialId,
    organizationId: context.organizationId,
    expectedProviderId: providerId,
    requiredScopes: [],
  })
}

function isTokenRejected(error: unknown) {
  return error instanceof HomeProviderReadError && error.failure === 'token_rejected'
}

/**
 * One widget request's use of an account's token: resolved and recorded once, and kept until the
 * provider refuses it. A refused read runs once more with a fresh token, resolved whether or not
 * this call was the one that rejected the old token, since a concurrent read of the same account may
 * already have rotated it. Create one per request, so a revoked grant applies on the next request.
 */
export function createAccountTokenRead(input: ProviderTokenInput): AccountTokenRead {
  const { context, credentialId, providerId } = input
  let currentToken: string | null = null

  return async (read) => {
    if (currentToken === null) {
      currentToken = (await resolveToken(input)).accessToken
      recordCredentialAccess({
        actorId: context.userId,
        workspaceId: null,
        resourceId: credentialId,
        providerId,
        credentialType: 'oauth',
      })
    }
    try {
      return await read(currentToken)
    } catch (error) {
      if (!isTokenRejected(error)) throw error
    }
    const rejected = await rejectManagedOAuthToken({
      credentialId,
      organizationId: context.organizationId,
      expectedProviderId: providerId,
      requiredScopes: [],
      rejectedAccessToken: currentToken,
    })
    if (rejected)
      recordAudit({
        actorId: context.userId,
        action: AuditAction.CREDENTIAL_UPDATED,
        resourceType: AuditResourceType.CREDENTIAL,
        resourceId: credentialId,
        description: 'Marked provider-rejected managed OAuth credential as needing reauthorization',
        metadata: {
          organizationId: context.organizationId,
          provider: providerId,
          credentialType: 'managed_oauth',
        },
      })
    currentToken = null
    const fresh = await resolveToken(input)
    currentToken = fresh.accessToken
    try {
      return await read(fresh.accessToken)
    } catch (error) {
      if (isTokenRejected(error)) throw new HomeProviderReadError('needs_reauth', 401)
      throw error
    }
  }
}
