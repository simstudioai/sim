import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import type { NextRequest, NextResponse } from 'next/server'
import { getDeployedWorkflowStateContract } from '@/lib/api/contracts/deployments'
import { parseRequest } from '@/lib/api/server'
import { verifyInternalToken } from '@/lib/auth/internal'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowDeployedStateAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function addNoCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  return response
}

/**
 * GET /api/workflows/[id]/deployed
 * Returns the active deployed state snapshot for a workflow.
 *
 * Internal (server-to-server) calls must carry the acting user in the internal
 * JWT payload (`generateInternalToken(userId)` — the executor's
 * `buildAuthHeaders(ctx.userId)` always embeds it) and are authorized as that
 * user with the same workspace-read semantics as the sibling
 * `/api/workflows/[id]` route. Internal calls without a user id are rejected
 * (fail closed). Session calls are authorized via
 * `validateWorkflowPermissions` as before.
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const parsed = await parseRequest(getDeployedWorkflowStateContract, request, context)
    if (!parsed.success) return parsed.response
    const { id } = parsed.data.params

    try {
      const authHeader = request.headers.get('authorization')
      let isInternalCall = false
      let internalCallUserId: string | undefined

      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1]
        const verification = await verifyInternalToken(token)
        isInternalCall = verification.valid
        internalCallUserId = verification.userId
      }

      if (isInternalCall) {
        if (!internalCallUserId) {
          logger.warn(`[${requestId}] Internal call without acting user denied for workflow ${id}`)
          return addNoCacheHeaders(createErrorResponse('Forbidden', 403))
        }

        const authorization = await authorizeWorkflowByWorkspacePermission({
          workflowId: id,
          userId: internalCallUserId,
          action: 'read',
        })
        if (!authorization.workflow) {
          logger.warn(`[${requestId}] Workflow ${id} not found for internal call`)
          return addNoCacheHeaders(createErrorResponse('Workflow not found', 404))
        }
        if (!authorization.allowed) {
          logger.warn(
            `[${requestId}] Internal call user ${internalCallUserId} denied read access to workflow ${id}`
          )
          return addNoCacheHeaders(
            createErrorResponse(authorization.message || 'Access denied', authorization.status)
          )
        }
      } else {
        const { error } = await validateWorkflowPermissions(id, requestId, 'read')
        if (error) {
          const response = createErrorResponse(error.message, error.status)
          return addNoCacheHeaders(response)
        }
      }

      let deployedState = null
      try {
        const data = await loadDeployedWorkflowState(id)
        deployedState = {
          blocks: data.blocks,
          edges: data.edges,
          loops: data.loops,
          parallels: data.parallels,
          variables: data.variables,
        }
      } catch (error) {
        logger.warn(`[${requestId}] Failed to load deployed state for workflow ${id}`, { error })
        deployedState = null
      }

      const response = createSuccessResponse({ deployedState })
      return addNoCacheHeaders(response)
    } catch (error: any) {
      logger.error(`[${requestId}] Error fetching deployed state: ${id}`, error)
      const response = createErrorResponse(error.message || 'Failed to fetch deployed state', 500)
      return addNoCacheHeaders(response)
    }
  }
)
