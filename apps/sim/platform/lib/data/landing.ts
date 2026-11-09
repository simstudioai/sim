import { organizationRoutes, WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'

/**
 * Where an organization's bare URL sends a viewer: the legacy organization root's priority chain.
 * Links is a Settings section here.
 */
export function organizationLandingPath(organization: PlatformOrganization): string {
  const { mothershipAvailable, canBuild, searchAccess, navFlags } = organization
  const routes = organizationRoutes(organization.organization.id)
  if (mothershipAvailable && canBuild) return routes.home
  if (searchAccess.memberScoped) return routes.search
  if (navFlags.people) return routes.people
  return navFlags.simLinks ? routes.simLinks : WORKSPACE_SETTINGS_PATH
}
