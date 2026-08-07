import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { eq } from 'drizzle-orm'
import type { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceBillingSettings } from '@/lib/workspaces/utils'
import { authenticateV2ApiKey } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import { v2Error } from '@/app/api/v2/lib/response'

type WorkflowRecord = typeof workflow.$inferSelect

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
  const auth = await authenticateV2ApiKey(request)
  if (!auth.authenticated) {
    return { ok: false, response: v2Error('UNAUTHORIZED', auth.error || 'Unauthorized') }
  }

  const gate =
    auth.keyType === 'workspace' && auth.billingAttribution.organizationId
      ? await v2ApiGateError(auth.actorUserId, auth.billingAttribution.organizationId)
      : await v2ApiGateError(auth.actorUserId)
  if (gate) return { ok: false, response: gate }

  let workflowRecord: WorkflowRecord
  if (auth.keyType === 'workspace') {
    const [row] = await db.select().from(workflow).where(eq(workflow.id, workflowId)).limit(1)
    if (!row || row.workspaceId !== auth.workspaceId) {
      return { ok: false, response: v2Error('NOT_FOUND', 'Workflow not found') }
    }
    workflowRecord = row
  } else {
    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId,
      userId: auth.principalUserId,
      action,
    })
    if (!authorization.allowed || !authorization.workflow) {
      return { ok: false, response: v2Error('NOT_FOUND', 'Workflow not found') }
    }
    workflowRecord = authorization.workflow as WorkflowRecord
  }
  if (auth.keyType === 'personal' && workflowRecord.workspaceId) {
    const settings = await getWorkspaceBillingSettings(workflowRecord.workspaceId)
    if (!settings?.allowPersonalApiKeys) {
      return {
        ok: false,
        response: v2Error('FORBIDDEN', 'Personal API keys are not allowed for this workspace'),
      }
    }
  }

  return {
    ok: true,
    userId: auth.actorUserId,
    keyType: auth.keyType,
    workflow: workflowRecord,
  }
}
