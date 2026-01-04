import { db, workflow } from '@sim/db'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import {
  deployWorkflow,
  loadWorkflowFromNormalizedTables,
  undeployWorkflow,
} from '@/lib/workflows/persistence/utils'
import { createSchedulesForDeploy, validateWorkflowSchedules } from '@/lib/workflows/schedules'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import type { AdminDeployResult, AdminUndeployResult } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminWorkflowDeployAPI')

const ADMIN_ACTOR_ID = 'admin-api'

interface RouteParams {
  id: string
}

export const POST = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: workflowId } = await context.params

  try {
    const [workflowRecord] = await db
      .select({ id: workflow.id, name: workflow.name })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowRecord) {
      return notFoundResponse('Workflow')
    }

    const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)
    if (!normalizedData) {
      return badRequestResponse('Workflow has no saved state')
    }

    const scheduleValidation = validateWorkflowSchedules(normalizedData.blocks)
    if (!scheduleValidation.isValid) {
      return badRequestResponse(`Invalid schedule configuration: ${scheduleValidation.error}`)
    }

    const deployResult = await deployWorkflow({
      workflowId,
      deployedBy: ADMIN_ACTOR_ID,
      workflowName: workflowRecord.name,
    })

    if (!deployResult.success) {
      return internalErrorResponse(deployResult.error || 'Failed to deploy workflow')
    }

    const scheduleResult = await createSchedulesForDeploy(workflowId, normalizedData.blocks, db)
    if (!scheduleResult.success) {
      logger.warn(`Schedule creation failed for workflow ${workflowId}: ${scheduleResult.error}`)
    }

    logger.info(`Admin API: Deployed workflow ${workflowId} as v${deployResult.version}`)

    const response: AdminDeployResult = {
      isDeployed: true,
      version: deployResult.version!,
      deployedAt: deployResult.deployedAt!.toISOString(),
    }

    return singleResponse(response)
  } catch (error) {
    logger.error(`Admin API: Failed to deploy workflow ${workflowId}`, { error })
    return internalErrorResponse('Failed to deploy workflow')
  }
})

export const DELETE = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: workflowId } = await context.params

  try {
    const [workflowRecord] = await db
      .select({ id: workflow.id })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowRecord) {
      return notFoundResponse('Workflow')
    }

    const result = await undeployWorkflow({ workflowId })
    if (!result.success) {
      return internalErrorResponse(result.error || 'Failed to undeploy workflow')
    }

    logger.info(`Admin API: Undeployed workflow ${workflowId}`)

    const response: AdminUndeployResult = {
      isDeployed: false,
    }

    return singleResponse(response)
  } catch (error) {
    logger.error(`Admin API: Failed to undeploy workflow ${workflowId}`, { error })
    return internalErrorResponse('Failed to undeploy workflow')
  }
})
