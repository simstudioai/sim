import { ChartColumn, Home, Integration, Search } from '@sim/emcn/icons'
import { organizationRoutes } from '@/lib/navigation/paths'
import type { SidebarNavItemData } from '@/app/workspace/[workspaceId]/w/components/sidebar/components'

type OrganizationNavRoute = 'home' | 'search' | 'integrations' | 'benchmark'

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
  { id: 'benchmark', label: 'Benchmark', icon: ChartColumn, route: 'benchmark' },
]

export function buildOrganizationNavItems(
  organizationId: string,
  searchAvailable: boolean,
  mothershipAvailable: boolean,
  benchmarkEnabled = false
): SidebarNavItemData[] {
  const routes = organizationRoutes(organizationId)
  return ORGANIZATION_NAV_ENTRIES.filter(({ route }) => {
    if (route === 'benchmark') return benchmarkEnabled
    return route === 'home' ? mothershipAvailable : searchAvailable
  }).map(({ route, ...entry }) => ({
    ...entry,
    href: routes[route],
  }))
}
