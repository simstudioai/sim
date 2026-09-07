'use client'

import { useMemo } from 'react'
import { Chip } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { useQueryState } from 'nuqs'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { connectorDisplayName } from '@/lib/sim-search/connectors'
import { OrganizationPage } from '@/app/o/[organizationId]/components/organization-page'
import { useOrganizationPageFilters } from '@/app/o/[organizationId]/components/organization-page/use-organization-page-filters'
import { OrganizationSlackAccountSetup } from '@/app/o/[organizationId]/integrations/slack-account-setup'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { SearchSourceRow } from '@/app/workspace/[workspaceId]/search/components/search-source-row'
import { SearchSourceSetup } from '@/app/workspace/[workspaceId]/search/components/search-source-setup'
import {
  managedSourceParam,
  searchSetupParam,
} from '@/app/workspace/[workspaceId]/search/search-params'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { RESOURCE_LIST_STACK } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { searchSourceKeys, useSearchSources } from '@/hooks/queries/kb/connectors'
import { useMemberEnrollment } from '@/hooks/use-member-enrollment'
import { useDesktopOAuthConnectListener, useOAuthReturnRouter } from '@/hooks/use-oauth-return'

/** One source list combines organization setup, source health, and each member's next action. */
export function OrganizationIntegrations() {
  useOAuthReturnRouter()
  useDesktopOAuthConnectListener()
  const { organization, viewer, searchAccess } = useOrganizationContext()
  const scope: ResourceScope = { kind: 'organization', organizationId: organization.id }
  const sources = useSearchSources(scope)
  const { search, setSearch } = useOrganizationPageFilters()
  const [, setSelectedType] = useQueryState(
    searchSetupParam.key,
    searchSetupParam.parser.withOptions({ history: 'replace' })
  )
  const [, setManagedSource] = useQueryState(
    managedSourceParam.key,
    managedSourceParam.parser.withOptions({ history: 'replace' })
  )
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
  const visibleSources =
    sources.data?.filter((source) =>
      `${connectorDisplayName(source.connectorType)} ${source.sourceDescription}`
        .toLowerCase()
        .includes(query)
    ) ?? []

  return (
    <OrganizationPage
      title='Integrations'
      description='Connect the sources your organization searches'
      action={
        viewer.isAdmin && (searchAccess.memberScoped || searchAccess.sourceMirrored) ? (
          <Chip
            variant='primary'
            leftIcon={Plus}
            onClick={() => {
              setSearch('')
              void setSelectedType('')
            }}
          >
            Add source
          </Chip>
        ) : undefined
      }
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
        ) : sources.isPending ? (
          <SettingsEmptyState variant='inline'>Loading sources…</SettingsEmptyState>
        ) : visibleSources.length > 0 ? (
          visibleSources.map((source) => (
            <SearchSourceRow
              key={source.connectorId}
              source={source}
              scope={scope}
              canAdmin={viewer.isAdmin}
              available={
                source.accessMode === 'members'
                  ? searchAccess.memberScoped
                  : searchAccess.sourceMirrored &&
                    (!source.connectionRequired || searchAccess.memberScoped)
              }
              waiting={enrollment.isAwaiting(source.connectorId)}
              isPending={enrollment.isPending}
              onConnect={() => enrollment.connect(source.knowledgeBaseId, source.connectorId)}
              onManage={() => void setManagedSource(source.connectorId, { history: 'push' })}
            />
          ))
        ) : (
          <SettingsEmptyState variant='inline'>
            {query
              ? 'No matching sources.'
              : viewer.isAdmin
                ? searchAccess.memberScoped || searchAccess.sourceMirrored
                  ? 'Add a source to start indexing documents for Search.'
                  : 'Search sources are not enabled for this organization.'
                : 'Your organization hasn’t added any sources yet. Ask an organization admin to get started.'}
          </SettingsEmptyState>
        )}
        {enrollment.error && (
          <p className='text-[var(--text-error)] text-caption'>{enrollment.error}</p>
        )}
      </div>
      <SearchSourceSetup
        key={`sources:${organization.id}`}
        scope={scope}
        canAdmin={viewer.isAdmin}
        memberAccessAvailable={searchAccess.memberScoped}
        mirroredAccessAvailable={searchAccess.sourceMirrored}
      />
      <OrganizationSlackAccountSetup key={`slack:${organization.id}`} />
    </OrganizationPage>
  )
}
