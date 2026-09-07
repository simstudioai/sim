'use client'

import { useOrganizationWorkspaces } from '@/app/o/[organizationId]/components/organization-sidebar/hooks'
import type { FlyoutEntry } from '@/app/workspace/[workspaceId]/components/folders'
import { CollapsedResourceFlyout } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/collapsed-sidebar-menu'

interface WorkspacesRailFlyoutProps {
  organizationId: string
}

/**
 * Rail flyout body for the Workspaces tab: a jump list of the organization's
 * workspaces, one row each, the way the workspace sidebar's Tables and Files tabs
 * list theirs. Mounts only while the rail menu is open, so the workspace query
 * runs only when someone hovers the chip.
 */
export function WorkspacesRailFlyout({ organizationId }: WorkspacesRailFlyoutProps) {
  const { workspaces, isLoading } = useOrganizationWorkspaces(organizationId)

  const entries: FlyoutEntry[] = workspaces.map((workspace) => ({
    kind: 'item',
    id: workspace.id,
    name: workspace.name,
    pinned: false,
    href: `/workspace/${workspace.id}`,
  }))

  return (
    <CollapsedResourceFlyout
      entries={entries}
      isLoading={isLoading}
      emptyLabel='No workspaces yet'
    />
  )
}
