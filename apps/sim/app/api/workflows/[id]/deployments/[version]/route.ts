import { db, workflowDeploymentVersion } from '@sim/db'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowDeploymentVersionAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> }
) {
  const requestId = generateRequestId()
  const { id, version } = await params

  try {
    // Validate permissions and get workflow data
    const { error } = await validateWorkflowPermissions(id, requestId, 'read')
    if (error) {
      return createErrorResponse(error.message, error.status)
    }

    const versionNum = Number(version)
    if (!Number.isFinite(versionNum)) {
      return createErrorResponse('Invalid version', 400)
    }

    const [row] = await db
      .select({ state: workflowDeploymentVersion.state })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, id),
          eq(workflowDeploymentVersion.version, versionNum)
        )
      )
      .limit(1)

    if (!row?.state) {
      return createErrorResponse('Deployment version not found', 404)
    }

    return createSuccessResponse({ deployedState: row.state })
  } catch (error: any) {
    logger.error(
      `[${requestId}] Error fetching deployment version ${version} for workflow ${id}`,
      error
    )
    return createErrorResponse(error.message || 'Failed to fetch deployment version', 500)
  }
}
