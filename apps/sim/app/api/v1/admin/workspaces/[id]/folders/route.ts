/**
 * GET /api/v1/admin/workspaces/[id]/folders
 *
 * List all folders in a workspace with pagination.
 *
 * Query Parameters:
 *   - limit: number (default: 50, max: 250)
 *   - offset: number (default: 0)
 *
 * Response: AdminListResponse<AdminFolder>
 */

import { db } from '@sim/db'
import { workflowFolder, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { count, eq } from 'drizzle-orm'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import { internalErrorResponse, listResponse, notFoundResponse } from '@/app/api/v1/admin/responses'
import {
  type AdminFolder,
  createPaginationMeta,
  parsePaginationParams,
  toAdminFolder,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminWorkspaceFoldersAPI')

interface RouteParams {
  id: string
}

export const GET = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: workspaceId } = await context.params
  const url = new URL(request.url)
  const { limit, offset } = parsePaginationParams(url)

  try {
    const [workspaceData] = await db
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    if (!workspaceData) {
      return notFoundResponse('Workspace')
    }

    const [countResult, folders] = await Promise.all([
      db
        .select({ total: count() })
        .from(workflowFolder)
        .where(eq(workflowFolder.workspaceId, workspaceId)),
      db
        .select()
        .from(workflowFolder)
        .where(eq(workflowFolder.workspaceId, workspaceId))
        .orderBy(workflowFolder.sortOrder, workflowFolder.name)
        .limit(limit)
        .offset(offset),
    ])

    const total = countResult[0].total
    const data: AdminFolder[] = folders.map(toAdminFolder)
    const pagination = createPaginationMeta(total, limit, offset)

    logger.info(
      `Admin API: Listed ${data.length} folders in workspace ${workspaceId} (total: ${total})`
    )

    return listResponse(data, pagination)
  } catch (error) {
    logger.error('Admin API: Failed to list workspace folders', { error, workspaceId })
    return internalErrorResponse('Failed to list folders')
  }
})
