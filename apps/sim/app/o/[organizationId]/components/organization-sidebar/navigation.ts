import { Home, Integration, Search, SquarePen } from '@sim/emcn/icons'
import { organizationRoutes } from '@/lib/navigation/paths'
import type { SidebarNavItemData } from '@/app/workspace/[workspaceId]/w/components/sidebar/components'

type OrganizationNavRoute = 'home' | 'search' | 'integrations'

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
]

/** With the org project view, Home is where a new chat starts, so it reads as one. */
const PROJECT_VIEW_HOME: Pick<OrganizationNavEntry, 'label' | 'icon'> = {
  label: 'New chat',
  icon: SquarePen,
}

export function buildOrganizationNavItems(
  organizationId: string,
  searchAvailable: boolean,
  mothershipAvailable: boolean,
  projectViewEnabled = false
): SidebarNavItemData[] {
  const routes = organizationRoutes(organizationId)
  return ORGANIZATION_NAV_ENTRIES.filter(({ route }) =>
    route === 'home' ? mothershipAvailable : searchAvailable
  ).map(({ route, ...entry }) => ({
    ...entry,
    ...(route === 'home' && projectViewEnabled ? PROJECT_VIEW_HOME : {}),
    href: routes[route],
  }))
}
