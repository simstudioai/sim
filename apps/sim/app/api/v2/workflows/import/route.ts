import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import { v2ImportWorkflowContract } from '@/lib/api/contracts/v2/workflows'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  importWorkflowIntoWorkspace,
  MAX_IMPORT_BODY_BYTES,
} from '@/lib/workflows/operations/import-workflow'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import {
  type V2ErrorCode,
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2WorkflowImportAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

const ERROR_CODE_BY_STATUS: Record<number, V2ErrorCode> = {
  400: 'BAD_REQUEST',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  423: 'LOCKED',
  500: 'INTERNAL_ERROR',
}

/**
 * POST /api/v2/workflows/import
 *
 * Creates a new workflow in the target workspace from an export payload
 * produced by `GET /api/v2/workflows/{id}/export`. The shared
 * {@link importWorkflowIntoWorkspace} pipeline does the heavy lifting; this
 * route authenticates and renders the v2 envelope.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const rateLimit = await checkRateLimit(request, 'workflow-import')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const parsed = await parseRequest(
      v2ImportWorkflowContract,
      request,
      {},
      {
        maxBodyBytes: MAX_IMPORT_BODY_BYTES,
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, folderId, name, description } = parsed.data.body

    logger.info(`[${requestId}] Importing workflow into workspace ${workspaceId}`, {
      userId,
      folderId,
    })

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

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
      return v2Error(ERROR_CODE_BY_STATUS[result.status] ?? 'INTERNAL_ERROR', result.error, {
        status: result.status,
        details: result.details,
      })
    }

    return v2Data(
      {
        id: result.workflow.id,
        name: result.workflow.name,
        description: result.workflow.description,
        workspaceId: result.workflow.workspaceId,
        folderId: result.workflow.folderId,
        createdAt: result.workflow.createdAt.toISOString(),
        updatedAt: result.workflow.updatedAt.toISOString(),
      },
      { rateLimit, status: 201 }
    )
  } catch (error) {
    logger.error(`[${requestId}] Workflow import error`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
