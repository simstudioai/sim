import { getActiveOrganizationId } from '@/lib/auth/session-response'
import { isKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
import { organizationRoutes, WORKSPACES_PATH } from '@/lib/navigation/paths'
import { resolveOrganizationLanding } from '@/lib/organizations/surface'

interface EntrySession {
  user: { id: string }
}

/**
 * Routes organization members to Home when the organization surface is enabled for
 * them. Everyone else — viewers without an organization, and members whose
 * organization has not been rolled out — lands on the workspace picker, which is
 * where the signed-in app's front door pointed before the organization surface
 * existed. The default landing never opens settings: a viewer who did not ask for
 * settings must not be dropped into them.
 */
export async function resolveAppEntryPath(session: EntrySession): Promise<string> {
  const organizationId = await resolveOrganizationLanding(
    session.user.id,
    getActiveOrganizationId(session)
  )
  if (!organizationId) return WORKSPACES_PATH
  return (await isKnowledgeMemberAccessAvailable({ organizationId }))
    ? organizationRoutes(organizationId).home
    : WORKSPACES_PATH
}
