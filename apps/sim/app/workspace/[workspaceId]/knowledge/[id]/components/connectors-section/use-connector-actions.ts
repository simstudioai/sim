'use client'

import { useState } from 'react'
import type { SettingsAction } from '@/components/settings/settings-header'
import type { ConnectorData } from '@/lib/api/contracts/knowledge/connectors'
import { getConnectorSyncState } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/connector-sync-state'
import {
  useDeleteConnector,
  useTriggerSync,
  useUpdateConnector,
} from '@/hooks/queries/kb/connectors'

export interface ConnectorActionsOptions {
  connector: ConnectorData
  knowledgeBaseId: string
  canEdit: boolean
  disabled?: boolean
  primarySync?: boolean
  onEdit?: () => void
  onRemoved?: () => void
}

export function useConnectorActions({
  connector,
  knowledgeBaseId,
  canEdit,
  disabled = false,
  primarySync = false,
  onEdit,
  onRemoved,
}: ConnectorActionsOptions) {
  const sync = useTriggerSync()
  const update = useUpdateConnector()
  const remove = useDeleteConnector()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [confirmFullResync, setConfirmFullResync] = useState(false)
  const [deleteDocuments, setDeleteDocuments] = useState(false)
  const requiresDocumentDeletion = connector.accessMode !== 'workspace'
  const state = getConnectorSyncState(connector)
  const actionsDisabled = disabled || sync.isPending || update.isPending || remove.isPending
  const syncRunning =
    connector.status === 'syncing' ||
    (state.syncsPerMember && connector.memberSyncStatus === 'running')
  const pauseDisabled = actionsDisabled || syncRunning

  function resetErrors() {
    sync.reset()
    update.reset()
    remove.reset()
  }

  function triggerSync(rehydrate = false) {
    if (!canEdit || actionsDisabled || state.syncDisabled || (rehydrate && !state.canFullResync))
      return
    resetErrors()
    const input = { knowledgeBaseId, connectorId: connector.id, rehydrate }
    if (rehydrate) sync.mutate(input, { onSuccess: () => setConfirmFullResync(false) })
    else sync.mutate(input)
  }

  function setRemoveOpen(open: boolean) {
    if (remove.isPending) return
    setConfirmRemove(open)
    if (!open) setDeleteDocuments(false)
  }

  const actions: SettingsAction[] = canEdit
    ? [
        {
          id: 'sync',
          text: state.syncLabel,
          variant: primarySync ? 'primary' : undefined,
          disabled: state.syncDisabled || actionsDisabled,
          tooltip: state.syncTooltip,
          onSelect: () => triggerSync(),
        },
        ...(state.canFullResync
          ? [
              {
                id: 'full-resync',
                text: 'Full resync',
                disabled: state.syncDisabled || actionsDisabled,
                onSelect: () => {
                  if (!canEdit || actionsDisabled || state.syncDisabled) return
                  resetErrors()
                  setConfirmFullResync(true)
                },
              },
            ]
          : []),
        ...(onEdit
          ? [{ id: 'settings', text: 'Settings', disabled: actionsDisabled, onSelect: onEdit }]
          : []),
        {
          id: 'pause',
          text: state.canResume ? 'Resume syncing' : 'Pause syncing',
          disabled: pauseDisabled,
          tooltip: syncRunning ? 'Wait for the current sync to finish' : undefined,
          onSelect: () => {
            if (!canEdit || pauseDisabled) return
            resetErrors()
            update.mutate({
              knowledgeBaseId,
              connectorId: connector.id,
              updates: { status: state.canResume ? 'active' : 'paused' },
            })
          },
        },
        {
          id: 'delete',
          text: 'Remove connection',
          disabled: actionsDisabled,
          onSelect: () => {
            if (actionsDisabled) return
            resetErrors()
            setRemoveOpen(true)
          },
        },
      ]
    : []

  return {
    actions,
    actionsDisabled,
    canEdit,
    error: (confirmFullResync ? null : sync.error) ?? update.error,
    fullResync: {
      open: confirmFullResync,
      onOpenChange: (open: boolean) => {
        if (sync.isPending) return
        setConfirmFullResync(open)
        if (!open) sync.reset()
      },
      pending: sync.isPending,
      disabled: actionsDisabled || state.syncDisabled || !state.canFullResync,
      error: sync.error,
      onConfirm: () => triggerSync(true),
    },
    removal: {
      open: confirmRemove,
      onOpenChange: setRemoveOpen,
      requiresDocumentDeletion,
      deleteDocuments,
      setDeleteDocuments,
      pending: remove.isPending,
      disabled: actionsDisabled,
      error: remove.error,
      onConfirm: () => {
        if (!canEdit || actionsDisabled) return
        remove.mutate(
          {
            knowledgeBaseId,
            connectorId: connector.id,
            deleteDocuments: requiresDocumentDeletion || deleteDocuments,
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
    },
  }
}

export type ConnectorActionState = ReturnType<typeof useConnectorActions>
