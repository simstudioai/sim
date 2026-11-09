import { resolveOrganizationLanding } from '@/lib/organizations/surface'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

/**
 * The organization whose product pages a workspace opens in for `userId`, or `null` when they
 * cannot open it, so a private workspace's organization never shows. A workspace in an
 * organization opens in its own, personal ones included, not the paying host. An
 * organization-less workspace (a personal workspace kept outside the team its owner joined) opens
 * in the viewer's landing organization; its billing and permissions stay its own.
 */
export async function resolveWorkspaceShellOrganizationId(
  workspaceId: string,
  userId: string
): Promise<string | null> {
  const access = await checkWorkspaceAccess(workspaceId, userId)
  if (!access.hasAccess || !access.workspace) return null
  return access.workspace.organizationId ?? resolveOrganizationLanding(userId, null)
}
