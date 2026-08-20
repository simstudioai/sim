import type {
  PersonalApiKeyPrincipal,
  Principal,
  WorkspaceApiKeyPrincipal,
} from '@sim/auth/principal'
import { v2MetaOperations } from '@/lib/api/application/operations'
import type { NoInput } from '@/lib/api/contracts/primitives'
import type { V2ApiKeyType } from '@/lib/api/contracts/v2/meta'
import { getApiKeyExpiry } from '@/lib/api-key/service'
import { resolveWorkspaceBillingPayer } from '@/lib/billing/core/billing-attribution'
import type { OperationUseCase } from '@/lib/core/application'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'

type ApiKeyPrincipal = PersonalApiKeyPrincipal | WorkspaceApiKeyPrincipal

export interface ReadV2ApiCapabilitiesResult {
  v2Enabled: boolean
  keyType: V2ApiKeyType
  expiresAt: Date | null
}

function requireApiKeyPrincipal(principal: Principal): ApiKeyPrincipal {
  if (principal.kind === 'personal_api_key' || principal.kind === 'workspace_api_key') {
    return principal
  }
  throw new OrchestrationError('forbidden', 'API key authentication required')
}

/**
 * The rollout subject the `v2-api` gate is keyed on, resolved exactly as
 * `authenticateV2ApiKey` resolves it: a personal key answers for its own user; a
 * workspace key is actor-less, so the gate falls back to the workspace's
 * canonical billing owner as rollout-only context. Re-deriving it through the
 * same `resolveWorkspaceBillingPayer` is what keeps this endpoint's answer and
 * the gate's decision from drifting apart. That billing owner is rollout context
 * only, never an authorization principal.
 */
async function resolveRolloutUserId(principal: ApiKeyPrincipal): Promise<string> {
  if (principal.kind === 'personal_api_key') return principal.userId
  const payer = await resolveWorkspaceBillingPayer(principal.workspaceId)
  if (!payer) {
    throw new Error(`Workspace ${principal.workspaceId} is missing its billing owner`)
  }
  return payer.billedAccountUserId
}

/**
 * Reports the calling credential's own rollout and lifecycle facts.
 *
 * The rare case where the application-boundary rule is satisfied trivially:
 * there is no workspace resource to load and no resource authorization to make,
 * because the resource *is* the key the caller already proved it holds. The one
 * protected read it does make — that key's expiry — is keyed on the
 * authenticated `keyId`, never on anything the caller supplied.
 */
export const readV2ApiCapabilities: OperationUseCase<
  typeof v2MetaOperations.read,
  NoInput,
  ReadV2ApiCapabilitiesResult
> = {
  operation: v2MetaOperations.read,
  async execute({ principal }) {
    const apiKeyPrincipal = requireApiKeyPrincipal(principal)
    const [v2Enabled, expiresAt] = await Promise.all([
      resolveRolloutUserId(apiKeyPrincipal).then((userId) =>
        isFeatureEnabled('v2-api', { userId })
      ),
      getApiKeyExpiry(apiKeyPrincipal.keyId),
    ])
    return {
      v2Enabled,
      keyType: apiKeyPrincipal.kind === 'workspace_api_key' ? 'workspace' : 'personal',
      expiresAt,
    }
  },
}
