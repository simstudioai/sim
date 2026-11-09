import { db } from '@sim/db'
import { member } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { resolveOrganizationLanding } from '@/lib/organizations/surface'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

/** Whether `userId` is a member of `organizationId`. */
export async function isOrganizationMember(
  organizationId: string,
  userId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)
  return Boolean(row)
}

/**
 * The organization whose pages a workspace opens in for `userId`, or `null` when they cannot open
 * it (or belong to no organization). Read-only. For callers that hold a user id rather than a
 * session principal (a Copilot tool's auth link, a search's connect-an-account guidance) and have
 * already authorized their own operation on the workspace; a session surface reads
 * `readWorkspaceShell`, which owns the rule.
 */
export async function resolveWorkspaceShellOrganizationId(
  workspaceId: string,
  userId: string
): Promise<string | null> {
  const access = await checkWorkspaceAccess(workspaceId, userId)
  if (!access.hasAccess || !access.workspace) return null
  const { organizationId } = access.workspace
  if (organizationId && (await isOrganizationMember(organizationId, userId))) return organizationId
  return resolveOrganizationLanding(userId, null)
}
