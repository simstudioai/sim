import type { IconName } from '@sim/emcn/catalog/icon-geometry'
import { organizationRoutes } from '@/lib/navigation/paths'
import type { ShellDestination } from '@/app/o/[organizationId]/_redesign/rail/model'

type OrganizationNavRoute = 'home' | 'search' | 'people' | 'integrations' | 'simLinks' | 'benchmark'

interface OrganizationNavEntry {
  id: string
  label: string
  icon: IconName
  route: OrganizationNavRoute
}

/** The pinned block at the top of the organization sidebar, in display order. */
const ORGANIZATION_NAV_ENTRIES: readonly OrganizationNavEntry[] = [
  { id: 'home', label: 'Home', icon: 'I104', route: 'home' },
  { id: 'search', label: 'Search', icon: 'I089', route: 'search' },
  { id: 'people', label: 'People', icon: 'I129', route: 'people' },
  { id: 'integrations', label: 'Integrations', icon: 'I070', route: 'integrations' },
  { id: 'sim-links', label: 'Links', icon: 'I041', route: 'simLinks' },
  { id: 'benchmark', label: 'Benchmark', icon: 'I046', route: 'benchmark' },
]

interface OrganizationNavAvailability {
  searchAvailable: boolean
  homeAvailable: boolean
  benchmarkEnabled?: boolean
  simLinksEnabled?: boolean
  peopleEnabled?: boolean
}

export function buildOrganizationNavItems(
  organizationId: string,
  {
    searchAvailable,
    homeAvailable,
    benchmarkEnabled = false,
    simLinksEnabled = false,
    peopleEnabled = false,
  }: OrganizationNavAvailability
): ShellDestination[] {
  const routes = organizationRoutes(organizationId)
  const available: Record<OrganizationNavRoute, boolean> = {
    home: homeAvailable,
    search: searchAvailable,
    people: peopleEnabled,
    integrations: searchAvailable,
    simLinks: simLinksEnabled,
    benchmark: benchmarkEnabled,
  }
  return ORGANIZATION_NAV_ENTRIES.filter(({ route }) => available[route]).map(
    ({ route, id, label, icon }) => ({ id, label, icon, value: routes[route] })
  )
}
