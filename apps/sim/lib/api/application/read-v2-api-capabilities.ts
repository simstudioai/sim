import { v2MetaOperations } from '@/lib/api/application/operations'
import type { V2ApiKeyType } from '@/lib/api/contracts/v2/meta'
import { assertOperationPrincipal, type OperationUseCase } from '@/lib/core/application'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

/**
 * The credential facts the authenticating adapter has already established.
 *
 * They arrive as input rather than being re-read here because both live in the
 * API-key row `authenticateV2ApiKey` has just validated, and the application
 * layer does not query API keys. `rolloutUserId` is the subject the `v2-api`
 * gate is keyed on — a personal key answers for its own user, an actor-less
 * workspace key for its workspace's canonical billing owner. It is rollout
 * context only, never an authorization principal.
 */
export interface ReadV2ApiCapabilitiesInput {
  rolloutUserId: string
  keyType: V2ApiKeyType
  expiresAt: Date | null
}

export interface ReadV2ApiCapabilitiesResult {
  v2Enabled: boolean
  keyType: V2ApiKeyType
  expiresAt: Date | null
}

/**
 * Reports the calling credential's own rollout and lifecycle facts.
 *
 * The rare case where the application-boundary rule is satisfied trivially:
 * there is no workspace resource to load and no resource authorization to make,
 * because the resource *is* the key the caller already proved it holds. The one
 * decision left is the rollout cohort, which is this use case's whole business.
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
      v2Enabled: await isFeatureEnabled('v2-api', { userId: input.rolloutUserId }),
      keyType: input.keyType,
      expiresAt: input.expiresAt,
    }
  },
}
