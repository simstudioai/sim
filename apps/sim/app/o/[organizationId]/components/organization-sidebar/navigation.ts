import { Home, Integration, Workspaces } from '@sim/emcn/icons'
import { organizationRoutes } from '@/lib/navigation/paths'
import type { SidebarNavItemData } from '@/app/workspace/[workspaceId]/w/components/sidebar/components'

type OrganizationNavRoute = 'home' | 'integrations' | 'workspaces'

interface OrganizationNavEntry {
  id: string
  label: string
  icon: SidebarNavItemData['icon']
  route: OrganizationNavRoute
}

/** The nav item whose collapsed rail chip also opens a flyout of the organization's workspaces. */
export const WORKSPACES_NAV_ID = 'workspaces'

/**
 * The pinned block at the top of the organization sidebar, in display order.
 * Hrefs are resolved per organization by {@link buildOrganizationNavItems}.
 */
const ORGANIZATION_NAV_ENTRIES: readonly OrganizationNavEntry[] = [
  { id: 'home', label: 'Home', icon: Home, route: 'home' },
  { id: 'integrations', label: 'Integrations', icon: Integration, route: 'integrations' },
  { id: 'workspaces', label: 'Workspaces', icon: Workspaces, route: 'workspaces' },
]

export function buildOrganizationNavItems(organizationId: string): SidebarNavItemData[] {
  const routes = organizationRoutes(organizationId)
  return ORGANIZATION_NAV_ENTRIES.map(({ route, ...entry }) => ({
    ...entry,
    href: routes[route],
  }))
}
