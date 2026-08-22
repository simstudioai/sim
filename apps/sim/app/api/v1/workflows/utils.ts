import { NextResponse } from 'next/server'
import {
  type DeploymentWorkflowTarget,
  getDeploymentWorkflowTarget,
} from '@/lib/workflows/deployments/queries'
import { type RateLimitResult, validateWorkspaceAccess } from '@/app/api/v1/middleware'

function workflowNotFoundResponse(): NextResponse {
  return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
}

/**
 * Resolves the target workflow for a v1 deployment mutation: loads the active
 * record and verifies the caller's admin permission on its workspace. Access
 * failures are masked as 404, matching the v1 workflow read surface so
 * unauthorized callers cannot probe workflow existence.
 */
export async function resolveV1DeploymentWorkflow(
  rateLimit: RateLimitResult,
  userId: string,
  workflowId: string
): Promise<({ ok: true } & DeploymentWorkflowTarget) | { ok: false; response: NextResponse }> {
  const target = await getDeploymentWorkflowTarget(workflowId)
  if (!target) {
    return { ok: false, response: workflowNotFoundResponse() }
  }

  const accessError = await validateWorkspaceAccess(rateLimit, userId, target.workspaceId, 'admin')
  if (accessError) {
    return { ok: false, response: workflowNotFoundResponse() }
  }

  return { ok: true, ...target }
}
