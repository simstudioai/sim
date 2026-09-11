'use client'

import { useId } from 'react'
import { Checkbox, ChipConfirmModal, ChipModalError, ChipModalField } from '@sim/emcn'
import { SettingsActionChips } from '@/components/settings/settings-header'
import {
  type ConnectorActionState,
  type ConnectorActionsOptions,
  useConnectorActions,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/use-connector-actions'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'

export function ConnectorActions(props: ConnectorActionsOptions) {
  const state = useConnectorActions(props)
  if (!state.canEdit) return null
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-wrap items-center gap-1'>
        <SettingsActionChips actions={state.actions} />
      </div>
      <ConnectorActionFeedback state={state} />
    </div>
  )
}

interface ConnectorActionFeedbackProps {
  state: ConnectorActionState
}

export function ConnectorActionFeedback({ state }: ConnectorActionFeedbackProps) {
  const deleteDocumentsId = useId()
  if (!state.canEdit) return null
  const { removal, fullResync } = state
  return (
    <>
      {state.error && (
        <SettingsEmptyState variant='inline' tone='error'>
          {state.error.message}
        </SettingsEmptyState>
      )}
      <ChipConfirmModal
        open={fullResync.open}
        onOpenChange={fullResync.onOpenChange}
        title='Full resync?'
        text='Fetch all content again for this connection, including unchanged documents. This can take longer than a regular sync.'
        confirm={{
          label: 'Full resync',
          variant: 'primary',
          pending: fullResync.pending,
          disabled: fullResync.disabled,
          pendingLabel: 'Queuing…',
          onClick: fullResync.onConfirm,
        }}
      >
        <ChipModalError>{fullResync.error?.message}</ChipModalError>
      </ChipConfirmModal>
      <ChipConfirmModal
        open={removal.open}
        onOpenChange={removal.onOpenChange}
        title='Remove connection'
        text={
          removal.syncsPerMember
            ? 'This removes the connection, stops future syncs, and deletes its member documents.'
            : 'This removes the connection and stops future syncs. Synced documents remain unless you delete them below.'
        }
        confirm={{
          label: 'Remove',
          pending: removal.pending,
          disabled: removal.disabled,
          pendingLabel: 'Removing…',
          onClick: removal.onConfirm,
        }}
      >
        {!removal.syncsPerMember && (
          <ChipModalField type='custom' title='Documents'>
            <div className='flex items-center gap-2'>
              <Checkbox
                id={deleteDocumentsId}
                checked={removal.deleteDocuments}
                disabled={removal.pending}
                onCheckedChange={(checked) => removal.setDeleteDocuments(checked === true)}
              />
              <label htmlFor={deleteDocumentsId}>Also delete synced documents</label>
            </div>
          </ChipModalField>
        )}
        <ChipModalError>{removal.error?.message}</ChipModalError>
      </ChipConfirmModal>
    </>
  )
}
