import {
  v2ListWorkspaceMembersContract,
  v2WorkspaceMemberCursorSchema,
} from '@/lib/api/contracts/v2/workspaces'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { listPublicWorkspaceMembers } from '@/lib/workspaces/application/list-public-workspace-members'
import { workspaceOperations } from '@/lib/workspaces/application/operations'
import { decodeCursor, encodeCursor } from '@/app/api/v2/lib/response'

/** GET /api/v2/workspaces/[workspaceId]/members — Effective member roster. */
export const GET = defineV2JsonRoute({
  contract: v2ListWorkspaceMembersContract,
  auth: v2ApiKeyAuth,
  operation: workspaceOperations.listPublicMembers,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params, query }) => {
    const decoded = query.cursor
      ? v2WorkspaceMemberCursorSchema.safeParse(decodeCursor(query.cursor))
      : undefined
    if (decoded && !decoded.success) {
      throw new OrchestrationError('validation', 'Invalid cursor')
    }
    return {
      workspaceId: params.workspaceId,
      limit: query.limit,
      afterEmail: decoded?.data.email,
    }
  },
  useCase: listPublicWorkspaceMembers,
  present: ({ page }) => ({
    data: page.members.map((member) => ({
      email: member.email,
      name: member.name,
      image: member.image,
      role: member.role,
      isExternal: member.isExternal,
      joinedAt: member.joinedAt.toISOString(),
    })),
    nextCursor: page.nextEmail ? encodeCursor({ email: page.nextEmail }) : null,
  }),
})
