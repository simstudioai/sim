import { organizationRoutes, WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'

export function getOrganizationHomeRedirect(
  context: Pick<OrganizationSurfaceContext, 'mothershipAvailable' | 'canBuild' | 'searchAccess'>,
  organizationId: string
): string | null {
  if (context.mothershipAvailable && context.canBuild) return null
  return context.searchAccess.memberScoped
    ? organizationRoutes(organizationId).search
    : WORKSPACE_SETTINGS_PATH
}
