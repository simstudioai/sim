import {
  v2ListWorkspaceMembersContract,
  v2WorkspaceMemberCursorSchema,
} from '@/lib/api/contracts/v2/workspaces'
import { cursorRoute, cursorScopeKey, UNREADABLE_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { v2WorkspaceErrorPolicies } from '@/lib/workspaces/api/route-policies'
import { listPublicWorkspaceMembers } from '@/lib/workspaces/application/list-public-workspace-members'
import { workspaceOperations } from '@/lib/workspaces/application/operations'
import {
  decodeCursor,
  encodeCursor,
  encodeScopedCursor,
  readScopedCursor,
} from '@/app/api/v2/lib/response'

/**
 * The sequence a member cursor names a position in: this roster, on THIS
 * workspace.
 *
 * The payload is a bare email, and the same person is a member of every
 * workspace they belong to, so an unscoped token minted on one roster decoded
 * cleanly against another and resumed from an email that names a different
 * position in it. The workspace id lives in the path, so the route is the only
 * place that knows which roster the email indexes.
 */
function memberCursorScope(workspaceId: string): string {
  return cursorScopeKey(cursorRoute(v2ListWorkspaceMembersContract, { workspaceId }))
}

/** GET /api/v2/workspaces/[workspaceId]/members — Effective member roster. */
export const GET = defineV2JsonRoute({
  contract: v2ListWorkspaceMembersContract,
  auth: v2ApiKeyAuth,
  operation: workspaceOperations.listPublicMembers,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkspaceErrorPolicies.concealWorkspaceAuthorization,
  mapInput: ({ params, query }) => {
    const inner = readScopedCursor(query.cursor, memberCursorScope(params.workspaceId))
    const decoded = inner ? v2WorkspaceMemberCursorSchema.safeParse(decodeCursor(inner)) : undefined
    if (decoded && !decoded.success) {
      throw new OrchestrationError('validation', UNREADABLE_CURSOR_MESSAGE)
    }
    return {
      workspaceId: params.workspaceId,
      limit: query.limit,
      afterEmail: decoded?.data.email,
    }
  },
  useCase: listPublicWorkspaceMembers,
  present: ({ page }, { params }) => ({
    data: page.members.map((member) => ({
      email: member.email,
      name: member.name,
      image: member.image,
      role: member.role,
      isExternal: member.isExternal,
      joinedAt: member.joinedAt.toISOString(),
    })),
    nextCursor: page.nextEmail
      ? encodeScopedCursor(
          memberCursorScope(params.workspaceId),
          encodeCursor({ email: page.nextEmail })
        )
      : null,
  }),
})
