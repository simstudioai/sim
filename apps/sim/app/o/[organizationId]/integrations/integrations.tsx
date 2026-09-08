'use client'

import { useMemo } from 'react'
import { Chip } from '@sim/emcn'
import type { ResourceScope } from '@/lib/core/resource-scope'
import {
  connectorDisplayName,
  getConnectorAccessAvailability,
  SEARCH_CONNECTORS,
  SEARCH_SOURCE_TYPES,
} from '@/lib/sim-search/connectors'
import { OrganizationPage } from '@/app/o/[organizationId]/components/organization-page'
import { useOrganizationPageFilters } from '@/app/o/[organizationId]/components/organization-page/use-organization-page-filters'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { SourceSetupModal } from '@/app/workspace/[workspaceId]/home/components/search-sources/source-setup-modal'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { SearchSourceRow } from '@/app/workspace/[workspaceId]/search/components/search-source-row'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { searchSourceKeys, useSearchSources } from '@/hooks/queries/kb/connectors'
import { useSearchIntegrations } from '@/hooks/queries/search-integrations'
import { useMemberEnrollment } from '@/hooks/use-member-enrollment'
import { useDesktopOAuthConnectListener, useOAuthReturnRouter } from '@/hooks/use-oauth-return'
import { usePermissionConfig } from '@/hooks/use-permission-config'

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
  const integrations = useSearchIntegrations(organization.id)
  const availability = usePermissionConfig()
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

  const approvedTypes = new Set(
    integrations.data
      ?.filter((integration) => integration.approved)
      .map((integration) => integration.connectorType)
  )
  const configuredTypes = new Set(sources.data?.map((source) => source.connectorType))
  const unconfigured = mineOnly
    ? []
    : SEARCH_SOURCE_TYPES.filter(
        ([type, meta]) =>
          approvedTypes.has(type) &&
          !configuredTypes.has(type) &&
          meta.name.toLowerCase().includes(query)
      )
  const failedQuery = sources.isError ? sources : integrations.isError ? integrations : null

  return (
    <OrganizationPage
      title='Integrations'
      description='Connect your tools for Sim Search'
      tabs={TABS}
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
        ) : visibleSources.length > 0 || unconfigured.length > 0 ? (
          <>
            {unconfigured.map(([type, meta]) => {
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
              return (
                <SettingsResourceRow
                  key={type}
                  iconVariant='custom'
                  icon={<IntegrationTile blockType={type} icon={meta.icon} />}
                  title={meta.name}
                  description={
                    canConnect
                      ? 'Approved · Connect your account to search this source'
                      : 'Approved · An admin needs to finish source setup'
                  }
                  trailing={
                    canConnect ? (
                      <Chip
                        variant='primary'
                        disabled={enrollment.isPending}
                        onClick={() => enrollment.connectSearchSource(scope, connector, undefined)}
                      >
                        Connect account
                      </Chip>
                    ) : undefined
                  }
                />
              )
            })}
            {visibleSources.map((source) => (
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
            ))}
          </>
        ) : sources.isPending || integrations.isPending ? null : (
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
