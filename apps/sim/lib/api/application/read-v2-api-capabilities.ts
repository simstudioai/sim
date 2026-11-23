import { v2MetaOperations } from '@/lib/api/application/operations'
import type { V2ApiKeyType } from '@/lib/api/contracts/v2/meta'
import { getV2ApiLinks, type V2ApiLinks } from '@/lib/api/links'
import type { OAuthApiScope } from '@/lib/auth/oauth-provider'
import {
  assertOperationPrincipal,
  credentialApiScopes,
  type OperationUseCase,
} from '@/lib/core/application'

/**
 * The credential facts the authenticating adapter has already established.
 *
 * They arrive as input rather than being re-read here because both live in the
 * API-key row `authenticateV2ApiKey` has just validated, and the application
 * layer does not query API keys.
 */
export interface ReadV2ApiCapabilitiesInput {
  keyType: V2ApiKeyType
  expiresAt: Date | null
}

export interface ReadV2ApiCapabilitiesResult {
  v2Enabled: boolean
  keyType: V2ApiKeyType
  expiresAt: Date | null
  scopes: OAuthApiScope[]
  /** The API key's id; null for an OAuth access token. */
  keyId: string | null
  /** The user the credential acts for; null for a workspace key, which acts as its workspace. */
  userId: string | null
  /** The one workspace a workspace key can reach; null for every other credential. */
  workspaceId: string | null
  links: V2ApiLinks
}

/**
 * Reports the calling credential's API availability and lifecycle facts.
 *
 * The rare case where the application-boundary rule is satisfied trivially:
 * there is no workspace resource to load and no resource authorization to make,
 * because the resource *is* the key the caller already proved it holds.
 */
export const readV2ApiCapabilities: OperationUseCase<
  typeof v2MetaOperations.read,
  ReadV2ApiCapabilitiesInput,
  ReadV2ApiCapabilitiesResult
> = {
  operation: v2MetaOperations.read,
  async execute({ principal, input }) {
    assertOperationPrincipal(principal, v2MetaOperations.read)
    return {
      v2Enabled: true,
      keyType: input.keyType,
      expiresAt: input.expiresAt,
      scopes: credentialApiScopes(principal),
      keyId: principal.kind === 'oauth_access_token' ? null : principal.keyId,
      userId: principal.kind === 'workspace_api_key' ? null : principal.userId,
      workspaceId: principal.kind === 'workspace_api_key' ? principal.workspaceId : null,
      links: getV2ApiLinks(),
    }
  },
}
