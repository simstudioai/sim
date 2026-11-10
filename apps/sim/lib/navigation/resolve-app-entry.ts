import { getActiveOrganizationId } from '@/lib/auth/session-response'
import { organizationRoutes, WORKSPACES_PATH } from '@/lib/navigation/paths'
import { ensureViewerOrganization } from '@/lib/organizations/application/viewer-organization'
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

/**
 * Routes every viewer to their organization's Home. An account not yet in any organization (one the
 * backfill has not reached, or whose signup provisioning failed) is provisioned into one first,
 * through the same idempotent command the product shell runs, so it lands as a provisioned account
 * does. Only an account that no longer exists falls back to the workspace loader, which recovers
 * the session. The default landing never opens settings: a viewer who did not ask for settings must
 * not be dropped into them.
 */
export async function resolveAppEntryPath(
  session: EntrySession & { session: { id: string } }
): Promise<string> {
  const organizationId =
    (await resolveRolledOutOrganizationId(session)) ??
    (await ensureViewerOrganization.execute({
      principal: { kind: 'session', userId: session.user.id, sessionId: session.session.id },
      input: {},
    }))
  return organizationId ? organizationRoutes(organizationId).home : WORKSPACES_PATH
}
