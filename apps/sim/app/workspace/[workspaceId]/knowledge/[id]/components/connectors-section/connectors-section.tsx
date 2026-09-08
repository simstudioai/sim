'use client'

import { useState } from 'react'
import { Badge, Chip, cn, OverflowText, Tooltip } from '@sim/emcn'
import { ChevronDown, ChevronUp, CircleAlert, Loader, Users } from '@sim/emcn/icons'
import { format, formatDistanceToNow, isPast } from 'date-fns'
import type { ConnectorData } from '@/lib/api/contracts/knowledge/connectors'
import { type ResourceScope, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { describeSearchSource } from '@/lib/sim-search/source-identity'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { ConnectorActions } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/connector-actions'
import { ConnectorRecovery } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/connector-recovery'
import { ConnectorSyncHistory } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/connector-sync-history'
import { getConnectorSyncState } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/connector-sync-state'
import { EditConnectorModal } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/edit-connector-modal'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'

interface ConnectorsSectionProps {
  scope?: ResourceScope
  workspaceId?: string
  knowledgeBaseId: string
  isSearchIndex?: boolean
  connectors: ConnectorData[]
  isLoading: boolean
  canEdit: boolean
  className?: string
}

const STATUS_CONFIG = {
  active: { label: 'Active', variant: 'green' as const },
  pending: { label: 'Queued', variant: 'blue' as const },
  syncing: { label: 'Syncing', variant: 'amber' as const },
  error: { label: 'Error', variant: 'red' as const },
  paused: { label: 'Paused', variant: 'gray' as const },
  disabled: { label: 'Disabled', variant: 'orange' as const },
} as const

export function ConnectorsSection({
  workspaceId,
  scope: explicitScope,
  knowledgeBaseId,
  isSearchIndex = false,
  connectors,
  isLoading,
  canEdit,
  className,
}: ConnectorsSectionProps) {
  const scope = explicitScope ?? resourceScopeFromOwner({ workspaceId })
  const [editingConnector, setEditingConnector] = useState<ConnectorData | null>(null)
  if (connectors.length === 0 && !canEdit && !isLoading) return null

  return (
    <div className={cn('mt-4', className)}>
      {isLoading ? (
        <div className='mt-2' />
      ) : connectors.length === 0 ? (
        <p className='mt-2 text-[var(--text-muted)] text-small'>
          No connected sources yet. Connect an external source to automatically sync documents.
        </p>
      ) : (
        <div className='mt-2 flex flex-col gap-0.5'>
          {connectors.map((connector) => (
            <ConnectorCard
              key={connector.id}
              connector={connector}
              scope={scope}
              knowledgeBaseId={knowledgeBaseId}
              canEdit={canEdit}
              isSearchIndex={isSearchIndex}
              onEdit={() => setEditingConnector(connector)}
            />
          ))}
        </div>
      )}
      {editingConnector && (
        <EditConnectorModal
          scope={scope}
          open
          onOpenChange={(open) => !open && setEditingConnector(null)}
          knowledgeBaseId={knowledgeBaseId}
          isSearchIndex={isSearchIndex}
          connector={editingConnector}
        />
      )}
    </div>
  )
}

interface ConnectorCardProps {
  connector: ConnectorData
  scope: ResourceScope
  knowledgeBaseId: string
  canEdit: boolean
  isSearchIndex: boolean
  onEdit: () => void
}

function ConnectorCard({
  connector,
  scope,
  knowledgeBaseId,
  canEdit,
  isSearchIndex,
  onEdit,
}: ConnectorCardProps) {
  const [expanded, setExpanded] = useState(false)
  const connectorDef = CONNECTOR_META_REGISTRY[connector.connectorType]
  const sourceDescription = connectorDef
    ? describeSearchSource(connectorDef, connector.sourceConfig)
    : ''
  const Icon = connectorDef?.icon
  const { syncsPerMember, syncInFlight, effectiveStatus, lastSyncAt, nextSyncAt, lastSyncError } =
    getConnectorSyncState(connector)
  const statusConfig =
    STATUS_CONFIG[effectiveStatus as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.active

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-transparent transition-colors duration-100',
        expanded
          ? 'border-[var(--border-muted)] bg-[var(--surface-2)]'
          : 'hover-hover:bg-[var(--surface-active)]'
      )}
    >
      <div className='flex items-center justify-between gap-2 px-2 py-2'>
        <div className='flex min-w-0 items-center gap-2.5'>
          {Icon && <IntegrationTile blockType={connector.connectorType} icon={Icon} />}
          <div className='flex min-w-0 flex-col gap-0.5'>
            <div className='flex min-w-0 items-center gap-2'>
              <span className='flex min-w-0 items-center gap-1.5 text-[var(--text-primary)] text-small'>
                <OverflowText label={connectorDef?.name || connector.connectorType} />
                {syncInFlight && <Loader className='size-3 text-[var(--text-muted)]' animate />}
              </span>
              <Badge variant={statusConfig.variant} size='sm' dot className='shrink-0'>
                {statusConfig.label}
              </Badge>
              {syncsPerMember && (
                <Badge variant='gray' size='sm' icon={Users} className='shrink-0'>
                  Per member
                </Badge>
              )}
            </div>
            {sourceDescription && (
              <span className='min-w-0 text-[var(--text-muted)] text-xs'>
                <OverflowText label={sourceDescription} />
              </span>
            )}
            <div className='flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[var(--text-muted)] text-xs'>
              {lastSyncAt && (
                <span>Last sync: {format(new Date(lastSyncAt), 'MMM d, h:mm a')}</span>
              )}
              {!syncsPerMember && connector.lastSyncDocCount !== null && (
                <>
                  <span>·</span>
                  <span>{connector.lastSyncDocCount} docs</span>
                </>
              )}
              {nextSyncAt && connector.status === 'active' && !syncInFlight && (
                <>
                  <span>·</span>
                  <span>
                    Next sync:{' '}
                    {isPast(new Date(nextSyncAt))
                      ? 'pending'
                      : formatDistanceToNow(new Date(nextSyncAt), { addSuffix: true })}
                  </span>
                </>
              )}
              {lastSyncError && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <CircleAlert className='size-3 text-[var(--text-error)]' />
                  </Tooltip.Trigger>
                  <Tooltip.Content>{lastSyncError}</Tooltip.Content>
                </Tooltip.Root>
              )}
              {connector.accessRewritePending && (
                <>
                  <span>·</span>
                  <span className='flex items-center gap-1'>
                    <Loader className='size-3' animate />
                    Updating access
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className='flex shrink-0 items-center gap-0.5'>
          <ConnectorActions
            connector={connector}
            knowledgeBaseId={knowledgeBaseId}
            canEdit={canEdit}
            onEdit={onEdit}
          />
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Chip
                onClick={() => setExpanded((prev) => !prev)}
                aria-label={expanded ? 'Hide history' : 'Sync history'}
                aria-expanded={expanded}
                leftIcon={expanded ? ChevronUp : ChevronDown}
              />
            </Tooltip.Trigger>
            <Tooltip.Content>{expanded ? 'Hide history' : 'Sync history'}</Tooltip.Content>
          </Tooltip.Root>
        </div>
      </div>
      <ConnectorRecovery
        connector={connector}
        scope={scope}
        knowledgeBaseId={knowledgeBaseId}
        isSearchIndex={isSearchIndex}
        canEdit={canEdit}
        onEdit={onEdit}
      />
      {expanded && (
        <div className='border-[var(--border-muted)] border-t px-2 py-2'>
          <ConnectorSyncHistory connector={connector} knowledgeBaseId={knowledgeBaseId} />
        </div>
      )}
    </div>
  )
}
