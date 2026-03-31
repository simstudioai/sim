import { db, workflowDeploymentVersion } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { performActivateVersion } from '@/lib/workflows/orchestration'
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
      .max(2000, 'Description must be 2000 characters or less')
      .nullable()
      .optional(),
    isActive: z.literal(true).optional(), // Set to true to activate this version
  })
  .refine(
    (data) => data.name !== undefined || data.description !== undefined || data.isActive === true,
    {
      message: 'At least one of name, description, or isActive must be provided',
    }
  )

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
    const body = await request.json()
    const validation = patchBodySchema.safeParse(body)

    if (!validation.success) {
      return createErrorResponse(validation.error.errors[0]?.message || 'Invalid request body', 400)
    }

    const { name, description, isActive } = validation.data

    // Activation requires admin permission, other updates require write
    const requiredPermission = isActive ? 'admin' : 'write'
    const {
      error,
      session,
      workflow: workflowData,
    } = await validateWorkflowPermissions(id, requestId, requiredPermission)
    if (error) {
      return createErrorResponse(error.message, error.status)
    }

    const versionNum = Number(version)
    if (!Number.isFinite(versionNum)) {
      return createErrorResponse('Invalid version', 400)
    }

    // Handle activation
    if (isActive) {
      const actorUserId = session?.user?.id
      if (!actorUserId) {
        logger.warn(`[${requestId}] Unable to resolve actor user for deployment activation: ${id}`)
        return createErrorResponse('Unable to determine activating user', 400)
      }

      const activateResult = await performActivateVersion({
        workflowId: id,
        version: versionNum,
        userId: actorUserId,
        workflow: workflowData as Record<string, unknown>,
        requestId,
        request,
      })

      if (!activateResult.success) {
        const status =
          activateResult.errorCode === 'not_found'
            ? 404
            : activateResult.errorCode === 'validation'
              ? 400
              : 500
        return createErrorResponse(activateResult.error || 'Failed to activate deployment', status)
      }

      let updatedName: string | null | undefined
      let updatedDescription: string | null | undefined
      if (name !== undefined || description !== undefined) {
        const activationUpdateData: { name?: string; description?: string | null } = {}
        if (name !== undefined) {
          activationUpdateData.name = name
        }
        if (description !== undefined) {
          activationUpdateData.description = description
        }

        const [updated] = await db
          .update(workflowDeploymentVersion)
          .set(activationUpdateData)
          .where(
            and(
              eq(workflowDeploymentVersion.workflowId, id),
              eq(workflowDeploymentVersion.version, versionNum)
            )
          )
          .returning({
            name: workflowDeploymentVersion.name,
            description: workflowDeploymentVersion.description,
          })

        if (updated) {
          updatedName = updated.name
          updatedDescription = updated.description
          logger.info(
            `[${requestId}] Updated deployment version ${version} metadata during activation`,
            { name: activationUpdateData.name, description: activationUpdateData.description }
          )
        }
      }

      return createSuccessResponse({
        success: true,
        deployedAt: activateResult.deployedAt,
        warnings: activateResult.warnings,
        ...(updatedName !== undefined && { name: updatedName }),
        ...(updatedDescription !== undefined && { description: updatedDescription }),
      })
    }

    // Handle name/description updates
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
