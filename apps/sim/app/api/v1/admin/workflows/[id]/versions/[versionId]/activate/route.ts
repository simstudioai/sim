import { db, workflow } from '@sim/db'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { activateWorkflowVersion } from '@/lib/workflows/persistence/utils'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminWorkflowActivateVersionAPI')

interface RouteParams {
  id: string
  versionId: string
}

export const POST = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: workflowId, versionId } = await context.params

  try {
    const [workflowRecord] = await db
      .select({ id: workflow.id })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowRecord) {
      return notFoundResponse('Workflow')
    }

    const versionNum = Number(versionId)
    if (!Number.isFinite(versionNum) || versionNum < 1) {
      return badRequestResponse('Invalid version number')
    }

    const result = await activateWorkflowVersion({ workflowId, version: versionNum })
    if (!result.success) {
      if (result.error === 'Deployment version not found') {
        return notFoundResponse('Deployment version')
      }
      return internalErrorResponse(result.error || 'Failed to activate version')
    }

    logger.info(`Admin API: Activated version ${versionNum} for workflow ${workflowId}`)

    return singleResponse({
      success: true,
      version: versionNum,
      deployedAt: result.deployedAt!.toISOString(),
    })
  } catch (error) {
    logger.error(`Admin API: Failed to activate version for workflow ${workflowId}`, { error })
    return internalErrorResponse('Failed to activate deployment version')
  }
})
