import { db, workflowDeploymentVersion } from '@sim/db'
import { and, desc, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { hasWorkflowChanged } from '@/lib/workflows/utils'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowStatusAPI')

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()

  try {
    const { id } = await params

    const validation = await validateWorkflowAccess(request, id, false)
    if (validation.error) {
      logger.warn(`[${requestId}] Workflow access validation failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    // Check if the workflow has meaningful changes that would require redeployment
    let needsRedeployment = false

    if (validation.workflow.isDeployed) {
      // Get current state from normalized tables (same logic as deployment API)
      // Load current state from normalized tables using centralized helper
      const normalizedData = await loadWorkflowFromNormalizedTables(id)

      if (!normalizedData) {
        // Workflow exists but has no blocks in normalized tables (empty workflow or not migrated)
        // This is valid state - return success with no redeployment needed
        return createSuccessResponse({
          isDeployed: validation.workflow.isDeployed,
          deployedAt: validation.workflow.deployedAt,
          isPublished: validation.workflow.isPublished,
          needsRedeployment: false,
        })
      }

      const currentState = {
        blocks: normalizedData.blocks,
        edges: normalizedData.edges,
        loops: normalizedData.loops,
        parallels: normalizedData.parallels,
        lastSaved: Date.now(),
      }

      const [active] = await db
        .select({ state: workflowDeploymentVersion.state })
        .from(workflowDeploymentVersion)
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, id),
            eq(workflowDeploymentVersion.isActive, true)
          )
        )
        .orderBy(desc(workflowDeploymentVersion.createdAt))
        .limit(1)

      if (active?.state) {
        needsRedeployment = hasWorkflowChanged(currentState as any, active.state as any)
      }
    }

    return createSuccessResponse({
      isDeployed: validation.workflow.isDeployed,
      deployedAt: validation.workflow.deployedAt,
      needsRedeployment,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error getting status for workflow: ${(await params).id}`, error)
    return createErrorResponse('Failed to get status', 500)
  }
}
