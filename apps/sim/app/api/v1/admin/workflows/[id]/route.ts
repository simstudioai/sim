/**
 * GET /api/v1/admin/workflows/[id]
 *
 * Get workflow details including block and edge counts.
 *
 * Response: AdminSingleResponse<AdminWorkflowDetail>
 *
 * DELETE /api/v1/admin/workflows/[id]
 *
 * Delete a workflow and all its associated data.
 *
 * Response: { success: true, workflowId: string }
 */

import { db } from '@sim/db'
import { workflowBlocks, workflowEdges } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getActiveWorkflowRecord } from '@sim/workflow-authz'
import { count, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performDeleteWorkflow } from '@/lib/workflows/orchestration'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import { type AdminWorkflowDetail, toAdminWorkflow } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminWorkflowDetailAPI')

interface RouteParams {
  id: string
}

export const GET = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const { id: workflowId } = await context.params

    try {
      const workflowData = await getActiveWorkflowRecord(workflowId)

      if (!workflowData) {
        return notFoundResponse('Workflow')
      }

      const [blockCountResult, edgeCountResult] = await Promise.all([
        db
          .select({ count: count() })
          .from(workflowBlocks)
          .where(eq(workflowBlocks.workflowId, workflowId)),
        db
          .select({ count: count() })
          .from(workflowEdges)
          .where(eq(workflowEdges.workflowId, workflowId)),
      ])

      const data: AdminWorkflowDetail = {
        ...toAdminWorkflow(workflowData),
        blockCount: blockCountResult[0].count,
        edgeCount: edgeCountResult[0].count,
      }

      logger.info(`Admin API: Retrieved workflow ${workflowId}`)

      return singleResponse(data)
    } catch (error) {
      logger.error('Admin API: Failed to get workflow', { error, workflowId })
      return internalErrorResponse('Failed to get workflow')
    }
  })
)

export const DELETE = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (_request, context) => {
    const { id: workflowId } = await context.params

    try {
      const workflowData = await getActiveWorkflowRecord(workflowId)

      if (!workflowData) {
        return notFoundResponse('Workflow')
      }

      const result = await performDeleteWorkflow({
        workflowId,
        userId: workflowData.userId,
        skipLastWorkflowGuard: true,
        requestId: `admin-workflow-${workflowId}`,
        actorId: 'admin-api',
      })

      if (!result.success) {
        return internalErrorResponse(result.error || 'Failed to delete workflow')
      }

      logger.info(`Admin API: Deleted workflow ${workflowId} (${workflowData.name})`)

      return NextResponse.json({ success: true, workflowId })
    } catch (error) {
      logger.error('Admin API: Failed to delete workflow', { error, workflowId })
      return internalErrorResponse('Failed to delete workflow')
    }
  })
)
