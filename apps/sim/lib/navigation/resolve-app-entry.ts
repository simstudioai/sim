import { getActiveOrganizationId } from '@/lib/auth/session-response'
import { isKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
import {
  organizationRoutes,
  WORKSPACE_SETTINGS_PATH,
  WORKSPACES_PATH,
} from '@/lib/navigation/paths'
import { resolveOrganizationLanding } from '@/lib/organizations/surface'

interface EntrySession {
  user: { id: string }
}

/**
 * Routes organization members to Home when Search is enabled and workspace settings otherwise.
 * Viewers without an organization land on the workspace picker.
 */
export async function resolveAppEntryPath(session: EntrySession): Promise<string> {
  const organizationId = await resolveOrganizationLanding(
    session.user.id,
    getActiveOrganizationId(session)
  )
  if (!organizationId) return WORKSPACES_PATH
  const routes = organizationRoutes(organizationId)
  return (await isKnowledgeMemberAccessAvailable({ organizationId }))
    ? routes.home
    : WORKSPACE_SETTINGS_PATH
}
