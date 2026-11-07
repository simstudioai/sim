import 'server-only'
import { organizationRoutes } from '@/lib/navigation/paths'
import { legacyRoutes } from '@/platform/lib/data/organization-model'
import { legacyUrl, readOrganizationSurface } from '@/platform/lib/data/surface'

const HOME = '/home'

/**
 * Where the zone root sends a viewer: the legacy organization root's priority chain. Links is a
 * Settings section here. A viewer who cannot be resolved goes to Home,
 * whose layout owns the login, denial and error states. An organization the rollout does not reach
 * has no page here, so it goes back to its own root: this is where the not-found page's "Return
 * home" leads, and any route in the zone would answer it with that same page. The legacy root does
 * not send it back, because that mapping is off for the same reason.
 */
export async function resolveLiveLanding(): Promise<string> {
  const surface = await readOrganizationSurface()
  if (surface.status !== 'ok') return HOME
  const { organization } = surface
  if (process.env.NEXT_PUBLIC_SIM_PLATFORM_BASE_PATH && !organization.platformOrgUi) {
    return legacyUrl(organizationRoutes(organization.organization.id).root)
  }
  const { mothershipAvailable, canBuild, searchAccess, navFlags } = organization
  const routes = legacyRoutes(organization)
  if (mothershipAvailable && canBuild) return HOME
  if (searchAccess.memberScoped) return '/search'
  if (navFlags.people) return '/people'
  return navFlags.simLinks ? '/settings/links' : routes.workspaceSettings
}
