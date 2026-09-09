'use client'

import { useId } from 'react'
import {
  Checkbox,
  Chip,
  ChipConfirmModal,
  ChipModalError,
  ChipModalField,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { MoreHorizontal } from '@sim/emcn/icons'
import { SettingsActionChip } from '@/components/settings/settings-header'
import {
  type ConnectorActionState,
  type ConnectorActionsOptions,
  useConnectorActions,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/use-connector-actions'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'

export function ConnectorActions(props: ConnectorActionsOptions) {
  const state = useConnectorActions(props)
  if (!state.canEdit) return null
  const [sync, ...menuActions] = state.actions
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center gap-1'>
        {sync && <SettingsActionChip action={sync} />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Chip
              aria-label='Source actions'
              leftIcon={MoreHorizontal}
              disabled={state.actionsDisabled}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            {menuActions.map((action) => (
              <DropdownMenuItem
                key={action.id}
                disabled={action.disabled}
                onSelect={action.onSelect}
              >
                {action.text}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
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
  const { removal } = state
  return (
    <>
      {state.error && (
        <SettingsEmptyState variant='inline' tone='error'>
          {state.error.message}
        </SettingsEmptyState>
      )}
      <ChipConfirmModal
        open={removal.open}
        onOpenChange={removal.onOpenChange}
        title='Remove source'
        text={
          removal.syncsPerMember
            ? 'This disconnects the source, stops future syncs, and deletes its member documents.'
            : 'This disconnects the source and stops future syncs. Synced documents remain unless you delete them below.'
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
