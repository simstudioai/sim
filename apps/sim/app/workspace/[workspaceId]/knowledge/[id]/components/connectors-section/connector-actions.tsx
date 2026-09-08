'use client'

import { useId, useState } from 'react'
import {
  Checkbox,
  Chip,
  ChipConfirmModal,
  ChipModalError,
  ChipModalField,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from '@sim/emcn'
import { MoreHorizontal } from '@sim/emcn/icons'
import type { ConnectorData } from '@/lib/api/contracts/knowledge/connectors'
import { getConnectorSyncState } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/connector-sync-state'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  useDeleteConnector,
  useTriggerSync,
  useUpdateConnector,
} from '@/hooks/queries/kb/connectors'

interface ConnectorActionsProps {
  connector: ConnectorData
  knowledgeBaseId: string
  canEdit: boolean
  disabled?: boolean
  onEdit?: () => void
  onRemoved?: () => void
}

export function ConnectorActions({
  connector,
  knowledgeBaseId,
  canEdit,
  disabled = false,
  onEdit,
  onRemoved,
}: ConnectorActionsProps) {
  const sync = useTriggerSync()
  const update = useUpdateConnector()
  const remove = useDeleteConnector()
  const deleteDocumentsId = useId()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [deleteDocuments, setDeleteDocuments] = useState(false)
  const state = getConnectorSyncState(connector)
  const isPending = sync.isPending || update.isPending || remove.isPending
  const actionsDisabled = disabled || isPending
  const error = sync.error ?? update.error

  function resetErrors() {
    sync.reset()
    update.reset()
    remove.reset()
  }

  function triggerSync(rehydrate = false) {
    if (actionsDisabled || state.syncDisabled) return
    resetErrors()
    sync.mutate({ knowledgeBaseId, connectorId: connector.id, rehydrate })
  }

  function setRemoveOpen(open: boolean) {
    if (remove.isPending) return
    setConfirmRemove(open)
    if (!open) setDeleteDocuments(false)
  }

  if (!canEdit) return null

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center gap-1'>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <span className='inline-flex'>
              <Chip disabled={state.syncDisabled || actionsDisabled} onClick={() => triggerSync()}>
                {state.syncLabel}
              </Chip>
            </span>
          </Tooltip.Trigger>
          {state.syncTooltip && <Tooltip.Content>{state.syncTooltip}</Tooltip.Content>}
        </Tooltip.Root>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Chip
              aria-label='Source actions'
              leftIcon={MoreHorizontal}
              disabled={actionsDisabled}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            {state.canFullResync && (
              <DropdownMenuItem
                disabled={state.syncDisabled || actionsDisabled}
                onSelect={() => triggerSync(true)}
              >
                Full resync
              </DropdownMenuItem>
            )}
            {onEdit && (
              <DropdownMenuItem disabled={actionsDisabled} onSelect={onEdit}>
                Settings
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              disabled={actionsDisabled}
              onSelect={() => {
                if (actionsDisabled) return
                resetErrors()
                update.mutate({
                  knowledgeBaseId,
                  connectorId: connector.id,
                  updates: { status: state.canResume ? 'active' : 'paused' },
                })
              }}
            >
              {state.canResume ? 'Resume' : 'Pause'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={actionsDisabled}
              onSelect={() => {
                resetErrors()
                setRemoveOpen(true)
              }}
            >
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {error && (
        <SettingsEmptyState variant='inline' tone='error'>
          {error.message}
        </SettingsEmptyState>
      )}
      <ChipConfirmModal
        open={confirmRemove}
        onOpenChange={setRemoveOpen}
        title='Remove source'
        text={
          state.syncsPerMember
            ? 'This disconnects the source, stops future syncs, and deletes its member documents.'
            : 'This disconnects the source and stops future syncs. Synced documents remain unless you delete them below.'
        }
        confirm={{
          label: 'Remove',
          pending: remove.isPending,
          disabled: disabled || sync.isPending || update.isPending,
          pendingLabel: 'Removing…',
          onClick: () => {
            if (actionsDisabled) return
            remove.mutate(
              {
                knowledgeBaseId,
                connectorId: connector.id,
                deleteDocuments: state.syncsPerMember || deleteDocuments,
              },
              {
                onSuccess: () => {
                  setConfirmRemove(false)
                  setDeleteDocuments(false)
                  onRemoved?.()
                },
              }
            )
          },
        }}
      >
        {!state.syncsPerMember && (
          <ChipModalField type='custom' title='Documents'>
            <div className='flex items-center gap-2'>
              <Checkbox
                id={deleteDocumentsId}
                checked={deleteDocuments}
                disabled={remove.isPending}
                onCheckedChange={(checked) => setDeleteDocuments(checked === true)}
              />
              <label htmlFor={deleteDocumentsId}>Also delete synced documents</label>
            </div>
          </ChipModalField>
        )}
        <ChipModalError>{remove.error?.message}</ChipModalError>
      </ChipConfirmModal>
    </div>
  )
}
