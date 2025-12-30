import { db, workflow, workflowDeploymentVersion } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, desc, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { hasWorkflowChanged } from '@/lib/workflows/comparison'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
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

    let needsRedeployment = false

    if (validation.workflow.isDeployed) {
      const normalizedData = await loadWorkflowFromNormalizedTables(id)

      if (!normalizedData) {
        return createSuccessResponse({
          isDeployed: validation.workflow.isDeployed,
          deployedAt: validation.workflow.deployedAt,
          isPublished: validation.workflow.isPublished,
          needsRedeployment: false,
        })
      }

      const [workflowRecord] = await db
        .select({ variables: workflow.variables })
        .from(workflow)
        .where(eq(workflow.id, id))
        .limit(1)

      const currentState = {
        blocks: normalizedData.blocks,
        edges: normalizedData.edges,
        loops: normalizedData.loops,
        parallels: normalizedData.parallels,
        variables: workflowRecord?.variables || {},
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
      isPublished: validation.workflow.isPublished,
      needsRedeployment,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error getting status for workflow: ${(await params).id}`, error)
    return createErrorResponse('Failed to get status', 500)
  }
}
