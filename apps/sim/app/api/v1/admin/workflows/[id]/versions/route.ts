import { db, workflow } from '@sim/db'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { listWorkflowVersions } from '@/lib/workflows/persistence/utils'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import type { AdminDeploymentVersion } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminWorkflowVersionsAPI')

interface RouteParams {
  id: string
}

export const GET = withAdminAuthParams<RouteParams>(async (request, context) => {
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

    const { versions } = await listWorkflowVersions(workflowId)

    const response: AdminDeploymentVersion[] = versions.map((v) => ({
      id: v.id,
      version: v.version,
      name: v.name,
      isActive: v.isActive,
      createdAt: v.createdAt.toISOString(),
      createdBy: v.createdBy,
      deployedByName: v.deployedByName ?? (v.createdBy === 'admin-api' ? 'Admin' : null),
    }))

    logger.info(`Admin API: Listed ${versions.length} versions for workflow ${workflowId}`)

    return singleResponse({ versions: response })
  } catch (error) {
    logger.error(`Admin API: Failed to list versions for workflow ${workflowId}`, { error })
    return internalErrorResponse('Failed to list deployment versions')
  }
})
