'use client'

import { useMemo } from 'react'
import { toast } from '@sim/emcn'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { getSearchConnectionLabels } from '@/lib/sim-search/connection-labels'
import {
  getConnectorAccessAvailability,
  SEARCH_CONNECTORS,
  SEARCH_SOURCE_TYPES,
  type SearchConnector,
} from '@/lib/sim-search/connectors'
import { MemberIntegrationRow } from '@/app/o/[organizationId]/integrations/member-integration-row'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { SourceSetupModal } from '@/app/workspace/[workspaceId]/home/components/search-sources/source-setup-modal'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { RESOURCE_LIST_STACK } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useSearchSourceOverview, useSearchSources } from '@/hooks/queries/kb/connectors'
import { organizationAccountsKeys } from '@/hooks/queries/organization-accounts'
import { useSearchIntegrations } from '@/hooks/queries/search-integrations'
import { searchSourceKeys } from '@/hooks/queries/utils/search-source-keys'
import { useMemberEnrollment } from '@/hooks/use-member-enrollment'
import { usePermissionConfig } from '@/hooks/use-permission-config'

interface MemberIntegrationsListProps {
  search?: string
  showEmpty?: boolean
}

/** Provider existence comes from the complete overview; account status uses bounded source pages. */
export function MemberIntegrationsList({
  search = '',
  showEmpty = true,
}: MemberIntegrationsListProps = {}) {
  const { organization, searchAccess } = useOrganizationContext()
  const scope: ResourceScope = { kind: 'organization', organizationId: organization.id }
  const overview = useSearchSourceOverview(scope)
  const integrations = useSearchIntegrations(organization.id)
  const availability = usePermissionConfig()
  const configured = new Map(
    overview.data?.providers.map((provider) => [provider.connectorType, provider])
  )
  const approved = new Set(
    integrations.data
      ?.filter((integration) => integration.approved)
      .map((integration) => integration.connectorType)
  )
  const providers = SEARCH_SOURCE_TYPES.flatMap(([type, meta]) => {
    const connector = SEARCH_CONNECTORS.find((entry) => entry.type === type)
    const canCreate = Boolean(
      connector &&
        type !== 'slack' &&
        approved.has(type) &&
        getConnectorAccessAvailability(meta, availability.integrationAvailability, {
          memberAccessAvailable: searchAccess.memberScoped,
          mirroredAccessAvailable: searchAccess.sourceMirrored,
          oauthServiceAvailability: availability.oauthServiceAvailability,
          isIntegrationAvailabilityReady: availability.isIntegrationAvailabilityReady,
        }).members
    )
    return configured.has(type) || canCreate
      ? [{ type, meta, connector, canCreate, configured: configured.has(type) }]
      : []
  })
  const failedQuery = overview.isError ? overview : integrations.isError ? integrations : null
  const visible = providers.filter((provider) =>
    provider.meta.name.toLowerCase().includes(search.trim().toLowerCase())
  )

  return (
    <>
      <div className={RESOURCE_LIST_STACK}>
        {failedQuery ? (
          <SettingsQueryErrorState
            error={failedQuery.error}
            fallback='Could not load integrations'
            isRetrying={failedQuery.isFetching}
            onRetry={() => void failedQuery.refetch()}
            variant='inline'
          />
        ) : overview.isPending || integrations.isPending ? (
          <SettingsEmptyState variant='inline'>Loading integrations…</SettingsEmptyState>
        ) : (
          <>
            {availability.integrationAvailabilityError && (
              <SettingsQueryErrorState
                error={availability.integrationAvailabilityError}
                fallback='Could not load connection availability'
                isRetrying={availability.isIntegrationAvailabilityFetching}
                onRetry={() => void availability.refetchIntegrationAvailability()}
                variant='inline'
              />
            )}
            {providers.map((provider) => (
              <div key={provider.type} hidden={!visible.includes(provider)}>
                <MemberIntegration
                  scope={scope}
                  connectorType={provider.type}
                  configured={provider.configured}
                  connector={provider.connector}
                  canCreate={provider.canCreate}
                  memberAccessAvailable={searchAccess.memberScoped}
                  mirroredAccessAvailable={searchAccess.sourceMirrored}
                />
              </div>
            ))}
            {showEmpty && visible.length === 0 && !availability.integrationAvailabilityError && (
              <SettingsEmptyState variant='inline'>
                {!availability.isIntegrationAvailabilityReady
                  ? 'Loading integrations…'
                  : search
                    ? 'No matching integrations.'
                    : 'No integrations are available to connect.'}
              </SettingsEmptyState>
            )}
          </>
        )}
      </div>
    </>
  )
}

interface MemberIntegrationProps {
  scope: ResourceScope & { kind: 'organization' }
  connectorType: string
  connector?: SearchConnector
  configured: boolean
  canCreate: boolean
  memberAccessAvailable: boolean
  mirroredAccessAvailable: boolean
}

/** Each provider loads one bounded page; additional content is loaded explicitly. */
function MemberIntegration({
  scope,
  connectorType,
  connector,
  configured,
  canCreate,
  memberAccessAvailable,
  mirroredAccessAvailable,
}: MemberIntegrationProps) {
  const sources = useSearchSources(scope, { connectorType, enabled: configured })
  const membershipQueryKeys = useMemo(
    () => [searchSourceKeys.list(scope), organizationAccountsKeys.detail(scope.organizationId)],
    [scope.organizationId]
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
    onConnectionError: toast.error,
  })
  return (
    <>
      <MemberIntegrationRow
        organizationId={scope.organizationId}
        connectorType={connectorType}
        configured={configured}
        sources={sources}
        enrollment={enrollment}
        memberAccessAvailable={memberAccessAvailable}
        mirroredAccessAvailable={mirroredAccessAvailable}
        onCreate={
          canCreate && connector
            ? () => enrollment.connectSearchSource(scope, connector, undefined)
            : undefined
        }
        addLabel={
          connector?.setupFields.length
            ? getSearchConnectionLabels(connectorType, 'members').add
            : undefined
        }
      />
      {enrollment.setupConnector && (
        <SourceSetupModal
          organizationId={scope.organizationId}
          connector={enrollment.setupConnector}
          isPending={enrollment.isPending}
          onClose={enrollment.closeSetup}
          onConnect={(config) =>
            enrollment.connectSource(scope, enrollment.setupConnector!.type, config)
          }
        />
      )}
    </>
  )
}
