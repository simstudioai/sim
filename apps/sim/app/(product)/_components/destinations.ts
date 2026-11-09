import {
  type PlatformOrganization,
  type SurfaceScope,
  surfaceHref,
} from '@/platform/lib/data/organization-model'
import type { ShellDestination } from '@/platform/shared/shell'

export function platformDestinations(scope: SurfaceScope) {
  return [
    { id: 'home', label: 'Home', icon: 'I104', value: surfaceHref(scope, '/home') },
    { id: 'settings', label: 'Settings', icon: 'I116', value: surfaceHref(scope, '/settings') },
    {
      id: 'integrations',
      label: 'Integrations',
      icon: 'I070',
      value: surfaceHref(scope, '/integrations'),
    },
  ] as const
}

/** The legacy navigation's gates and order. Benchmark stays on the legacy surface. */
export function resolveLiveDestinations(organization: PlatformOrganization): ShellDestination[] {
  const { mothershipAvailable, canBuild, searchAccess, navFlags } = organization
  const [home, settings, integrations] = platformDestinations(organization)
  const search = {
    id: 'search',
    label: 'Search',
    icon: 'I089',
    value: surfaceHref(organization, '/search'),
  } as const
  const people = {
    id: 'people',
    label: 'People',
    icon: 'I104',
    value: surfaceHref(organization, '/people'),
  } as const
  const benchmark = {
    id: 'benchmark',
    label: 'Benchmark',
    icon: 'I046',
    value: surfaceHref(organization, '/benchmark'),
  } as const
  return [
    ...(mothershipAvailable && canBuild ? [home] : []),
    ...(searchAccess.memberScoped ? [search] : []),
    ...(navFlags.people ? [people] : []),
    ...(searchAccess.memberScoped ? [integrations] : []),
    ...(navFlags.benchmark ? [benchmark] : []),
    settings,
  ]
}
