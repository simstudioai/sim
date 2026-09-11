'use client'

import type { ReactNode } from 'react'
import { Chip, ChipLink } from '@sim/emcn'
import type { SearchSourceSummary } from '@/lib/api/contracts/knowledge/connectors'
import { type ResourceScope, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { connectorDisplayName } from '@/lib/sim-search/connectors'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { getSearchSourceStatus } from '@/app/workspace/[workspaceId]/search/components/search-source-row-status'
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
  connectLabel?: string
  manageHref?: string
  /** Opens management for the source; only a surface that offers management passes it. */
  onManage?: () => void
  accountActions?: ReactNode
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
  connectLabel = 'Connect account',
  manageHref,
  onManage,
  accountActions,
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
  const status = getSearchSourceStatus({
    source,
    scopeKind: scope.kind,
    supported,
    usable,
    connectable,
    waiting,
  })

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
            {usable &&
              supported &&
              source.enabled &&
              source.approved !== false &&
              !source.viewerEmailVerified && <ChipLink href='/verify'>Verify email</ChipLink>}
            {connectable && (
              <Chip variant='primary' disabled={isPending} onClick={onConnect}>
                {waiting
                  ? 'Open again'
                  : membership === 'needs_reauth'
                    ? 'Reconnect'
                    : connectLabel}
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
            {accountActions}
          </div>
        )
      }
    />
  )
}
