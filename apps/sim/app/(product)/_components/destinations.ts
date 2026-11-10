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

/**
 * The legacy navigation's gates and order. Benchmark stays on the legacy surface. Integrations is
 * every member's: an organization without member-scoped accounts manages workspace credentials and
 * skills there.
 */
export function resolveLiveDestinations(organization: PlatformOrganization): ShellDestination[] {
  const { mothershipAvailable, searchAccess, navFlags } = organization
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
    icon: 'I133',
    value: surfaceHref(organization, '/people'),
  } as const
  const benchmark = {
    id: 'benchmark',
    label: 'Benchmark',
    icon: 'I046',
    value: `/benchmark?${new URLSearchParams({ organization: organization.organization.id })}`,
  } as const
  return [
    ...(mothershipAvailable ? [home] : []),
    ...(searchAccess.memberScoped ? [search] : []),
    ...(navFlags.people ? [people] : []),
    integrations,
    ...(navFlags.benchmark ? [benchmark] : []),
    settings,
  ]
}
