'use client'

import { useMemo } from 'react'
import { Chip, ChipLink } from '@sim/emcn'
import { getAccountSettingsHref } from '@/components/settings/navigation'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { organizationRoutes } from '@/lib/navigation/paths'
import {
  connectorDisplayName,
  getConnectorAccessAvailability,
  SEARCH_CONNECTORS,
  SEARCH_SOURCE_TYPES,
} from '@/lib/sim-search/connectors'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { OrganizationPage } from '@/app/o/[organizationId]/components/organization-page'
import { useOrganizationPageFilters } from '@/app/o/[organizationId]/components/organization-page/use-organization-page-filters'
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
import {
  searchSourceKeys,
  useSearchSourceOverview,
  useSearchSources,
} from '@/hooks/queries/kb/connectors'
import { useSearchIntegrations } from '@/hooks/queries/search-integrations'
import { useDebounce } from '@/hooks/use-debounce'
import { useMemberEnrollment } from '@/hooks/use-member-enrollment'
import { useDesktopOAuthConnectListener, useOAuthReturnRouter } from '@/hooks/use-oauth-return'
import { usePermissionConfig } from '@/hooks/use-permission-config'

/** Every source the organization searches, or only the ones the viewer has connected. */
const TABS = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Mine' },
] as const

/**
 * Personal connections and approved source scopes available to the organization.
 * Administrators can open source management without leaving this journey.
 */
export function OrganizationIntegrations() {
  useOAuthReturnRouter()
  useDesktopOAuthConnectListener()
  const { organization, searchAccess, viewer } = useOrganizationContext()
  const routes = organizationRoutes(organization.id)
  const scope: ResourceScope = { kind: 'organization', organizationId: organization.id }
  const { tab, search } = useOrganizationPageFilters()
  const sourceSearch = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS)
  const sources = useSearchSources(scope, { search: sourceSearch, mine: tab === 'mine' })
  const overview = useSearchSourceOverview(scope)
  const integrations = useSearchIntegrations(organization.id)
  const availability = usePermissionConfig()
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
  const visibleSources = sources.data ?? []

  const approvedTypes = new Set(
    integrations.data
      ?.filter((integration) => integration.approved)
      .map((integration) => integration.connectorType)
  )
  const configuredTypes = new Set(
    overview.data?.providers.map((provider) => provider.connectorType)
  )
  const sourceChoices = mineOnly
    ? []
    : SEARCH_SOURCE_TYPES.filter(
        ([type, meta]) =>
          approvedTypes.has(type) &&
          (!configuredTypes.has(type) ||
            SEARCH_CONNECTORS.some(
              (connector) => connector.type === type && connector.setupFields.length > 0
            )) &&
          meta.name.toLowerCase().includes(query)
      )
  const integrationRows = [
    ...sourceChoices.map(([type, meta]) => ({
      kind: 'provider' as const,
      type,
      meta,
      name: meta.name,
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
    <OrganizationPage
      title='Integrations'
      description='Connect your tools for Sim Search'
      tabs={TABS}
      action={
        <div className='flex items-center gap-2'>
          <ChipLink href={getAccountSettingsHref('connected-accounts')}>Your accounts</ChipLink>
          {viewer.isAdmin && (
            <ChipLink href={routes.settingsSection('integrations')}>Manage sources</ChipLink>
          )}
        </div>
      }
    >
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
              const { type, meta } = row
              const connector = SEARCH_CONNECTORS.find((item) => item.type === type)
              const access = getConnectorAccessAvailability(
                meta,
                availability.integrationAvailability,
                {
                  memberAccessAvailable: searchAccess.memberScoped,
                  mirroredAccessAvailable: searchAccess.sourceMirrored,
                  oauthServiceAvailability: availability.oauthServiceAvailability,
                  isIntegrationAvailabilityReady: availability.isIntegrationAvailabilityReady,
                }
              )
              const canConnect = connector && type !== 'slack' && access.members
              const hasSources = configuredTypes.has(type)
              if (hasSources && !canConnect) return null
              return (
                <SettingsResourceRow
                  key={type}
                  iconVariant='custom'
                  icon={<IntegrationTile blockType={type} icon={meta.icon} />}
                  title={hasSources ? `Add another ${meta.name} source` : meta.name}
                  description={
                    hasSources
                      ? 'Connect a different site or content scope'
                      : canConnect
                        ? 'Connect your account to search this source'
                        : 'An admin needs to finish source setup'
                  }
                  trailing={
                    canConnect ? (
                      <Chip
                        variant='primary'
                        disabled={enrollment.isPending}
                        onClick={() => enrollment.connectSearchSource(scope, connector, undefined)}
                      >
                        {hasSources ? 'Add source' : 'Connect account'}
                      </Chip>
                    ) : undefined
                  }
                />
              )
            })}
            <SearchSourcePagination {...sources} />
          </>
        ) : (
          <SettingsEmptyState variant='inline'>
            {query
              ? 'No matching sources.'
              : mineOnly
                ? 'You haven’t connected any sources yet.'
                : viewer.isAdmin
                  ? 'Your organization hasn’t added any sources yet. Open Manage sources to get started.'
                  : 'Your organization hasn’t added any sources yet. Ask an organization admin to get started.'}
          </SettingsEmptyState>
        )}
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
    </OrganizationPage>
  )
}
