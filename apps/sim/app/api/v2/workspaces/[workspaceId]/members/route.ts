import {
  v2ListWorkspaceMembersContract,
  v2WorkspaceMemberCursorSchema,
} from '@/lib/api/contracts/v2/workspaces'
import { queryPublicWorkspaceMembers } from '@/lib/workspaces/public-queries'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import {
  decodeCursor,
  encodeCursor,
  v2CursorList,
  v2Error,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

/** GET /api/v2/workspaces/[workspaceId]/members — Effective member roster. */
export const GET = withPublicApiRouteHandler({
  contract: v2ListWorkspaceMembersContract,
  rateLimitEndpoint: 'workspace-members',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { workspaceId } = input.params
    const { cursor, limit } = input.query
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
  },
})
