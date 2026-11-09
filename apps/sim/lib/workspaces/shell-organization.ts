import { db } from '@sim/db'
import { member } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { resolveOrganizationLanding } from '@/lib/organizations/surface'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

/** The organization a viewer lands in; read-only by default, while the product shell provisions one. */
type LandingResolver = (userId: string) => Promise<string | null>

const readLanding: LandingResolver = (userId) => resolveOrganizationLanding(userId, null)

async function isOrganizationMember(organizationId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)
  return Boolean(row)
}

/**
 * The organization whose product pages a workspace opens in for `userId`, or `null` when they
 * cannot open it, so a private workspace's organization never shows. A workspace opens in its own
 * organization, personal ones included, when the viewer is a member of it. Otherwise it opens in
 * the viewer's landing organization: an organization-less workspace (a personal workspace kept
 * outside the team its owner joined), a guest on someone's personal workspace, and an external
 * collaborator on a team's workspace all see it inside their own organization, since an
 * organization's surface is open only to its members. Billing and permissions stay the
 * workspace's own either way.
 */
export async function resolveWorkspaceShellOrganizationId(
  workspaceId: string,
  userId: string,
  landing: LandingResolver = readLanding
): Promise<string | null> {
  const access = await checkWorkspaceAccess(workspaceId, userId)
  if (!access.hasAccess || !access.workspace) return null
  const { organizationId } = access.workspace
  if (organizationId && (await isOrganizationMember(organizationId, userId))) return organizationId
  return landing(userId)
}
