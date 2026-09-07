'use client'

import { Building } from '@sim/emcn/icons'
import { OrganizationPage } from '@/app/o/[organizationId]/components/organization-page'
import { useOrganizationPageFilters } from '@/app/o/[organizationId]/components/organization-page/use-organization-page-filters'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'admin', label: 'Admin' },
  { id: 'write', label: 'Write' },
  { id: 'read', label: 'Read' },
] as const

export function OrganizationWorkspaces() {
  const { organization } = useOrganizationContext()
  const { tab, search } = useOrganizationPageFilters()
  const workspaces = useWorkspacesQuery()
  const query = search.trim().toLowerCase()
  const visible =
    workspaces.data?.filter(
      (workspace) =>
        workspace.organizationId === organization.id &&
        (!tab || tab === 'all' || workspace.permissions === tab) &&
        workspace.name.toLowerCase().includes(query)
    ) ?? []
  return (
    <OrganizationPage
      title='Workspaces'
      description='Where your team builds agents and workflows'
      tabs={TABS}
    >
      <div className={RESOURCE_LIST_STACK}>
        {workspaces.isError ? (
          <SettingsQueryErrorState
            error={workspaces.error}
            fallback='Could not load workspaces'
            isRetrying={workspaces.isFetching}
            onRetry={() => void workspaces.refetch()}
            variant='inline'
          />
        ) : workspaces.isPending ? (
          <SettingsEmptyState variant='inline'>Loading workspaces…</SettingsEmptyState>
        ) : visible.length ? (
          visible.map((workspace) => (
            <SettingsResourceRow
              key={workspace.id}
              icon={<Building className='size-[14px]' />}
              title={workspace.name}
              href={`/workspace/${workspace.id}/home`}
              clickLabel={`Open ${workspace.name}`}
              navigable
            />
          ))
        ) : (
          <SettingsEmptyState variant='inline'>
            {query || (tab && tab !== 'all')
              ? 'No matching workspaces.'
              : 'You don’t have access to any workspaces in this organization yet.'}
          </SettingsEmptyState>
        )}
      </div>
    </OrganizationPage>
  )
}
