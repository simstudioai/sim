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
 * An MCP call connects to a third-party server with one person's stored
 * credentials and is gated by that person's permission group, so unlike an
 * attribution-only read it cannot proceed with nobody named.
 *
 * `executionActorUserId` preserves the behavior that existed before the Logs and
 * MCP tools moved in-process. That path minted an internal token from
 * `ExecutionContext.userId` and the MCP route ran as that user, so an unattended
 * run has always reached MCP as the execution actor. For a schedule, webhook, or
 * anonymous public-API run that actor is the workspace system actor resolved
 * during preprocessing — the billing payer — not the workflow's author. Keeping
 * it is what stops every unattended MCP workflow from breaking; changing it is a
 * product decision, not a refactor, and a workspace-level MCP identity is the
 * real fix.
 *
 * The fallback deliberately covers a webhook carrying an `external_user` subject
 * too. That subject is a real identity but never a Sim user, so it has no Sim
 * credentials of its own, and those runs have always connected as the actor.
 * Refusing them here would break working workflows in the name of a boundary the
 * old path never drew.
 *
 * It is NOT an authorization input: workspace reach is decided by the principal
 * before this is read, and a principal that names its own subject always wins, so
 * a caller cannot use this to nominate someone else's credentials.
 */
export function requireMcpCredentialUserId(
  principal: Principal,
  executionActorUserId?: string
): string {
  const userId = resolvePrincipalSubjectUserId(principal) ?? executionActorUserId
  if (!userId) {
    throw new OrchestrationError(
      'forbidden',
      'MCP servers are reached with a user\u2019s own credentials, and this run has none'
    )
  }
  return userId
}
