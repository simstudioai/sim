import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { v2GetWorkspaceContract } from '@/lib/api/contracts/v2/workspaces'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2WorkspacesAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteContext {
  params: Promise<{ workspaceId: string }>
}

/** GET /api/v2/workspaces/[workspaceId] — Resolve a workspace id to its name. */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'workspace')
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

    const [row] = await db
      .select({
        id: workspace.id,
        name: workspace.name,
        color: workspace.color,
        logoUrl: workspace.logoUrl,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    if (!row) return v2Error('NOT_FOUND', 'Workspace not found')

    return v2Data(
      {
        workspace: {
          id: row.id,
          name: row.name,
          color: row.color,
          logoUrl: row.logoUrl,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        },
      },
      { rateLimit }
    )
  } catch (error) {
    logger.error(`[${requestId}] Error fetching workspace`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
