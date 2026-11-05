import { getActiveOrganizationId } from '@/lib/auth/session-response'
import { isKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
import { organizationRoutes, WORKSPACES_PATH } from '@/lib/navigation/paths'
import { resolveOrganizationLanding } from '@/lib/organizations/surface'
import { getWorkspaceCreationPolicy } from '@/lib/workspaces/policy'
import { listAccessibleWorkspaceRowsForUser } from '@/lib/workspaces/utils'

interface EntrySession {
  user: { id: string }
}

/** The viewer's organization, once membership and the organization's rollout both check out. */
async function resolveRolledOutOrganizationId(session: EntrySession): Promise<string | null> {
  const organizationId = await resolveOrganizationLanding(
    session.user.id,
    getActiveOrganizationId(session)
  )
  if (!organizationId) return null
  return (await isKnowledgeMemberAccessAvailable({ organizationId })) ? organizationId : null
}

/** Returns a destination only after checking the viewer's membership and organization rollout. */
export async function resolveOrganizationEntryPath(session: EntrySession): Promise<string | null> {
  const organizationId = await resolveRolledOutOrganizationId(session)
  return organizationId ? organizationRoutes(organizationId).home : null
}

/**
 * Where the workspace picker forwards an organization member it cannot serve: one
 * with no accessible workspace who is not allowed to create one. `null` leaves the
 * viewer on the picker. The rollout check is what keeps this loop-free, since the
 * organization surface sends a viewer back to the picker only when that rollout is off.
 */
export async function resolveWorkspacelessMemberPath(
  session: EntrySession,
  destination: 'home' | 'settings'
): Promise<string | null> {
  const organizationId = await resolveRolledOutOrganizationId(session)
  if (!organizationId) return null

  const [creationPolicy, workspaces] = await Promise.all([
    getWorkspaceCreationPolicy({
      userId: session.user.id,
      activeOrganizationId: getActiveOrganizationId(session),
    }),
    listAccessibleWorkspaceRowsForUser(session.user.id),
  ])
  if (creationPolicy.canCreate || workspaces.length > 0) return null

  const routes = organizationRoutes(organizationId)
  return destination === 'settings' ? routes.settingsSection('general') : routes.home
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
  return (await resolveOrganizationEntryPath(session)) ?? WORKSPACES_PATH
}
