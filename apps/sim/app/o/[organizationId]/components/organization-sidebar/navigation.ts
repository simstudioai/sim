import { ChartColumn, Home, Integration, Link, Search } from '@sim/emcn/icons'
import { organizationRoutes } from '@/lib/navigation/paths'
import type { SidebarNavItemData } from '@/app/workspace/[workspaceId]/w/components/sidebar/components'

type OrganizationNavRoute = 'home' | 'search' | 'integrations' | 'simLinks' | 'benchmark'

interface OrganizationNavEntry {
  id: string
  label: string
  icon: SidebarNavItemData['icon']
  route: OrganizationNavRoute
}

/**
 * The pinned block at the top of the organization sidebar, in display order.
 * Hrefs are resolved per organization by {@link buildOrganizationNavItems}.
 */
const ORGANIZATION_NAV_ENTRIES: readonly OrganizationNavEntry[] = [
  { id: 'home', label: 'Home', icon: Home, route: 'home' },
  { id: 'search', label: 'Search', icon: Search, route: 'search' },
  { id: 'integrations', label: 'Integrations', icon: Integration, route: 'integrations' },
  { id: 'sim-links', label: 'Sim Links', icon: Link, route: 'simLinks' },
  { id: 'benchmark', label: 'Benchmark', icon: ChartColumn, route: 'benchmark' },
]

interface OrganizationNavAvailability {
  searchAvailable: boolean
  mothershipAvailable: boolean
  benchmarkEnabled?: boolean
  simLinksEnabled?: boolean
}

export function buildOrganizationNavItems(
  organizationId: string,
  {
    searchAvailable,
    mothershipAvailable,
    benchmarkEnabled = false,
    simLinksEnabled = false,
  }: OrganizationNavAvailability
): SidebarNavItemData[] {
  const routes = organizationRoutes(organizationId)
  const available: Record<OrganizationNavRoute, boolean> = {
    home: mothershipAvailable,
    search: searchAvailable,
    integrations: searchAvailable,
    simLinks: simLinksEnabled,
    benchmark: benchmarkEnabled,
  }
  return ORGANIZATION_NAV_ENTRIES.filter(({ route }) => available[route]).map(
    ({ route, ...entry }) => ({
      ...entry,
      href: routes[route],
    })
  )
}
