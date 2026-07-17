import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import type { getWorkflowById } from '@/lib/workflows/utils'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import { listAccessibleWorkspaceRowsForUser } from '@/lib/workspaces/utils'

type WorkflowRecord = NonNullable<Awaited<ReturnType<typeof getWorkflowById>>>

export async function ensureWorkflowAccess(
  workflowId: string,
  userId: string,
  action: 'read' | 'write' | 'admin' = 'read'
): Promise<{
  workflow: WorkflowRecord
  workspaceId?: string | null
}> {
  const result = await authorizeWorkflowByWorkspacePermission({
    workflowId,
    userId,
    action,
  })

  if (!result.workflow) {
    throw new Error(`Workflow ${workflowId} not found`)
  }

  if (!result.allowed) {
    throw new Error(result.message || 'Unauthorized workflow access')
  }

  return { workflow: result.workflow, workspaceId: result.workflow.workspaceId }
}

export async function getDefaultWorkspaceId(userId: string): Promise<string> {
  const accessibleRows = await listAccessibleWorkspaceRowsForUser(userId)
  const mostRecent = accessibleRows
    .map((row) => row.workspace)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]

  if (!mostRecent) {
    throw new Error('No workspace found for user')
  }

  return mostRecent.id
}

export async function ensureWorkspaceAccess(
  workspaceId: string,
  userId: string,
  level: 'read' | 'write' | 'admin' = 'read'
): Promise<void> {
  const access = await checkWorkspaceAccess(workspaceId, userId)
  if (!access.exists || !access.hasAccess) {
    throw new Error(`Workspace ${workspaceId} not found`)
  }

  if (level === 'read') return

  if (level === 'admin') {
    if (!access.canAdmin) {
      throw new Error('Admin access required for this workspace')
    }
    return
  }

  if (!access.canWrite) {
    throw new Error('Write or admin access required for this workspace')
  }
}
