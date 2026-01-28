import { db, workflowDeploymentVersion } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowDeploymentVersionAPI')

const patchBodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name cannot be empty')
      .max(100, 'Name must be 100 characters or less')
      .optional(),
    description: z
      .string()
      .trim()
      .max(500, 'Description must be 500 characters or less')
      .nullable()
      .optional(),
  })
  .refine((data) => data.name !== undefined || data.description !== undefined, {
    message: 'At least one of name or description must be provided',
  })

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
    const validation = patchBodySchema.safeParse(body)

    if (!validation.success) {
      return createErrorResponse(validation.error.errors[0]?.message || 'Invalid request body', 400)
    }

    const { name, description } = validation.data

    const updateData: { name?: string; description?: string | null } = {}
    if (name !== undefined) {
      updateData.name = name
    }
    if (description !== undefined) {
      updateData.description = description
    }

    const [updated] = await db
      .update(workflowDeploymentVersion)
      .set(updateData)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, id),
          eq(workflowDeploymentVersion.version, versionNum)
        )
      )
      .returning({
        id: workflowDeploymentVersion.id,
        name: workflowDeploymentVersion.name,
        description: workflowDeploymentVersion.description,
      })

    if (!updated) {
      return createErrorResponse('Deployment version not found', 404)
    }

    logger.info(`[${requestId}] Updated deployment version ${version} for workflow ${id}`, {
      name: updateData.name,
      description: updateData.description,
    })

    return createSuccessResponse({ name: updated.name, description: updated.description })
  } catch (error: any) {
    logger.error(
      `[${requestId}] Error updating deployment version ${version} for workflow ${id}`,
      error
    )
    return createErrorResponse(error.message || 'Failed to update deployment version', 500)
  }
}
