import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type V1ImportWorkflowData,
  v1ImportWorkflowContract,
} from '@/lib/api/contracts/v1/workflows'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  importWorkflowIntoWorkspace,
  MAX_IMPORT_BODY_BYTES,
} from '@/lib/workflows/operations/import-workflow'
import { createApiResponse, getUserLimits } from '@/app/api/v1/logs/meta'
import {
  checkRateLimit,
  createRateLimitResponse,
  v1ValidationErrorResponse,
  validateWorkspaceAccess,
} from '@/app/api/v1/middleware'

const logger = createLogger('V1WorkflowImportAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/v1/workflows/import
 *
 * Creates a new workflow in the target workspace from an export payload
 * produced by `GET /api/v1/workflows/{id}/export`. The shared
 * {@link importWorkflowIntoWorkspace} pipeline does the heavy lifting; this
 * route authenticates and renders the v1 envelope.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const rateLimit = await checkRateLimit(request, 'workflow-import')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const parsed = await parseRequest(
      v1ImportWorkflowContract,
      request,
      {},
      {
        maxBodyBytes: MAX_IMPORT_BODY_BYTES,
        validationErrorResponse: (error) =>
          v1ValidationErrorResponse(error, 'Invalid request body'),
      }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, folderId, name, description } = parsed.data.body

    logger.info(`[${requestId}] Importing workflow into workspace ${workspaceId}`, {
      userId,
      folderId,
    })

    const accessError = await validateWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (accessError) return accessError

    const result = await importWorkflowIntoWorkspace({
      workspaceId,
      folderId,
      name,
      description,
      workflow: parsed.data.body.workflow,
      userId,
      requestId,
    })

    if (!result.success) {
      return NextResponse.json(
        { error: result.error, ...(result.details !== undefined && { details: result.details }) },
        { status: result.status }
      )
    }

    const data: V1ImportWorkflowData = {
      id: result.workflow.id,
      name: result.workflow.name,
      description: result.workflow.description,
      workspaceId: result.workflow.workspaceId,
      folderId: result.workflow.folderId,
      createdAt: result.workflow.createdAt.toISOString(),
      updatedAt: result.workflow.updatedAt.toISOString(),
    }

    const limits = await getUserLimits(userId)
    const apiResponse = createApiResponse({ data }, limits, rateLimit)

    return NextResponse.json(apiResponse.body, { status: 201, headers: apiResponse.headers })
  } catch (error: unknown) {
    const message = getErrorMessage(error, 'Unknown error')
    logger.error(`[${requestId}] Workflow import error`, { error: message })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
