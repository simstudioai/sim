import type { workflow as workflowTable } from '@sim/db/schema'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import type { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceBillingSettings } from '@/lib/workspaces/utils'
import { authenticateV1Request } from '@/app/api/v1/auth'
import { v2Error } from '@/app/api/v2/lib/response'

type WorkflowRecord = typeof workflowTable.$inferSelect

export type V2WorkflowAccess =
  | {
      ok: true
      userId: string
      keyType: 'personal' | 'workspace' | undefined
      workflow: WorkflowRecord
    }
  | { ok: false; response: NextResponse }

/**
 * X-API-Key auth + workflow authorization for the v2 execution sub-resources.
 * Authorization failures and workspace-key scope mismatches are masked as 404
 * so cross-workspace workflow existence never leaks; personal keys honor the
 * workspace's `allowPersonalApiKeys` setting.
 */
export async function resolveV2WorkflowAccess(
  request: NextRequest,
  workflowId: string,
  action: 'read' | 'write'
): Promise<V2WorkflowAccess> {
  const auth = await authenticateV1Request(request)
  if (!auth.authenticated || !auth.userId) {
    return { ok: false, response: v2Error('UNAUTHORIZED', auth.error || 'Unauthorized') }
  }

  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId,
    userId: auth.userId,
    action,
  })
  if (!authorization.allowed || !authorization.workflow) {
    return { ok: false, response: v2Error('NOT_FOUND', 'Workflow not found') }
  }
  const workflow = authorization.workflow as WorkflowRecord

  if (auth.keyType === 'workspace' && workflow.workspaceId !== auth.workspaceId) {
    return { ok: false, response: v2Error('NOT_FOUND', 'Workflow not found') }
  }
  if (auth.keyType === 'personal' && workflow.workspaceId) {
    const settings = await getWorkspaceBillingSettings(workflow.workspaceId)
    if (!settings?.allowPersonalApiKeys) {
      return {
        ok: false,
        response: v2Error('FORBIDDEN', 'Personal API keys are not allowed for this workspace'),
      }
    }
  }

  return { ok: true, userId: auth.userId, keyType: auth.keyType, workflow }
}
