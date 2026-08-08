import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2GetWorkspaceContract } from '@/lib/api/contracts/v2/workspaces'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getPublicWorkspaceDetail } from '@/lib/workspaces/public-queries'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2WorkspaceDetailAPI')

interface WorkspaceRouteParams {
  params: Promise<{ workspaceId: string }>
}

/** GET /api/v2/workspaces/[workspaceId] — Public workspace metadata. */
export const GET = withRouteHandler(async (request: NextRequest, context: WorkspaceRouteParams) => {
  try {
    const rateLimit = await checkRateLimit(request, 'workspaces')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)
    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2GetWorkspaceContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { workspaceId } = parsed.data.params
    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const workspace = await getPublicWorkspaceDetail(workspaceId)
    if (!workspace) return v2Error('NOT_FOUND', 'Workspace not found')

    return v2Data(
      {
        ...workspace,
        createdAt: workspace.createdAt.toISOString(),
        updatedAt: workspace.updatedAt.toISOString(),
      },
      { rateLimit }
    )
  } catch (error) {
    logger.error('Failed to get workspace', { error: getErrorMessage(error) })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
