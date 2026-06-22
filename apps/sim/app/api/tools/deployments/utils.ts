import { createLogger } from '@sim/logger'
import {
  authorizeWorkflowByWorkspacePermission,
  type WorkflowWorkspaceAuthorizationResult,
} from '@sim/platform-authz/workflow'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { enforceUserRateLimit } from '@/lib/core/rate-limiter'

const logger = createLogger('DeploymentToolsAPI')

export type AuthorizedDeploymentWorkflow = NonNullable<
  WorkflowWorkspaceAuthorizationResult['workflow']
>

/** Standard error body for deployment tool routes, matching the generic tool response shape. */
export function deploymentToolError(error: string, status: number): NextResponse {
  return NextResponse.json({ success: false, error }, { status })
}

/**
 * Authenticates a deployment tool request via session or internal token (API
 * keys are rejected) and applies per-user rate limiting. Runs before request
 * parsing, so it must not read the body.
 */
export async function authenticateDeploymentToolRequest(
  request: NextRequest,
  requestId: string
): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized deployment tool request`, { error: auth.error })
    return {
      ok: false,
      response: deploymentToolError(auth.error || 'Authentication required', 401),
    }
  }

  const rateLimited = await enforceUserRateLimit('deployment-tools', auth.userId)
  if (rateLimited) return { ok: false, response: rateLimited }

  return { ok: true, userId: auth.userId }
}

/**
 * Verifies the user holds the required workspace permission on the target
 * workflow and that the workflow belongs to the calling workspace. Deployment
 * mutations require `admin`, reads require `read`, matching the UI deploy
 * routes. The workspace binding keeps workflow-driven executions (schedules,
 * webhooks) from reaching into other workspaces the actor administers.
 */
export async function authorizeDeploymentWorkflow(
  userId: string,
  workflowId: string,
  workspaceId: string,
  action: 'read' | 'admin'
): Promise<
  { ok: true; workflow: AuthorizedDeploymentWorkflow } | { ok: false; response: NextResponse }
> {
  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId,
    userId,
    action,
  })

  if (!authorization.allowed || !authorization.workflow) {
    return {
      ok: false,
      response: deploymentToolError(authorization.message || 'Access denied', authorization.status),
    }
  }

  if (authorization.workflow.workspaceId !== workspaceId) {
    return {
      ok: false,
      response: deploymentToolError('Workflow not found in this workspace', 404),
    }
  }

  return { ok: true, workflow: authorization.workflow }
}
