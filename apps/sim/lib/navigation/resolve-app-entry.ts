import { getActiveOrganizationId } from '@/lib/auth/session-response'
import { organizationRoutes, WORKSPACES_PATH } from '@/lib/navigation/paths'
import { resolveOrganizationLanding } from '@/lib/organizations/surface'

interface EntrySession {
  user: { id: string }
}

/**
 * Where an authenticated viewer lands by default: the home of their organization
 * (the session's active one when they belong to it, otherwise their first), or the
 * workspace picker when they belong to no organization.
 */
export async function resolveAppEntryPath(session: EntrySession): Promise<string> {
  const organizationId = await resolveOrganizationLanding(
    session.user.id,
    getActiveOrganizationId(session)
  )
  return organizationId ? organizationRoutes(organizationId).home : WORKSPACES_PATH
}
