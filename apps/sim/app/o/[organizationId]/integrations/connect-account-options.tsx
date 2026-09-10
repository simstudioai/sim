'use client'

import { useMemo } from 'react'
import { Chip } from '@sim/emcn'
import type { ResourceScope } from '@/lib/core/resource-scope'
import {
  connectorDisplayName,
  getConnectorAccessAvailability,
  SEARCH_CONNECTORS,
} from '@/lib/sim-search/connectors'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { SourceSetupModal } from '@/app/workspace/[workspaceId]/home/components/search-sources/source-setup-modal'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { SearchSourcePagination } from '@/app/workspace/[workspaceId]/search/components/search-source-pagination'
import { SearchSourceRow } from '@/app/workspace/[workspaceId]/search/components/search-source-row'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useSearchSourceOverview, useSearchSources } from '@/hooks/queries/kb/connectors'
import { organizationAccountsKeys } from '@/hooks/queries/organization-accounts'
import { useSearchIntegrations } from '@/hooks/queries/search-integrations'
import { searchSourceKeys } from '@/hooks/queries/utils/search-source-keys'
import { CONNECTABLE_MEMBERSHIPS, useMemberEnrollment } from '@/hooks/use-member-enrollment'
import { usePermissionConfig } from '@/hooks/use-permission-config'

interface ConnectAccountOptionsProps {
  search?: string
  showEmpty?: boolean
}

/** Approved integrations the viewer can connect to Search with their own account. */
export function ConnectAccountOptions({
  search = '',
  showEmpty = true,
}: ConnectAccountOptionsProps = {}) {
  const { organization, searchAccess } = useOrganizationContext()
  const scope: ResourceScope = { kind: 'organization', organizationId: organization.id }
  const sources = useSearchSources(scope, { search })
  const overview = useSearchSourceOverview(scope)
  const integrations = useSearchIntegrations(organization.id)
  const availability = usePermissionConfig()
  const membershipQueryKeys = useMemo(
    () => [
      searchSourceKeys.list({ kind: 'organization', organizationId: organization.id }),
      organizationAccountsKeys.detail(organization.id),
    ],
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
  const enrollment = useMemberEnrollment({
    membershipQueryKeys,
    connectedConnectorIds,
    directOAuth: true,
  })
  const visibleSources =
    sources.data?.filter(
      (source) =>
        source.connectionRequired &&
        source.enabled &&
        source.approved !== false &&
        source.availability === 'available' &&
        source.viewerMembership !== null &&
        source.viewerMembership !== 'needs_reauth' &&
        CONNECTABLE_MEMBERSHIPS.has(source.viewerMembership) &&
        searchAccess.memberScoped &&
        (source.accessMode === 'members' || searchAccess.sourceMirrored)
    ) ?? []

  const approvedTypes = new Set(
    integrations.data
      ?.filter((integration) => integration.approved)
      .map((integration) => integration.connectorType)
  )
  const configuredTypes = new Set(
    overview.data?.providers.map((provider) => provider.connectorType)
  )
  const sourceChoices = SEARCH_CONNECTORS.filter((connector) => {
    if (
      connector.type === 'slack' ||
      !approvedTypes.has(connector.type) ||
      !connector.meta.name.toLowerCase().includes(search.toLowerCase()) ||
      (configuredTypes.has(connector.type) && connector.setupFields.length === 0)
    )
      return false
    return getConnectorAccessAvailability(connector.meta, availability.integrationAvailability, {
      memberAccessAvailable: searchAccess.memberScoped,
      mirroredAccessAvailable: searchAccess.sourceMirrored,
      oauthServiceAvailability: availability.oauthServiceAvailability,
      isIntegrationAvailabilityReady: availability.isIntegrationAvailabilityReady,
    }).members
  })
  const integrationRows = [
    ...sourceChoices.map((connector) => ({
      kind: 'provider' as const,
      connector,
      name: connector.meta.name,
    })),
    ...visibleSources.map((source) => ({
      kind: 'source' as const,
      source,
      name: connectorDisplayName(source.connectorType),
    })),
  ].sort(
    (a, b) => a.name.localeCompare(b.name) || (a.kind === b.kind ? 0 : a.kind === 'source' ? -1 : 1)
  )
  const failedQuery =
    sources.isError && !sources.isFetchNextPageError
      ? sources
      : overview.isError
        ? overview
        : integrations.isError
          ? integrations
          : null

  return (
    <>
      <div className={RESOURCE_LIST_STACK}>
        {failedQuery ? (
          <SettingsQueryErrorState
            error={failedQuery.error}
            fallback='Could not load sources'
            isRetrying={failedQuery.isFetching}
            onRetry={() => void failedQuery.refetch()}
            variant='inline'
          />
        ) : availability.integrationAvailabilityError ? (
          <SettingsQueryErrorState
            error={availability.integrationAvailabilityError}
            fallback='Could not load connection availability'
            isRetrying={availability.isIntegrationAvailabilityFetching}
            onRetry={() => void availability.refetchIntegrationAvailability()}
            variant='inline'
          />
        ) : sources.isPending ||
          overview.isPending ||
          integrations.isPending ||
          !availability.isIntegrationAvailabilityReady ? (
          <SettingsEmptyState variant='inline'>Loading sources…</SettingsEmptyState>
        ) : visibleSources.length > 0 || sourceChoices.length > 0 || sources.hasNextPage ? (
          <>
            {integrationRows.map((row) => {
              if (row.kind === 'source') {
                const { source } = row
                return (
                  <SearchSourceRow
                    key={source.connectorId}
                    source={source}
                    scope={scope}
                    canAdmin={false}
                    connectLabel='Connect'
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
                )
              }
              const { connector } = row
              const { type, meta } = connector
              const hasSources = configuredTypes.has(type)
              return (
                <SettingsResourceRow
                  key={type}
                  iconVariant='custom'
                  icon={<IntegrationTile blockType={type} icon={meta.icon} />}
                  title={meta.name}
                  description={
                    hasSources
                      ? 'Connect a different site or content scope'
                      : 'Connect your account to search this source'
                  }
                  trailing={
                    <Chip
                      variant='primary'
                      disabled={enrollment.isPending}
                      onClick={() => enrollment.connectSearchSource(scope, connector, undefined)}
                    >
                      Connect
                    </Chip>
                  }
                />
              )
            })}
            <SearchSourcePagination {...sources} />
          </>
        ) : showEmpty ? (
          <SettingsEmptyState variant='inline'>
            {search ? 'No matching integrations.' : 'No integrations are available to connect.'}
          </SettingsEmptyState>
        ) : null}
        {enrollment.error && (
          <p className='text-[var(--text-error)] text-caption'>{enrollment.error}</p>
        )}
      </div>
      {enrollment.setupConnector && (
        <SourceSetupModal
          connector={enrollment.setupConnector}
          isPending={enrollment.isPending}
          error={enrollment.error}
          onClose={enrollment.closeSetup}
          onConnect={(config) =>
            enrollment.connectSource(scope, enrollment.setupConnector!.type, config)
          }
        />
      )}
    </>
  )
}
