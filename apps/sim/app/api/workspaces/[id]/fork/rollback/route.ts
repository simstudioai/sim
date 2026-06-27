import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { rollbackForkContract } from '@/lib/api/contracts/workspace-fork'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { recordBackgroundWork } from '@/lib/workspaces/fork/background-work/store'
import { assertCanRollback } from '@/lib/workspaces/fork/lineage/authz'
import { rollbackFork } from '@/lib/workspaces/fork/promote/rollback'

const logger = createLogger('WorkspaceForkRollbackAPI')

export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(rollbackForkContract, req, context)
    if (!parsed.success) return parsed.response
    const { id } = parsed.data.params
    const { otherWorkspaceId } = parsed.data.body

    const target = await assertCanRollback(id, session.user.id)

    const result = await rollbackFork({
      targetWorkspaceId: id,
      otherWorkspaceId,
      userId: session.user.id,
      requestId,
    })

    recordAudit({
      workspaceId: id,
      actorId: session.user.id,
      action: AuditAction.WORKSPACE_FORK_ROLLED_BACK,
      resourceType: AuditResourceType.WORKSPACE,
      resourceId: id,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      resourceName: target.name,
      description: `Rolled back the last promote into "${target.name}"`,
      metadata: { otherWorkspaceId, ...result },
      request: req,
    })

    // Durable audit entry scoped to this workspace so the undo shows in its Manage Forks
    // → Activity log. Non-critical: a failure must not fail the (committed) rollback.
    const [other] = await db
      .select({ name: workspace.name })
      .from(workspace)
      .where(eq(workspace.id, otherWorkspaceId))
      .limit(1)
    const otherName = other?.name ?? 'the source workspace'
    await recordBackgroundWork(db, {
      workspaceId: id,
      kind: 'fork_rollback',
      status: result.skipped > 0 ? 'completed_with_warnings' : 'completed',
      message: `Undid the last sync from "${otherName}"`,
      metadata: {
        otherWorkspaceName: otherName,
        restored: result.restored,
        removed: result.archived,
        unarchived: result.unarchived,
        skipped: result.skipped,
      },
    }).catch((error) =>
      logger.error(`[${requestId}] Failed to record rollback activity`, {
        error: getErrorMessage(error),
      })
    )

    return NextResponse.json(result)
  }
)
