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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> }
) {
  const requestId = generateRequestId()
  const { id, version } = await params

  try {
    const { error } = await validateWorkflowPermissions(id, requestId, 'write')
    if (error) {
      return createErrorResponse(error.message, error.status)
    }

    const versionNum = Number(version)
    if (!Number.isFinite(versionNum)) {
      return createErrorResponse('Invalid version', 400)
    }

    const body = await request.json()
    const { name } = body

    if (typeof name !== 'string') {
      return createErrorResponse('Name must be a string', 400)
    }

    const trimmedName = name.trim()
    if (trimmedName.length === 0) {
      return createErrorResponse('Name cannot be empty', 400)
    }

    if (trimmedName.length > 100) {
      return createErrorResponse('Name must be 100 characters or less', 400)
    }

    const [updated] = await db
      .update(workflowDeploymentVersion)
      .set({ name: trimmedName })
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, id),
          eq(workflowDeploymentVersion.version, versionNum)
        )
      )
      .returning({ id: workflowDeploymentVersion.id, name: workflowDeploymentVersion.name })

    if (!updated) {
      return createErrorResponse('Deployment version not found', 404)
    }

    logger.info(
      `[${requestId}] Renamed deployment version ${version} for workflow ${id} to "${trimmedName}"`
    )

    return createSuccessResponse({ name: updated.name })
  } catch (error: any) {
    logger.error(
      `[${requestId}] Error renaming deployment version ${version} for workflow ${id}`,
      error
    )
    return createErrorResponse(error.message || 'Failed to rename deployment version', 500)
  }
}
