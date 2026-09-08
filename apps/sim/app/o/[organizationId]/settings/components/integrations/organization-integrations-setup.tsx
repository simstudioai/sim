'use client'

import { useMemo, useState } from 'react'
import { Chip, ChipConfirmModal, Switch } from '@sim/emcn'
import { useQueryState } from 'nuqs'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { getConnectorAccessAvailability, SEARCH_SOURCE_TYPES } from '@/lib/sim-search/connectors'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { OrganizationSlackAccountSetup } from '@/app/o/[organizationId]/settings/components/integrations/slack-account-setup'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
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
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { searchSourceKeys, useSearchSources } from '@/hooks/queries/kb/connectors'
import { useMemberEnrollment } from '@/hooks/use-member-enrollment'
import { usePermissionConfig } from '@/hooks/use-permission-config'

/** A change of approval the admin has asked for but not yet confirmed. */
interface PendingApproval {
  type: string
  name: string
  approve: boolean
}

/**
 * The organization admin's Sim Search setup: every source the organization can
 * search, listed once. A source already set up is the same row members see on
 * Integrations, with Manage; one not yet set up offers Set up, which opens the
 * same setup flow the source picker did. The setup and Slack account flows are
 * mounted here, so an OAuth detour returns to this section.
 */
export function OrganizationIntegrationsSetup() {
  const { organization, viewer, searchAccess } = useOrganizationContext()
  const scope: ResourceScope = { kind: 'organization', organizationId: organization.id }
  const sources = useSearchSources(scope)
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
  const sourceByType = useMemo(
    () => new Map(sources.data?.map((source) => [source.connectorType, source])),
    [sources.data]
  )
  const enabled = searchAccess.memberScoped || searchAccess.sourceMirrored

  /**
   * Which sources the organization has approved for Sim Search. Held here until
   * approval is recorded server-side; the switch never moves until the admin
   * confirms what the change means.
   */
  const [approved, setApproved] = useState<Record<string, boolean>>({})
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null)

  const confirmApproval = () => {
    if (!pendingApproval) return
    setApproved((current) => ({ ...current, [pendingApproval.type]: pendingApproval.approve }))
    setPendingApproval(null)
  }

  if (!enabled) {
    return (
      <SettingsEmptyState variant='inline'>
        Search sources are not enabled for this organization.
      </SettingsEmptyState>
    )
  }

  return (
    <>
      <div className={RESOURCE_LIST_STACK}>
        {sources.isError ? (
          <SettingsQueryErrorState
            error={sources.error}
            fallback='Could not load sources'
            isRetrying={sources.isFetching}
            onRetry={() => void sources.refetch()}
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
          SEARCH_SOURCE_TYPES.map(([type, meta]) => {
            const source = sourceByType.get(type)
            if (source) {
              return (
                <SearchSourceRow
                  key={type}
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
              )
            }
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
            return (
              <SettingsResourceRow
                key={type}
                iconVariant='custom'
                icon={<IntegrationTile blockType={type} icon={meta.icon} />}
                title={meta.name}
                description={
                  !available
                    ? 'Not available in this organization'
                    : central
                      ? meta.adminSetupHint
                      : undefined
                }
                disabled={!available}
                trailing={
                  available ? (
                    <div className='flex items-center gap-2'>
                      <Chip
                        variant='primary'
                        onClick={() => void setSelectedType(searchSetupParam.parser.parse(type))}
                      >
                        Set up
                      </Chip>
                      <Switch
                        aria-label={`Approve ${meta.name} for Sim Search`}
                        checked={approved[type] ?? false}
                        onCheckedChange={(approve) =>
                          setPendingApproval({ type, name: meta.name, approve })
                        }
                      />
                    </div>
                  ) : undefined
                }
              />
            )
          })
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
          if (!open) setPendingApproval(null)
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
                ' for your organization in Sim Search. Members will be able to connect their accounts and search what it indexes.',
              ]
            : [
                'Are you sure you want to deactivate ',
                { text: pendingApproval?.name ?? '', bold: true },
                ' for your organization? Members will lose access to everything it indexed in Sim Search until it is approved again.',
              ]
        }
        confirm={{
          label: pendingApproval?.approve ? 'Approve' : 'Deactivate',
          variant: pendingApproval?.approve ? 'primary' : 'destructive',
          onClick: confirmApproval,
        }}
      />
    </>
  )
}
