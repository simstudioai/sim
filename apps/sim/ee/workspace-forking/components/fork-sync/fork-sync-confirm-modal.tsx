'use client'

import { ChipConfirmModal } from '@sim/emcn'
import {
  ARCHIVED_PREVIEW_LIMIT,
  type ForkSyncController,
} from '@/ee/workspace-forking/components/fork-sync/use-fork-sync'
import { buildWebhookTriggerUrl } from '@/triggers/webhook-url'

interface ForkSyncConfirmModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  controller: ForkSyncController
}

/**
 * The last step of every sync: confirms overwriting the target workspace, naming the workflows
 * it archives and the webhook URLs it stops serving, then runs the sync.
 */
export function ForkSyncConfirmModal({
  open,
  onOpenChange,
  controller,
}: ForkSyncConfirmModalProps) {
  const targetWorkspaceName = controller.targetWorkspaceName
  return (
    <ChipConfirmModal
      open={open}
      onOpenChange={onOpenChange}
      srTitle='Sync workspace'
      title={`Overwrite ${targetWorkspaceName}`}
      text={[
        'Syncing will ',
        { text: 'overwrite any changes', bold: true },
        ` made in ${targetWorkspaceName} since the last sync. Continue?`,
      ]}
      confirm={{
        label: 'Sync',
        onClick: () => {
          onOpenChange(false)
          void controller.sync()
        },
        pending: controller.submitting,
        pendingLabel: 'Syncing...',
      }}
    >
      {controller.archivedWorkflowNames.length > 0 ? (
        <div className='flex flex-col gap-1 px-2'>
          <p className='break-words text-[var(--text-primary)] text-sm'>
            Will be archived in <span>{targetWorkspaceName}</span> (deleted in the source):
          </p>
          {controller.archivedWorkflowNames.slice(0, ARCHIVED_PREVIEW_LIMIT).map((name, index) => (
            <div
              key={`${name}:${index}`}
              className='min-w-0 truncate text-[var(--text-muted)] text-small'
            >
              {name}
            </div>
          ))}
          {controller.archivedWorkflowNames.length > ARCHIVED_PREVIEW_LIMIT ? (
            <div className='text-[var(--text-muted)] text-small'>
              and {controller.archivedWorkflowNames.length - ARCHIVED_PREVIEW_LIMIT} more
            </div>
          ) : null}
        </div>
      ) : null}
      {/* A dead trigger URL is only discoverable after the fact, when the external caller goes
          quiet - so it belongs in the confirm, next to the other irreversible consequences. */}
      {controller.triggerUrlChanges.length > 0 ? (
        <div className='flex flex-col gap-1 px-2'>
          <p className='break-words text-[var(--text-primary)] text-sm'>
            {controller.triggerUrlChanges.length === 1 ? 'A webhook URL' : 'Webhook URLs'} in{' '}
            <span>{targetWorkspaceName}</span> will stop being served — anything calling{' '}
            {controller.triggerUrlChanges.length === 1 ? 'it' : 'them'} breaks until you
            re-register:
          </p>
          {controller.triggerUrlChanges.slice(0, ARCHIVED_PREVIEW_LIMIT).map((change) => (
            // Naming the URL, not just its workflow: several URLs in one workflow would render
            // as identical lines, and this confirm is the last point before they stop serving.
            <div
              key={`${change.workflowName}:${change.path}`}
              className='min-w-0 text-[var(--text-muted)] text-small'
            >
              {change.workflowName}
              <span className='block truncate font-mono text-caption'>
                {buildWebhookTriggerUrl(change.path)}
              </span>
            </div>
          ))}
          {controller.triggerUrlChanges.length > ARCHIVED_PREVIEW_LIMIT ? (
            <div className='text-[var(--text-muted)] text-small'>
              and {controller.triggerUrlChanges.length - ARCHIVED_PREVIEW_LIMIT} more
            </div>
          ) : null}
        </div>
      ) : null}
    </ChipConfirmModal>
  )
}
