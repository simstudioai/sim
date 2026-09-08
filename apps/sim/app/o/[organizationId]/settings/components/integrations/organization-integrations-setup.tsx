'use client'

import { useMemo, useState } from 'react'
import { Chip, ChipConfirmModal, ChipModalError, Switch } from '@sim/emcn'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { SettingsPanel } from '@/components/settings/settings-panel'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { organizationRoutes } from '@/lib/navigation/paths'
import { getConnectorAccessAvailability, SEARCH_SOURCE_TYPES } from '@/lib/sim-search/connectors'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { OrganizationSlackAccountSetup } from '@/app/o/[organizationId]/settings/components/integrations/slack-account-setup'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { SearchSourcePagination } from '@/app/workspace/[workspaceId]/search/components/search-source-pagination'
import { SearchSourceRow } from '@/app/workspace/[workspaceId]/search/components/search-source-row'
import { SearchSourceSetup } from '@/app/workspace/[workspaceId]/search/components/search-source-setup'
import { searchSetupParam } from '@/app/workspace/[workspaceId]/search/search-params'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { searchSourceKeys, useSearchSources } from '@/hooks/queries/kb/connectors'
import {
  useSearchIntegrations,
  useUpdateSearchIntegration,
} from '@/hooks/queries/search-integrations'
import { useDebounce } from '@/hooks/use-debounce'
import { useMemberEnrollment } from '@/hooks/use-member-enrollment'
import { usePermissionConfig } from '@/hooks/use-permission-config'

/** A change of approval the admin has asked for but not yet confirmed. */
interface PendingApproval {
  type: string
  name: string
  approve: boolean
}

/**
 * Organization approval is independent of source setup. Each integration lists
 * all of its configured sources using the same rows members see, with management
 * actions for admins. Setup and OAuth returns stay within this settings section.
 */
export function OrganizationIntegrationsSetup() {
  const { organization, viewer, searchAccess } = useOrganizationContext()
  const scope: ResourceScope = { kind: 'organization', organizationId: organization.id }
  const [search, setSearch] = useSettingsSearch()
  const sourceSearch = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS)
  const sources = useSearchSources(scope, { search: sourceSearch })
  const integrations = useSearchIntegrations(organization.id)
  const updateApproval = useUpdateSearchIntegration()
  const {
    integrationAvailability,
    oauthServiceAvailability,
    isIntegrationAvailabilityReady,
    isIntegrationAvailabilityFetching,
    integrationAvailabilityError,
    refetchIntegrationAvailability,
  } = usePermissionConfig()
  const [, setSelectedType] = useQueryState(
    searchSetupParam.key,
    searchSetupParam.parser.withOptions({ history: 'replace' })
  )
  const router = useRouter()
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
  const enabled = searchAccess.memberScoped || searchAccess.sourceMirrored
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null)
  const approvals = new Map(
    integrations.data?.map((integration) => [integration.connectorType, integration.approved])
  )
  const failedQuery =
    sources.isError && !sources.isFetchNextPageError
      ? sources
      : integrations.isError
        ? integrations
        : null

  const visibleProviders = SEARCH_SOURCE_TYPES.filter(
    ([type, meta]) =>
      !sourceSearch ||
      meta.name.toLowerCase().includes(sourceSearch.toLowerCase()) ||
      sources.data?.some((source) => source.connectorType === type)
  )

  const confirmApproval = () => {
    if (!pendingApproval) return
    updateApproval.mutate(
      {
        organizationId: organization.id,
        connectorType: pendingApproval.type,
        approved: pendingApproval.approve,
      },
      {
        onSuccess: () => setPendingApproval(null),
      }
    )
  }

  if (!enabled) {
    return (
      <SettingsEmptyState variant='inline'>
        Search sources are not enabled for this organization.
      </SettingsEmptyState>
    )
  }

  return (
    <SettingsPanel
      search={{
        value: search,
        onChange: setSearch,
        placeholder: 'Search providers and sources...',
      }}
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
        ) : integrationAvailabilityError ? (
          <SettingsQueryErrorState
            error={integrationAvailabilityError}
            fallback='Could not load connection availability'
            isRetrying={isIntegrationAvailabilityFetching}
            onRetry={() => void refetchIntegrationAvailability()}
            variant='inline'
          />
        ) : (
          visibleProviders.map(([type, meta]) => {
            const configured = sources.data?.filter((source) => source.connectorType === type) ?? []
            const { admin: central, members } = getConnectorAccessAvailability(
              meta,
              integrationAvailability,
              {
                memberAccessAvailable: searchAccess.memberScoped,
                mirroredAccessAvailable: searchAccess.sourceMirrored,
                oauthServiceAvailability,
                isIntegrationAvailabilityReady,
              }
            )
            const available = central || members
            const approved = approvals.get(type) ?? false
            const loading = sources.isPending || integrations.isPending
            return (
              <div key={type}>
                <SettingsResourceRow
                  iconVariant='custom'
                  icon={<IntegrationTile blockType={type} icon={meta.icon} />}
                  title={meta.name}
                  description={
                    !loading && !available ? 'Connection setup is unavailable' : undefined
                  }
                  trailing={
                    <div className='flex items-center gap-2'>
                      {available && (
                        <Chip
                          disabled={loading || !viewer.isAdmin}
                          variant='primary'
                          onClick={() => void setSelectedType(searchSetupParam.parser.parse(type))}
                        >
                          Set up
                        </Chip>
                      )}
                      <Switch
                        aria-label={`Approve ${meta.name} for Sim Search`}
                        checked={approved}
                        disabled={loading || updateApproval.isPending || !viewer.isAdmin}
                        onCheckedChange={(approve) => {
                          updateApproval.reset()
                          setPendingApproval({ type, name: meta.name, approve })
                        }}
                      />
                    </div>
                  }
                />
                {configured.map((source) => (
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
                    onManage={() =>
                      router.push(
                        organizationRoutes(organization.id).searchSource(source.connectorId)
                      )
                    }
                  />
                ))}
              </div>
            )
          })
        )}
        {!failedQuery && !integrationAvailabilityError && (
          <>
            {!sources.isPending && !sources.hasNextPage && visibleProviders.length === 0 && (
              <SettingsEmptyState variant='inline'>
                No providers or sources match your search
              </SettingsEmptyState>
            )}
            <SearchSourcePagination {...sources} />
          </>
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
      <ChipConfirmModal
        open={pendingApproval !== null}
        onOpenChange={(open) => {
          if (!open && !updateApproval.isPending) setPendingApproval(null)
        }}
        title={
          pendingApproval?.approve
            ? `Approve ${pendingApproval.name}?`
            : `Deactivate ${pendingApproval?.name}?`
        }
        text={
          pendingApproval?.approve
            ? [
                'You are approving ',
                { text: pendingApproval.name, bold: true },
                ' for your organization in Sim Search. Members can connect their own accounts when supported. Sources that need a service account or custom app still require setup.',
              ]
            : [
                'Are you sure you want to deactivate ',
                { text: pendingApproval?.name ?? '', bold: true },
                ' for your organization? Its indexed content will be unavailable in Search, Assistant, and MCP until approved again. Source setup and connected accounts are preserved.',
              ]
        }
        confirm={{
          label: pendingApproval?.approve ? 'Approve' : 'Deactivate',
          variant: pendingApproval?.approve ? 'primary' : 'destructive',
          onClick: confirmApproval,
          pending: updateApproval.isPending,
          pendingLabel: 'Saving…',
        }}
      >
        {updateApproval.error && <ChipModalError>{updateApproval.error.message}</ChipModalError>}
      </ChipConfirmModal>
    </SettingsPanel>
  )
}
