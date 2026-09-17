import { Home, Integration } from '@sim/emcn/icons'
import { organizationRoutes } from '@/lib/navigation/paths'
import type { SidebarNavItemData } from '@/app/workspace/[workspaceId]/w/components/sidebar/components'

type OrganizationNavRoute = 'home' | 'integrations'

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
  { id: 'integrations', label: 'Integrations', icon: Integration, route: 'integrations' },
]

export function buildOrganizationNavItems(
  organizationId: string,
  searchAvailable: boolean,
  mothershipAvailable: boolean
): SidebarNavItemData[] {
  const routes = organizationRoutes(organizationId)
  return ORGANIZATION_NAV_ENTRIES.filter(({ route }) =>
    route === 'home' ? mothershipAvailable || searchAvailable : searchAvailable
  ).map(({ route, ...entry }) => ({
    ...entry,
    href: routes[route],
  }))
}
