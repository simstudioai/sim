'use client'

import { Fragment, type Ref, useId } from 'react'
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
import { orderHeaderActions, type SettingsAction } from '@/components/settings/settings-header'
import type { ConnectorActionState } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/use-connector-actions'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'

interface ConnectorActionsProps {
  state: ConnectorActionState
  triggerRef?: Ref<HTMLButtonElement>
  history?: {
    expanded: boolean
    contentId: string
    onToggle: () => void
  }
}

export function ConnectorActions({ state, triggerRef, history }: ConnectorActionsProps) {
  if (!state.canEdit && !history) return null
  const actions = orderHeaderActions([
    ...state.actions,
    ...(history
      ? [
          {
            id: 'history',
            text: history.expanded ? 'Hide history' : 'Sync history',
            onSelect: history.onToggle,
          },
        ]
      : []),
  ])
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Chip ref={triggerRef} aria-label='Connection actions' leftIcon={MoreHorizontal} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {actions.map(({ action }, index) => (
          <Fragment key={action.id}>
            {action.id === 'delete' && index > 0 && <DropdownMenuSeparator />}
            <ConnectorActionMenuItem
              action={action}
              history={action.id === 'history' ? history : undefined}
            />
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface ConnectorActionMenuItemProps {
  action: SettingsAction
  history?: ConnectorActionsProps['history']
}

function ConnectorActionMenuItem({ action, history }: ConnectorActionMenuItemProps) {
  const item = (
    <DropdownMenuItem
      onSelect={action.onSelect}
      disabled={action.disabled}
      aria-label={
        action.disabled && action.tooltip ? `${action.text} — ${action.tooltip}` : action.text
      }
      aria-expanded={history?.expanded}
      aria-controls={history?.contentId}
    >
      {action.text}
    </DropdownMenuItem>
  )
  return action.tooltip ? (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span className='block'>{item}</span>
      </Tooltip.Trigger>
      <Tooltip.Content>{action.tooltip}</Tooltip.Content>
    </Tooltip.Root>
  ) : (
    item
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
        title='Remove connection'
        text={
          removal.requiresDocumentDeletion
            ? 'This removes the connection, stops future syncs, and deletes its synced documents from Sim.'
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
        {!removal.requiresDocumentDeletion && (
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
