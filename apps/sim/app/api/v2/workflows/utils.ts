import type { PermissionType } from '@sim/platform-authz/workspace'
import {
  type DeploymentWorkflowTarget,
  getDeploymentWorkflowTarget,
} from '@/lib/workflows/deployments/queries'
import { type RateLimitResult, resolveWorkspaceAccess } from '@/app/api/v1/middleware'

/** Resolves an authorized active workflow while keeping the v2 response adapter route-local. */
export async function resolveV2WorkflowTarget(
  rateLimit: RateLimitResult,
  userId: string,
  workflowId: string,
  level: PermissionType = 'read'
): Promise<DeploymentWorkflowTarget | null> {
  const target = await getDeploymentWorkflowTarget(workflowId)
  if (!target) return null

  const accessError = await resolveWorkspaceAccess(rateLimit, userId, target.workspaceId, level)
  return accessError ? null : target
}
