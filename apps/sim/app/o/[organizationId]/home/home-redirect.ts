import { organizationRoutes, WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'

/**
 * Where organization Home and its chat URLs send a viewer Home cannot serve, or `null` when
 * Home renders. Search when Chat is off but member Search is on; workspace settings when the
 * viewer can neither both chat and build, nor search as a member.
 */
export function getOrganizationHomeRedirect(
  context: Pick<OrganizationSurfaceContext, 'mothershipAvailable' | 'canBuild' | 'searchAccess'>,
  organizationId: string
): string | null {
  if (!context.mothershipAvailable && context.searchAccess.memberScoped) {
    return organizationRoutes(organizationId).search
  }
  if (!(context.mothershipAvailable && context.canBuild) && !context.searchAccess.memberScoped) {
    return WORKSPACE_SETTINGS_PATH
  }
  return null
}
