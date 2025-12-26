/**
 * GET /api/v1/admin/workspaces/[id]
 *
 * Get workspace details including workflow and folder counts.
 *
 * Response: AdminSingleResponse<AdminWorkspaceDetail>
 */

import { db } from '@sim/db'
import { workflow, workflowFolder, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { count, eq } from 'drizzle-orm'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import { type AdminWorkspaceDetail, toAdminWorkspace } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminWorkspaceDetailAPI')

interface RouteParams {
  id: string
}

export const GET = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: workspaceId } = await context.params

  try {
    const [workspaceData] = await db
      .select()
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    if (!workspaceData) {
      return notFoundResponse('Workspace')
    }

    const [workflowCountResult, folderCountResult] = await Promise.all([
      db.select({ count: count() }).from(workflow).where(eq(workflow.workspaceId, workspaceId)),
      db
        .select({ count: count() })
        .from(workflowFolder)
        .where(eq(workflowFolder.workspaceId, workspaceId)),
    ])

    const data: AdminWorkspaceDetail = {
      ...toAdminWorkspace(workspaceData),
      workflowCount: workflowCountResult[0].count,
      folderCount: folderCountResult[0].count,
    }

    logger.info(`Admin API: Retrieved workspace ${workspaceId}`)

    return singleResponse(data)
  } catch (error) {
    logger.error('Admin API: Failed to get workspace', { error, workspaceId })
    return internalErrorResponse('Failed to get workspace')
  }
})
