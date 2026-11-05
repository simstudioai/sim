import { organizationRoutes, WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'

type OrganizationRedirectContext = Pick<
  OrganizationSurfaceContext,
  'mothershipAvailable' | 'canBuild' | 'searchAccess'
>

/** Where an agent conversation sends a viewer who cannot build. */
export function getOrganizationBuildRedirect(
  context: OrganizationRedirectContext,
  organizationId: string
): string | null {
  if (context.mothershipAvailable && context.canBuild) return null
  return context.searchAccess.memberScoped
    ? organizationRoutes(organizationId).search
    : WORKSPACE_SETTINGS_PATH
}

/** Home serves whoever can hold a conversation here: an agent to build, or an Assistant to search. */
export function getOrganizationHomeRedirect(
  context: OrganizationRedirectContext,
  organizationId: string
): string | null {
  if (context.mothershipAvailable && context.searchAccess.memberScoped) return null
  return getOrganizationBuildRedirect(context, organizationId)
}
