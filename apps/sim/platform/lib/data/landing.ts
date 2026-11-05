import 'server-only'
import { legacyRoutes } from '@/platform/lib/data/organization-model'
import { readOrganizationSurface } from '@/platform/lib/data/surface'

const HOME = '/home'

/**
 * Where the zone root sends a viewer: the legacy organization root's priority chain. Links is a
 * Settings section here, and Search is still legacy. A viewer who cannot be resolved goes to Home,
 * whose layout owns the login, denial and error states.
 */
export async function resolveLiveLanding(): Promise<string> {
  const surface = await readOrganizationSurface()
  if (surface.status !== 'ok') return HOME
  const { organization } = surface
  const { mothershipAvailable, canBuild, searchAccess, navFlags } = organization
  const routes = legacyRoutes(organization)
  if (mothershipAvailable && canBuild) return HOME
  if (searchAccess.memberScoped) return '/search'
  if (navFlags.people) return '/people'
  return navFlags.simLinks ? '/settings/links' : routes.workspaceSettings
}
