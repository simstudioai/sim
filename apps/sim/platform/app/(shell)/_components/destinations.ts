import type { ShellDestination } from '@/platform/app/(shell)/_components/model'
import { legacyRoutes, type PlatformOrganization } from '@/platform/lib/data/organization-model'

export const PLATFORM_DESTINATIONS = [
  { id: 'home', label: 'Home', icon: 'I104', value: '/home' },
  { id: 'settings', label: 'Settings', icon: 'I116', value: '/settings' },
  { id: 'integrations', label: 'Integrations', icon: 'I070', value: '/integrations' },
] as const

/** The legacy navigation's gates and order. Search and Benchmark stay on the legacy surface. */
export function resolveLiveDestinations(organization: PlatformOrganization): ShellDestination[] {
  const { access, navFlags } = organization
  const routes = legacyRoutes(organization)
  return [
    ...(access.mothershipAvailable && access.canBuild
      ? [{ id: 'home', label: 'Home', icon: 'I104' as const, value: '/home' }]
      : []),
    ...(access.searchAccess.memberScoped
      ? [{ id: 'search', label: 'Search', icon: 'I089' as const, value: routes.search }]
      : []),
    ...(navFlags.people
      ? [{ id: 'people', label: 'People', icon: 'I104' as const, value: '/people' }]
      : []),
    ...(access.searchAccess.memberScoped
      ? [
          {
            id: 'integrations',
            label: 'Integrations',
            icon: 'I070' as const,
            value: '/integrations',
          },
        ]
      : []),
    ...(navFlags.benchmark
      ? [{ id: 'benchmark', label: 'Benchmark', icon: 'I046' as const, value: routes.benchmark }]
      : []),
    { id: 'settings', label: 'Settings', icon: 'I116', value: '/settings' },
  ]
}
