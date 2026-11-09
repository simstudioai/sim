import { legacyRoutes, type PlatformOrganization } from '@/platform/lib/data/organization-model'
import type { ShellDestination } from '@/platform/shared/shell'

export const PLATFORM_DESTINATIONS = [
  { id: 'home', label: 'Home', icon: 'I104', value: '/home' },
  { id: 'settings', label: 'Settings', icon: 'I116', value: '/settings' },
  { id: 'integrations', label: 'Integrations', icon: 'I070', value: '/integrations' },
] as const

const [HOME, SETTINGS, INTEGRATIONS] = PLATFORM_DESTINATIONS

/** The legacy navigation's gates and order. Benchmark stays on the legacy surface. */
export function resolveLiveDestinations(organization: PlatformOrganization): ShellDestination[] {
  const { mothershipAvailable, canBuild, searchAccess, navFlags } = organization
  const routes = legacyRoutes(organization)
  const search = { id: 'search', label: 'Search', icon: 'I089', value: '/search' } as const
  const people = { id: 'people', label: 'People', icon: 'I104', value: '/people' } as const
  const benchmark = {
    id: 'benchmark',
    label: 'Benchmark',
    icon: 'I046',
    value: routes.benchmark,
  } as const
  return [
    ...(mothershipAvailable && canBuild ? [HOME] : []),
    ...(searchAccess.memberScoped ? [search] : []),
    ...(navFlags.people ? [people] : []),
    ...(searchAccess.memberScoped ? [INTEGRATIONS] : []),
    ...(navFlags.benchmark ? [benchmark] : []),
    SETTINGS,
  ]
}
