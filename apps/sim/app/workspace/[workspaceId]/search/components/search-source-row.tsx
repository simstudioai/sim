'use client'

import { Chip, ChipLink } from '@sim/emcn'
import type { SearchSourceSummary } from '@/lib/api/contracts/knowledge/connectors'
import { type ResourceScope, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { connectorDisplayName } from '@/lib/sim-search/connectors'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import { CONNECTABLE_MEMBERSHIPS } from '@/hooks/use-member-enrollment'

interface SearchSourceRowProps {
  source: SearchSourceSummary
  workspaceId?: string
  scope?: ResourceScope
  canAdmin: boolean
  available: boolean
  waiting: boolean
  isPending: boolean
  onConnect: () => void
  manageHref?: string
  /** Opens management for the source; only a surface that offers management passes it. */
  onManage?: () => void
}

/** Source health and the viewer's connection are separate; only the viewer's next action is primary. */
export function SearchSourceRow({
  source,
  workspaceId,
  scope: explicitScope,
  canAdmin,
  available,
  waiting,
  isPending,
  onConnect,
  manageHref,
  onManage,
}: SearchSourceRowProps) {
  const scope = explicitScope ?? resourceScopeFromOwner({ workspaceId })
  const meta = CONNECTOR_META_REGISTRY[source.connectorType]
  const name = connectorDisplayName(source.connectorType)
  const membership = source.viewerMembership
  const usable = available && source.availability === 'available'
  const supported = meta?.search === true
  const managementHref = canAdmin ? manageHref : undefined
  const connectable =
    usable &&
    supported &&
    source.enabled &&
    source.approved !== false &&
    source.viewerEmailVerified &&
    source.connectionRequired &&
    membership !== null &&
    CONNECTABLE_MEMBERSHIPS.has(membership)
  const count = `${source.viewerDocumentCount} searchable document${source.viewerDocumentCount === 1 ? '' : 's'}`
  let status: string
  if (!supported) status = 'Available in its knowledge base'
  else if (source.approved === false) status = 'Deactivated by an organization admin'
  else if (!usable) status = `Not available in this ${scope.kind}`
  else if (!source.enabled) status = 'Syncing is paused'
  else if (!source.viewerEmailVerified || membership === 'unverified_email')
    status = 'Verify your email to search this source'
  else if (membership === 'revoked') status = 'Your access was removed by an admin'
  else if (source.connectionRequired && membership === null) status = 'Needs admin attention'
  else if (connectable)
    status = waiting
      ? 'Finish connecting in the other tab'
      : membership === 'needs_reauth'
        ? 'Your account needs to be reconnected'
        : 'Connect your account to search this source'
  else if (source.hasSyncError)
    status =
      source.viewerDocumentCount > 0
        ? `Sync needs attention · ${count}`
        : 'Sync needs admin attention'
  else if (source.viewerFailedDocumentCount > 0)
    status = `${source.viewerFailedDocumentCount} document${source.viewerFailedDocumentCount === 1 ? '' : 's'} couldn't be indexed${source.viewerDocumentCount > 0 ? ` · ${count}` : ''}`
  else if (source.isSyncing)
    status = source.viewerDocumentCount > 0 ? `Indexing · ${count}` : 'Indexing'
  else if (source.viewerDocumentCount > 0) status = count
  else status = source.lastSyncAt ? 'No searchable documents yet' : 'Waiting for the first sync'

  return (
    <SettingsResourceRow
      iconVariant='custom'
      icon={
        meta ? <IntegrationTile blockType={source.connectorType} icon={meta.icon} /> : undefined
      }
      title={name}
      description={[source.sourceDescription, status].filter(Boolean).join(' · ')}
      href={managementHref}
      clickLabel={managementHref ? `Open ${source.sourceDescription || name}` : undefined}
      navigable={Boolean(managementHref)}
      trailing={
        !supported && scope.kind === 'workspace' ? (
          <ChipLink href={`/workspace/${scope.workspaceId}/knowledge/${source.knowledgeBaseId}`}>
            {canAdmin ? 'Manage' : 'View'}
          </ChipLink>
        ) : (
          <div className='flex items-center gap-2'>
            {usable && supported && !source.viewerEmailVerified && (
              <ChipLink href='/verify'>Verify email</ChipLink>
            )}
            {connectable && (
              <Chip variant='primary' disabled={isPending} onClick={onConnect}>
                {waiting
                  ? 'Open again'
                  : membership === 'needs_reauth'
                    ? 'Reconnect'
                    : 'Connect account'}
              </Chip>
            )}
            {canAdmin &&
              !managementHref &&
              onManage &&
              (connectable ? (
                <RowActionsMenu
                  label={`${name} source actions`}
                  actions={[{ label: 'Manage source', onSelect: onManage }]}
                />
              ) : (
                <Chip onClick={onManage}>Manage</Chip>
              ))}
          </div>
        )
      }
    />
  )
}
