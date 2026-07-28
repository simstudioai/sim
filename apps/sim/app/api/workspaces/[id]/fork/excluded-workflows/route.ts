import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { updateForkExcludedWorkflowsContract } from '@/lib/api/contracts/workspace-fork'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { assertWorkspaceAdminAccess } from '@/ee/workspace-forking/lib/lineage/authz'

const logger = createLogger('ForkExcludedWorkflowsAPI')

/** Workflow names carried on the audit entry - bounds the row for very large batches. */
const AUDIT_NAME_LIMIT = 20

/**
 * Toggle "Exclude from sync" for a batch of the workspace's workflows. An excluded
 * workflow never leaves its workspace (promote in either direction, new-fork copies),
 * is never overwritten or archived as a sync target, and keeps its identity mapping
 * so re-including it resumes replace-mode. Admin-only, matching the sync operations
 * the flag governs. Ids outside the workspace, archived workflows, and workflows
 * already at the requested value are skipped, so `updated` counts real transitions.
 */
export const PUT = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(updateForkExcludedWorkflowsContract, req, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId } = parsed.data.params
    const { workflowIds, forkSyncExcluded } = parsed.data.body

    const adminWorkspace = await assertWorkspaceAdminAccess(workspaceId, session.user.id)

    const updatedRows = await db
      .update(workflow)
      .set({ forkSyncExcluded, updatedAt: new Date() })
      .where(
        and(
          inArray(workflow.id, workflowIds),
          eq(workflow.workspaceId, workspaceId),
          isNull(workflow.archivedAt),
          ne(workflow.forkSyncExcluded, forkSyncExcluded)
        )
      )
      .returning({ id: workflow.id, name: workflow.name })

    if (updatedRows.length > 0) {
      recordAudit({
        workspaceId,
        actorId: session.user.id,
        action: forkSyncExcluded
          ? AuditAction.WORKFLOW_FORK_SYNC_EXCLUDED
          : AuditAction.WORKFLOW_FORK_SYNC_INCLUDED,
        resourceType: AuditResourceType.WORKSPACE,
        resourceId: workspaceId,
        resourceName: adminWorkspace.name,
        description: `${forkSyncExcluded ? 'Excluded' : 'Included'} ${updatedRows.length} workflow(s) ${forkSyncExcluded ? 'from' : 'in'} fork sync`,
        metadata: {
          forkSyncExcluded,
          workflowCount: updatedRows.length,
          workflowNames: updatedRows.slice(0, AUDIT_NAME_LIMIT).map((row) => row.name),
        },
      })

      captureServerEvent(
        session.user.id,
        'fork_excluded_workflows_updated',
        {
          workspace_id: workspaceId,
          workflow_count: updatedRows.length,
          fork_sync_excluded: forkSyncExcluded,
        },
        { groups: { workspace: workspaceId } }
      )
    }

    logger.info('Updated fork-sync exclusion', {
      workspaceId,
      requested: workflowIds.length,
      updated: updatedRows.length,
      forkSyncExcluded,
    })

    return NextResponse.json({ updated: updatedRows.length })
  }
)
