import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

/**
 * Whether the actor may expose a deployment to unauthenticated callers.
 *
 * Deploying is a `write` capability, but making a deployment *public* is not:
 * a public workflow API, a public chat, and a public workflow MCP server all
 * skip authentication entirely, so anyone holding the URL can invoke the
 * workflow and everything it references. That is a different risk class from
 * shipping a version, and it stays admin-only.
 *
 * Lives here rather than beside any one surface because four paths can set it —
 * the workflow public-API route, the REST chat create and update routes, the
 * copilot chat use case, and the workflow MCP server create/update use cases —
 * and a rule duplicated per callsite is a rule that drifts. Two of those paths
 * default to public, so a missing check silently reopens the boundary.
 *
 * Callers gate only the *transition to* public. Turning exposure off, or
 * leaving it unchanged, stays `write`: neither increases exposure.
 */
export async function canExposePublicly(userId: string, workspaceId: string): Promise<boolean> {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  return permission === 'admin'
}

/**
 * Whether a requested visibility raises exposure and therefore needs `admin`.
 *
 * Edit forms submit every field, not just the dirty one, so an unchanged
 * `true` arrives on a rename exactly like a deliberate flip to public. Gating
 * the *value* would stop a `write` member from renaming an already-public
 * deployment; only the *transition* is a privilege escalation.
 *
 * `undefined` means the caller left visibility alone, which never escalates.
 */
export function increasesPublicExposure(
  requested: boolean | undefined,
  current: boolean | undefined
): boolean {
  return requested === true && current !== true
}
