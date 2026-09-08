'use client'

import { useMemo } from 'react'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { connectorDisplayName } from '@/lib/sim-search/connectors'
import { OrganizationPage } from '@/app/o/[organizationId]/components/organization-page'
import { useOrganizationPageFilters } from '@/app/o/[organizationId]/components/organization-page/use-organization-page-filters'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { SearchSourceRow } from '@/app/workspace/[workspaceId]/search/components/search-source-row'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { RESOURCE_LIST_STACK } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { searchSourceKeys, useSearchSources } from '@/hooks/queries/kb/connectors'
import { useMemberEnrollment } from '@/hooks/use-member-enrollment'
import { useDesktopOAuthConnectListener, useOAuthReturnRouter } from '@/hooks/use-oauth-return'

/** Every source the organization searches, or only the ones the viewer has connected. */
const TABS = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Mine' },
] as const

/**
 * The organization's sources as every member sees them — the same list and the
 * same actions whatever the viewer's role. Setting sources up and managing them
 * is an organization admin's job, done in the organization's settings.
 */
export function OrganizationIntegrations() {
  useOAuthReturnRouter()
  useDesktopOAuthConnectListener()
  const { organization, searchAccess } = useOrganizationContext()
  const scope: ResourceScope = { kind: 'organization', organizationId: organization.id }
  const sources = useSearchSources(scope)
  const { tab, search } = useOrganizationPageFilters()
  const membershipQueryKeys = useMemo(
    () => [searchSourceKeys.list({ kind: 'organization', organizationId: organization.id })],
    [organization.id]
  )
  const connectedConnectorIds = useMemo(
    () =>
      new Set(
        sources.data
          ?.filter((source) => source.viewerMembership === 'connected')
          .map((source) => source.connectorId)
      ),
    [sources.data]
  )
  const enrollment = useMemberEnrollment({ membershipQueryKeys, connectedConnectorIds })
  const query = search.trim().toLowerCase()
  const mineOnly = tab === 'mine'
  const visibleSources =
    sources.data?.filter(
      (source) =>
        (!mineOnly || source.viewerMembership === 'connected') &&
        `${connectorDisplayName(source.connectorType)} ${source.sourceDescription}`
          .toLowerCase()
          .includes(query)
    ) ?? []

  return (
    <OrganizationPage
      title='Integrations'
      description='Connect your tools for Sim Search'
      tabs={TABS}
    >
      <div className={RESOURCE_LIST_STACK}>
        {sources.isError ? (
          <SettingsQueryErrorState
            error={sources.error}
            fallback='Could not load sources'
            isRetrying={sources.isFetching}
            onRetry={() => void sources.refetch()}
            variant='inline'
          />
        ) : visibleSources.length > 0 ? (
          visibleSources.map((source) => (
            <SearchSourceRow
              key={source.connectorId}
              source={source}
              scope={scope}
              canAdmin={false}
              available={
                source.accessMode === 'members'
                  ? searchAccess.memberScoped
                  : searchAccess.sourceMirrored &&
                    (!source.connectionRequired || searchAccess.memberScoped)
              }
              waiting={enrollment.isAwaiting(source.connectorId)}
              isPending={enrollment.isPending}
              onConnect={() => enrollment.connect(source.knowledgeBaseId, source.connectorId)}
            />
          ))
        ) : sources.isPending ? null : (
          <SettingsEmptyState variant='inline'>
            {query
              ? 'No matching sources.'
              : mineOnly
                ? 'You haven’t connected any sources yet.'
                : 'Your organization hasn’t added any sources yet. Ask an organization admin to get started.'}
          </SettingsEmptyState>
        )}
        {enrollment.error && (
          <p className='text-[var(--text-error)] text-caption'>{enrollment.error}</p>
        )}
      </div>
    </OrganizationPage>
  )
}
