import { db } from '@sim/db'
import { workflowFolder } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { assertFolderMutable, FolderLockedError } from '@sim/workflow-authz'
import { eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { reorderFoldersContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('FolderReorderAPI')

export const PUT = withRouteHandler(async (req: NextRequest) => {
  const requestId = generateRequestId()
  const session = await getSession()

  if (!session?.user?.id) {
    logger.warn(`[${requestId}] Unauthorized folder reorder attempt`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(reorderFoldersContract, req, {})
    if (!parsed.success) return parsed.response
    const { workspaceId, updates } = parsed.data.body

    const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (!permission || permission === 'read') {
      logger.warn(
        `[${requestId}] User ${session.user.id} lacks write permission for workspace ${workspaceId}`
      )
      return NextResponse.json({ error: 'Write access required' }, { status: 403 })
    }

    const folderIds = updates.map((u) => u.id)
    const existingFolders = await db
      .select({ id: workflowFolder.id, workspaceId: workflowFolder.workspaceId })
      .from(workflowFolder)
      .where(inArray(workflowFolder.id, folderIds))

    const validIds = new Set(
      existingFolders.filter((f) => f.workspaceId === workspaceId).map((f) => f.id)
    )

    const validUpdates = updates.filter((u) => validIds.has(u.id))

    if (validUpdates.length === 0) {
      return NextResponse.json({ error: 'No valid folders to update' }, { status: 400 })
    }

    for (const update of validUpdates) {
      await assertFolderMutable(update.id)
      if (update.parentId !== undefined) {
        await assertFolderMutable(update.parentId)
      }
    }

    await db.transaction(async (tx) => {
      for (const update of validUpdates) {
        const updateData: Record<string, unknown> = {
          sortOrder: update.sortOrder,
          updatedAt: new Date(),
        }
        if (update.parentId !== undefined) {
          updateData.parentId = update.parentId
        }
        await tx.update(workflowFolder).set(updateData).where(eq(workflowFolder.id, update.id))
      }
    })

    logger.info(
      `[${requestId}] Reordered ${validUpdates.length} folders in workspace ${workspaceId}`
    )

    return NextResponse.json({ success: true, updated: validUpdates.length })
  } catch (error) {
    if (error instanceof FolderLockedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    logger.error(`[${requestId}] Error reordering folders`, error)
    return NextResponse.json({ error: 'Failed to reorder folders' }, { status: 500 })
  }
})
