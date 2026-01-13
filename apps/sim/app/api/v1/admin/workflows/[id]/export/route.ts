/**
 * GET /api/v1/admin/workflows/[id]/export
 *
 * Export a single workflow as JSON (raw, unsanitized for admin backup/restore).
 *
 * Response: AdminSingleResponse<WorkflowExportPayload>
 */

import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import {
  parseWorkflowVariables,
  type WorkflowExportPayload,
  type WorkflowExportState,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminWorkflowExportAPI')

interface RouteParams {
  id: string
}

export const GET = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: workflowId } = await context.params

  try {
    const [workflowData] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowData) {
      return notFoundResponse('Workflow')
    }

    const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)

    if (!normalizedData) {
      return notFoundResponse('Workflow state')
    }

    const variables = parseWorkflowVariables(workflowData.variables)

    const state: WorkflowExportState = {
      blocks: normalizedData.blocks,
      edges: normalizedData.edges,
      loops: normalizedData.loops,
      parallels: normalizedData.parallels,
      metadata: {
        name: workflowData.name,
        description: workflowData.description ?? undefined,
        color: workflowData.color,
        exportedAt: new Date().toISOString(),
      },
      variables,
    }

    const exportPayload: WorkflowExportPayload = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      workflow: {
        id: workflowData.id,
        name: workflowData.name,
        description: workflowData.description,
        color: workflowData.color,
        workspaceId: workflowData.workspaceId,
        folderId: workflowData.folderId,
      },
      state,
    }

    logger.info(`Admin API: Exported workflow ${workflowId}`)

    return singleResponse(exportPayload)
  } catch (error) {
    logger.error('Admin API: Failed to export workflow', { error, workflowId })
    return internalErrorResponse('Failed to export workflow')
  }
})
