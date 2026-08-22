import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getCredentialActorContext } from '@/lib/credentials/access'
import {
  listCredentialProviderCatalog,
  type OAuthCredentialProviderCatalogEntry,
  requireAvailableOAuthCredentialProvider,
} from '@/lib/credentials/application/provider-catalog'
import { getWorkspaceCredential } from '@/lib/credentials/queries'
import { credentialProviderMatchesService } from '@/lib/oauth/utils'
import type { ActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export interface ResolvedCredentialConnectionTarget {
  provider: OAuthCredentialProviderCatalogEntry
  providerId: string
  credentialId?: string
  displayName?: string
}

export class CredentialConnectionProviderMismatchError extends OrchestrationError {
  constructor() {
    super('validation', 'Credential provider does not match the requested OAuth provider')
    this.name = 'CredentialConnectionProviderMismatchError'
  }
}

export async function resolveCredentialConnectionTarget(params: {
  principal: Principal
  context: ActiveWorkspaceApplicationContext
  providerId?: string
  credentialId?: string
  assertedProviderId?: string
}): Promise<ResolvedCredentialConnectionTarget> {
  const { principal, context, providerId, credentialId, assertedProviderId } = params
  if (Boolean(providerId) === Boolean(credentialId)) {
    throw new Error('Credential connection requires exactly one target identifier')
  }

  const catalog = await listCredentialProviderCatalog(principal, context)
  if (providerId) {
    return {
      provider: requireAvailableOAuthCredentialProvider(catalog, providerId),
      providerId,
    }
  }

  if (!credentialId) throw new Error('Credential reconnect target is missing its credential ID')
  const userId = requirePrincipalSubjectUserId(principal)
  const targetCredentialId = credentialId
  const credential = await getWorkspaceCredential({
    workspaceId: context.workspaceId,
    credentialId: targetCredentialId,
  })
  if (!credential) throw new OrchestrationError('not_found', 'Credential not found')
  if (credential.type !== 'oauth' || !credential.providerId) {
    throw new OrchestrationError('validation', 'Only OAuth credentials can be reconnected')
  }
  const credentialProviderId = credential.providerId
  if (assertedProviderId && assertedProviderId !== credentialProviderId) {
    throw new CredentialConnectionProviderMismatchError()
  }

  const actor = await getCredentialActorContext(targetCredentialId, userId)
  if (!actor.credential || actor.credential.workspaceId !== context.workspaceId) {
    throw new OrchestrationError('not_found', 'Credential not found')
  }
  if (!actor.isAdmin) {
    throw new ForbiddenOperationError(
      'CREDENTIAL_ADMIN_ACCESS_REQUIRED',
      'Admin access on the credential is required to reconnect it'
    )
  }

  const provider = catalog.find(
    (entry): entry is OAuthCredentialProviderCatalogEntry =>
      entry.type === 'oauth' &&
      credentialProviderMatchesService(credentialProviderId, {
        providerId: entry.authorizationOptions[0].providerId,
        additionalProviderIds: entry.authorizationOptions
          .slice(1)
          .map((option) => option.providerId),
      })
  )
  if (!provider) {
    throw new OrchestrationError('validation', `Unknown OAuth provider: ${credentialProviderId}`)
  }
  if (!provider.available) {
    throw new OrchestrationError(
      'conflict',
      `OAuth provider is unavailable: ${credentialProviderId}`
    )
  }
  if (!provider.supportsReconnect) {
    throw new OrchestrationError(
      'conflict',
      `OAuth provider does not support reconnecting credentials: ${credentialProviderId}`
    )
  }

  return {
    provider,
    providerId: credentialProviderId,
    credentialId: credential.id,
    displayName: credential.displayName,
  }
}
