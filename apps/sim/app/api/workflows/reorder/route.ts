import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  assertFolderMutable,
  assertWorkflowMutable,
  FolderLockedError,
  WorkflowLockedError,
} from '@sim/workflow-authz'
import { eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { reorderWorkflowsContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkflowReorderAPI')

export const PUT = withRouteHandler(async (req: NextRequest) => {
  const requestId = generateRequestId()
  const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized reorder attempt`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = auth.userId

  try {
    const parsed = await parseRequest(reorderWorkflowsContract, req, {})
    if (!parsed.success) return parsed.response
    const { workspaceId, updates } = parsed.data.body

    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!permission || permission === 'read') {
      logger.warn(
        `[${requestId}] User ${userId} lacks write permission for workspace ${workspaceId}`
      )
      return NextResponse.json({ error: 'Write access required' }, { status: 403 })
    }

    const workflowIds = updates.map((u) => u.id)
    const existingWorkflows = await db
      .select({ id: workflow.id, workspaceId: workflow.workspaceId })
      .from(workflow)
      .where(inArray(workflow.id, workflowIds))

    const validIds = new Set(
      existingWorkflows.filter((w) => w.workspaceId === workspaceId).map((w) => w.id)
    )

    const validUpdates = updates.filter((u) => validIds.has(u.id))

    if (validUpdates.length === 0) {
      return NextResponse.json({ error: 'No valid workflows to update' }, { status: 400 })
    }

    for (const update of validUpdates) {
      await assertWorkflowMutable(update.id)
      if (update.folderId !== undefined) {
        await assertFolderMutable(update.folderId)
      }
    }

    await db.transaction(async (tx) => {
      for (const update of validUpdates) {
        const updateData: Record<string, unknown> = {
          sortOrder: update.sortOrder,
          updatedAt: new Date(),
        }
        if (update.folderId !== undefined) {
          updateData.folderId = update.folderId
        }
        await tx.update(workflow).set(updateData).where(eq(workflow.id, update.id))
      }
    })

    logger.info(
      `[${requestId}] Reordered ${validUpdates.length} workflows in workspace ${workspaceId}`
    )

    return NextResponse.json({ success: true, updated: validUpdates.length })
  } catch (error) {
    if (error instanceof WorkflowLockedError || error instanceof FolderLockedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    logger.error(`[${requestId}] Error reordering workflows`, error)
    return NextResponse.json({ error: 'Failed to reorder workflows' }, { status: 500 })
  }
})
