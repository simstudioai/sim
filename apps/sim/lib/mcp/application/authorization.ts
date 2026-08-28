import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import type { WorkspaceDelegationPolicy } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export const MCP_SERVER_DELEGATION_AUDIENCE = 'sim:mcp-servers'

export const mcpServerDelegationPolicy = {
  audience: MCP_SERVER_DELEGATION_AUDIENCE,
  isWithinScope: () => true,
} as const satisfies WorkspaceDelegationPolicy<{
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
}>

/**
 * The user whose MCP server credentials an operation presents.
 *
 * Every MCP path — execution and both discoveries — connects to a third-party
 * server with one person's OAuth credentials and is gated by that person's
 * permission group, so unlike an attribution-only read it genuinely cannot run
 * with nobody: there is no credential set and the permission gate would be
 * skipped rather than satisfied.
 *
 * The principal's own subject always wins. `fallbackUserId` is for an actorless
 * run — a schedule, or a webhook with no external subject — whose surface passes
 * the workflow's own user; because it is consulted only when the principal names
 * nobody, a caller cannot use it to nominate someone else's credentials.
 *
 * Fails as `forbidden` rather than throwing `PrincipalSubjectUserRequiredError`,
 * so a run with no user at all gets a 403 that says why instead of an opaque 500.
 */
export function requireMcpCredentialUserId(principal: Principal, fallbackUserId?: string): string {
  const userId = resolvePrincipalSubjectUserId(principal) ?? fallbackUserId
  if (!userId) {
    throw new OrchestrationError(
      'forbidden',
      'MCP servers are reached with a user\u2019s own credentials, and this run has no user'
    )
  }
  return userId
}
