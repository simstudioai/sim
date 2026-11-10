import { resolveWorkspaceShellOrganizationId } from '@/lib/workspaces/application/workspace-shell'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

/**
 * {@link resolveWorkspaceShellOrganizationId} for a workspace `userId` can open, or `null` when they
 * cannot open it. For callers that hold a user id rather than a session principal (a Copilot tool's
 * auth link, a search's connect-an-account guidance); a session surface reads `readWorkspaceShell`.
 */
export async function resolveAccessibleWorkspaceShellOrganizationId(
  workspaceId: string,
  userId: string
): Promise<string | null> {
  const access = await checkWorkspaceAccess(workspaceId, userId)
  if (!access.hasAccess || !access.workspace) return null
  return resolveWorkspaceShellOrganizationId(access.workspace.organizationId, userId)
}
