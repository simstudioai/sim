'use client'

import { useId, useRef, useState } from 'react'
import { Badge, Chip, cn } from '@sim/emcn'
import { Loader, Users } from '@sim/emcn/icons'
import { format, formatDistanceToNow, isPast } from 'date-fns'
import type { ConnectorData } from '@/lib/api/contracts/knowledge/connectors'
import { type ResourceScope, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { describeSearchSource } from '@/lib/sim-search/source-identity'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import {
  ConnectorActionFeedback,
  ConnectorActions,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/connector-actions'
import { ConnectorRecovery } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/connector-recovery'
import { ConnectorSyncHistory } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/connector-sync-history'
import { getConnectorSyncState } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/connector-sync-state'
import { useConnectorActions } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/use-connector-actions'
import { EditConnectorModal } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/edit-connector-modal'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
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

  return (
    <div className={cn('mt-4', className)}>
      {isLoading ? (
        <SettingsEmptyState variant='inline'>Loading connections…</SettingsEmptyState>
      ) : connectors.length === 0 ? (
        <SettingsEmptyState variant='inline'>No connected sources yet.</SettingsEmptyState>
      ) : (
        <div className='divide-y divide-[var(--border)] px-2'>
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
  const actionsTriggerRef = useRef<HTMLButtonElement>(null)
  const actions = useConnectorActions({ connector, knowledgeBaseId, canEdit, onEdit })
  const historyId = useId()
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
  const syncDetails = [
    lastSyncAt && `Last sync: ${format(new Date(lastSyncAt), 'MMM d, h:mm a')}`,
    !syncsPerMember && connector.lastSyncDocCount !== null && `${connector.lastSyncDocCount} docs`,
    nextSyncAt &&
      connector.status === 'active' &&
      !syncInFlight &&
      `Next sync: ${
        isPast(new Date(nextSyncAt))
          ? 'pending'
          : formatDistanceToNow(new Date(nextSyncAt), { addSuffix: true })
      }`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className='flex min-w-0 flex-col gap-2 py-2 first:pt-0 last:pb-0'>
      <SettingsResourceRow
        icon={Icon && <IntegrationTile blockType={connector.connectorType} icon={Icon} />}
        iconVariant='custom'
        title={connectorDef?.name || connector.connectorType}
        description={sourceDescription || undefined}
        badge={
          <>
            <Badge variant={statusConfig.variant} size='sm' dot>
              {statusConfig.label}
            </Badge>
            {syncsPerMember && (
              <Badge variant='gray' size='sm' icon={Users}>
                Per member
              </Badge>
            )}
          </>
        }
        trailing={
          <ConnectorActions
            state={actions}
            triggerRef={actionsTriggerRef}
            history={{
              expanded,
              contentId: historyId,
              onToggle: () => setExpanded((previous) => !previous),
            }}
          />
        }
      />
      {connector.accessRewritePending && (
        <span className='flex items-center gap-1 text-[var(--text-muted)] text-caption'>
          <Loader className='size-3' animate />
          Updating access
        </span>
      )}
      <ConnectorRecovery
        connector={connector}
        scope={scope}
        knowledgeBaseId={knowledgeBaseId}
        isSearchIndex={isSearchIndex}
        canEdit={canEdit}
        onEdit={onEdit}
      />
      <ConnectorActionFeedback state={actions} />
      {expanded && (
        <div id={historyId} className='border-[var(--border)] border-t pt-3'>
          <div className='mb-2 flex items-start justify-end gap-2'>
            {syncDetails && (
              <p className='flex-1 text-[var(--text-muted)] text-caption'>{syncDetails}</p>
            )}
            <Chip
              aria-expanded={expanded}
              aria-controls={historyId}
              onClick={() => {
                setExpanded(false)
                actionsTriggerRef.current?.focus()
              }}
            >
              Hide history
            </Chip>
          </div>
          {lastSyncError && <SettingsResourceRow title={lastSyncError} />}
          <ConnectorSyncHistory connector={connector} knowledgeBaseId={knowledgeBaseId} />
        </div>
      )}
    </div>
  )
}
