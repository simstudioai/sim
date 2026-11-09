import { organizationRoutes, WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import {
  type PlatformOrganization,
  resolveHomeRedirect,
  surfaceHref,
} from '@/platform/lib/data/organization-model'

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

/**
 * The redirect a document request for an organization's bare URL or its Home answers. The shell
 * applies it before anything streams, so the viewer gets one HTTP redirect instead of a painted page
 * that navigates again once loaded; the pages keep the same gates for client navigations.
 */
export function resolveEntryRedirect(
  organization: PlatformOrganization,
  pathname: string | null
): string | null {
  if (pathname === organization.routePrefix) return organizationLandingPath(organization)
  if (pathname === surfaceHref(organization, '/home')) return resolveHomeRedirect(organization)
  return null
}
