import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import type { WorkspaceAuthorizationContext } from '@/lib/core/application/workspace-authorization'
import { type FeatureFlagName, isFeatureEnabled } from '@/lib/core/config/feature-flags'

/**
 * A rollout flag an operation is available behind. Declared on the operation
 * (`feature` on `defineWorkspaceOperation`), so the shared use-case wrapper
 * checks it after authorization: a caller who cannot reach the workspace is
 * refused (and concealed) exactly as if the feature were on, and only a caller
 * who could run the operation learns that it is off.
 */
export interface OperationFeature {
  readonly flag: FeatureFlagName
  /** What a caller who may run the operation is told while the flag is off for them. */
  readonly unavailableMessage: string
}

type FeatureScope = Pick<WorkspaceAuthorizationContext, 'workspaceId' | 'workspaceOrganizationId'>

/**
 * Whether `feature` is rolled out where an operation runs: its workspace, that
 * workspace's organization, or the principal's user, each matched against the
 * flag's allowlists.
 */
export function isOperationFeatureEnabled(
  feature: OperationFeature,
  principal: Principal,
  context: FeatureScope
): Promise<boolean> {
  return isFeatureEnabled(feature.flag, {
    orgId: context.workspaceOrganizationId,
    workspaceId: context.workspaceId,
    userId: resolvePrincipalSubjectUserId(principal),
  })
}

/** Throws `FEATURE_NOT_ENABLED` unless {@link isOperationFeatureEnabled} holds. */
export async function requireOperationFeature(
  feature: OperationFeature,
  principal: Principal,
  context: FeatureScope
): Promise<void> {
  if (!(await isOperationFeatureEnabled(feature, principal, context))) {
    throw new ForbiddenOperationError('FEATURE_NOT_ENABLED', feature.unavailableMessage)
  }
}
