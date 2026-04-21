/**
 * GET /api/v1/admin/workspaces/[id]/workflows
 *
 * List all workflows in a workspace with pagination.
 *
 * Query Parameters:
 *   - limit: number (default: 50, max: 250)
 *   - offset: number (default: 0)
 *
 * Response: AdminListResponse<AdminWorkflow>
 *
 * DELETE /api/v1/admin/workspaces/[id]/workflows
 *
 * Delete all workflows in a workspace (clean slate for reimport).
 *
 * Response: { success: true, deleted: number }
 */

import { db } from '@sim/db'
import { workflow, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, eq, isNull } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { archiveWorkflowsForWorkspace } from '@/lib/workflows/lifecycle'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import { internalErrorResponse, listResponse, notFoundResponse } from '@/app/api/v1/admin/responses'
import {
  type AdminWorkflow,
  createPaginationMeta,
  parsePaginationParams,
  toAdminWorkflow,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminWorkspaceWorkflowsAPI')

interface RouteParams {
  id: string
}

export const GET = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const { id: workspaceId } = await context.params
    const url = new URL(request.url)
    const { limit, offset } = parsePaginationParams(url)

    try {
      const [workspaceData] = await db
        .select({ id: workspace.id })
        .from(workspace)
        .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
        .limit(1)

      if (!workspaceData) {
        return notFoundResponse('Workspace')
      }

      const [countResult, workflows] = await Promise.all([
        db
          .select({ total: count() })
          .from(workflow)
          .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt))),
        db
          .select()
          .from(workflow)
          .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt)))
          .orderBy(workflow.name)
          .limit(limit)
          .offset(offset),
      ])

      const total = countResult[0].total
      const data: AdminWorkflow[] = workflows.map(toAdminWorkflow)
      const pagination = createPaginationMeta(total, limit, offset)

      logger.info(
        `Admin API: Listed ${data.length} workflows in workspace ${workspaceId} (total: ${total})`
      )

      return listResponse(data, pagination)
    } catch (error) {
      logger.error('Admin API: Failed to list workspace workflows', { error, workspaceId })
      return internalErrorResponse('Failed to list workflows')
    }
  })
)

export const DELETE = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const { id: workspaceId } = await context.params

    try {
      const [workspaceData] = await db
        .select({ id: workspace.id })
        .from(workspace)
        .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
        .limit(1)

      if (!workspaceData) {
        return notFoundResponse('Workspace')
      }

      const workflowsToDelete = await db
        .select({ id: workflow.id })
        .from(workflow)
        .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt)))

      if (workflowsToDelete.length === 0) {
        return NextResponse.json({ success: true, deleted: 0 })
      }

      const deletedCount = await archiveWorkflowsForWorkspace(workspaceId, {
        requestId: `admin-workspace-${workspaceId}`,
      })

      logger.info(`Admin API: Deleted ${deletedCount} workflows from workspace ${workspaceId}`)

      return NextResponse.json({ success: true, deleted: deletedCount })
    } catch (error) {
      logger.error('Admin API: Failed to delete workspace workflows', { error, workspaceId })
      return internalErrorResponse('Failed to delete workflows')
    }
  })
)
