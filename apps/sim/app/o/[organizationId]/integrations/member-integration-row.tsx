'use client'

import { Chip, ChipLink } from '@sim/emcn'
import { organizationRoutes } from '@/lib/navigation/paths'
import { connectorDisplayName } from '@/lib/sim-search/connectors'
import { DisconnectAccountMenu } from '@/app/o/[organizationId]/integrations/disconnect-account-menu'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { getSearchSourceStatus } from '@/app/workspace/[workspaceId]/search/components/search-source-row-status'
import type { RowAction } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import type { useSearchSources } from '@/hooks/queries/kb/connectors'
import {
  CONNECTABLE_MEMBERSHIPS,
  enrollmentActionLabel,
  type useMemberEnrollment,
} from '@/hooks/use-member-enrollment'

interface MemberIntegrationRowProps {
  organizationId: string
  connectorType: string
  configured: boolean
  sources: ReturnType<typeof useSearchSources>
  enrollment: ReturnType<typeof useMemberEnrollment>
  memberAccessAvailable: boolean
  mirroredAccessAvailable: boolean
  onCreate?: () => void
  addLabel?: string
}

/** One flat account row per integration, independent of how many content scopes it indexes. */
export function MemberIntegrationRow({
  organizationId,
  connectorType,
  configured,
  sources,
  enrollment,
  memberAccessAvailable,
  mirroredAccessAvailable,
  onCreate,
  addLabel,
}: MemberIntegrationRowProps) {
  const name = connectorDisplayName(connectorType)
  const meta = CONNECTOR_META_REGISTRY[connectorType]
  const rows = sources.data ?? []
  const accounts = [
    ...new Map(
      rows
        .flatMap((source) => source.viewerAccounts)
        .map((account) => [account.credentialId, account])
    ).values(),
  ]
  const isUsable = (source: (typeof rows)[number]) =>
    source.availability === 'available' &&
    (source.accessMode === 'members'
      ? memberAccessAvailable
      : mirroredAccessAvailable && (!source.connectionRequired || memberAccessAvailable))
  const eligible = rows.filter(
    (source) =>
      source.connectionRequired &&
      source.viewerEmailVerified &&
      source.enabled &&
      source.approved !== false &&
      isUsable(source) &&
      source.viewerMembership !== null &&
      CONNECTABLE_MEMBERSHIPS.has(source.viewerMembership)
  )
  const target =
    eligible.find((source) => source.viewerMembership === 'needs_reauth') ?? eligible[0]
  const hasLoadError = configured && sources.isError && !sources.isFetchNextPageError
  const ready = !configured || (!sources.isPending && !hasLoadError)
  const allCentral =
    rows.length > 0 && !sources.hasNextPage && rows.every((source) => !source.connectionRequired)
  const needsEmailVerification = rows.some(
    (source) =>
      source.enabled && source.approved !== false && isUsable(source) && !source.viewerEmailVerified
  )
  const waiting = target
    ? enrollment.isAwaiting(target.connectorId)
    : enrollment.isAwaitingSource(connectorType)
  const status = (source: (typeof rows)[number]) =>
    getSearchSourceStatus({
      source,
      scopeKind: 'organization',
      supported: meta?.search === true,
      usable: isUsable(source),
      connectable: eligible.includes(source),
      waiting: enrollment.isAwaiting(source.connectorId),
    })
  function description() {
    if (!configured) return waiting ? 'Finish connecting in the other tab' : 'Not connected'
    if (hasLoadError) return 'Could not load connection'
    if (sources.isPending) return 'Loading connection…'
    if (target) {
      if (waiting) return 'Finish connecting in the other tab'
      if (target.viewerMembership === 'needs_reauth') return 'Reconnect your account'
      const hasConnectedContent = rows.some(
        (source) =>
          source.enabled &&
          source.approved !== false &&
          isUsable(source) &&
          (!source.connectionRequired || source.viewerMembership === 'connected')
      )
      return hasConnectedContent ? 'Additional connection required' : 'Not connected'
    }
    if (rows.length === 1 && !sources.hasNextPage) return status(rows[0])
    if (needsEmailVerification) return 'Verify your email'
    if (
      rows.some(
        (source) =>
          !source.enabled ||
          source.approved === false ||
          !isUsable(source) ||
          source.viewerMembership === 'revoked' ||
          (source.connectionRequired && source.viewerMembership === null)
      )
    )
      return 'Some connections need attention'
    if (rows.some((source) => source.hasSyncError || source.viewerFailedDocumentCount > 0))
      return 'Sync needs attention'
    if (rows.some((source) => source.isSyncing)) return 'Indexing'
    if (sources.hasNextPage) return accounts.length ? 'Connected' : 'More connections available'
    if (allCentral) return 'Connected by your organization'
    return accounts.length ? 'Connected' : 'No connected content'
  }
  const actions: RowAction[] = []
  if (configured && ready && sources.hasNextPage)
    actions.push({
      label: sources.isFetchNextPageError ? 'Retry loading connections' : 'Load more connections',
      onSelect: () => void sources.fetchNextPage(),
      disabled: sources.isFetchingNextPage,
    })
  if (configured && ready && !sources.hasNextPage && !allCentral && addLabel && onCreate)
    actions.push({ label: addLabel, onSelect: onCreate, disabled: enrollment.isPending })
  const canConnect = ready && (target || (!configured && onCreate))

  return (
    <SettingsResourceRow
      iconVariant='custom'
      icon={meta ? <IntegrationTile blockType={connectorType} icon={meta.icon} /> : undefined}
      title={name}
      description={description()}
      trailing={
        <div className='flex items-center gap-2'>
          <DisconnectAccountMenu
            organizationId={organizationId}
            integrationName={name}
            accounts={accounts}
            actions={actions}
          />
          {ready && needsEmailVerification && (
            <ChipLink
              href={`/verify?redirectAfter=${encodeURIComponent(organizationRoutes(organizationId).integrations)}`}
            >
              Verify email
            </ChipLink>
          )}
          {hasLoadError && (
            <Chip disabled={sources.isFetching} onClick={() => void sources.refetch()}>
              {sources.isFetching ? 'Retrying…' : 'Retry'}
            </Chip>
          )}
          {canConnect && (
            <Chip
              variant='primary'
              disabled={enrollment.isPending}
              onClick={() =>
                target
                  ? enrollment.connect(target.knowledgeBaseId, target.connectorId)
                  : onCreate?.()
              }
            >
              {target?.viewerMembership
                ? enrollmentActionLabel(target.viewerMembership, waiting)
                : waiting
                  ? 'Open again'
                  : 'Connect'}
            </Chip>
          )}
        </div>
      }
    />
  )
}
