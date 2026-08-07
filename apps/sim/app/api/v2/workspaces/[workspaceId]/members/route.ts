import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  v2ListWorkspaceMembersContract,
  v2WorkspaceMemberCursorSchema,
} from '@/lib/api/contracts/v2/workspaces'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { queryPublicWorkspaceMembers } from '@/lib/workspaces/public-queries'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  decodeCursor,
  encodeCursor,
  v2CursorList,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2WorkspaceMembersAPI')

interface WorkspaceMembersRouteParams {
  params: Promise<{ workspaceId: string }>
}

/** GET /api/v2/workspaces/[workspaceId]/members — Effective member roster. */
export const GET = withRouteHandler(
  async (request: NextRequest, context: WorkspaceMembersRouteParams) => {
    try {
      const rateLimit = await checkRateLimit(request, 'workspace-members')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)
      const userId = rateLimit.userId!

      const gate = await v2ApiGateError(userId)
      if (gate) return gate

      const parsed = await parseRequest(v2ListWorkspaceMembersContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      const { workspaceId } = parsed.data.params
      const { cursor, limit } = parsed.data.query
      const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
      if (access) return v2WorkspaceAccessError(access)

      const decoded = cursor
        ? v2WorkspaceMemberCursorSchema.safeParse(decodeCursor(cursor))
        : undefined
      if (decoded && !decoded.success) return v2Error('BAD_REQUEST', 'Invalid cursor')

      const page = await queryPublicWorkspaceMembers(workspaceId, {
        limit,
        afterEmail: decoded?.data.email,
      })
      if (!page) return v2Error('NOT_FOUND', 'Workspace not found')

      return v2CursorList(
        page.members.map((member) => ({
          email: member.email,
          name: member.name,
          image: member.image,
          role: member.role,
          isExternal: member.isExternal,
          joinedAt: member.joinedAt.toISOString(),
        })),
        page.nextEmail ? encodeCursor({ email: page.nextEmail }) : null,
        { rateLimit }
      )
    } catch (error) {
      logger.error('Failed to list workspace members', { error: getErrorMessage(error) })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
