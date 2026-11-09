import { getActiveOrganizationId } from '@/lib/auth/session-response'
import { organizationRoutes, WORKSPACES_PATH } from '@/lib/navigation/paths'
import { resolveOrganizationLanding } from '@/lib/organizations/surface'

interface EntrySession {
  user: { id: string }
}

/**
 * The organization `/o` lands the viewer in. Every account belongs to one (a team, or their own
 * personal organization), and the organization surface is open to all of them; organization
 * features that need a plan keep their own gates.
 */
export async function resolveRolledOutOrganizationId(
  session: EntrySession
): Promise<string | null> {
  return resolveOrganizationLanding(session.user.id, getActiveOrganizationId(session))
}

/** Returns the viewer's organization Home, or null for an account not yet in any organization. */
export async function resolveOrganizationEntryPath(session: EntrySession): Promise<string | null> {
  const organizationId = await resolveRolledOutOrganizationId(session)
  return organizationId ? organizationRoutes(organizationId).home : null
}

/**
 * Routes every viewer to their organization's Home. An account not yet in any organization lands
 * on the workspace picker, whose first load provisions their personal organization. The default
 * landing never opens settings: a viewer who did not ask for settings must not be dropped into
 * them.
 */
export async function resolveAppEntryPath(session: EntrySession): Promise<string> {
  return (await resolveOrganizationEntryPath(session)) ?? WORKSPACES_PATH
}
