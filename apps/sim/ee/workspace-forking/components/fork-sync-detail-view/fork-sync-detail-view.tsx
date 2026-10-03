'use client'

import { useState } from 'react'
import { ChipConfirmModal } from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import { useQueryState } from 'nuqs'
import { saveDiscardActions } from '@/components/settings/save-discard-actions'
import type { SettingsAction } from '@/components/settings/settings-header'
import { buildWebhookTriggerUrl } from '@/lib/webhooks/trigger-url'
import { UnsavedChangesModal } from '@/app/workspace/[workspaceId]/components/credential-detail'
import {
  forkSyncDirectionParam,
  forkSyncDirectionUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/[section]/search-params'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { useSettingsUnsavedGuard } from '@/app/workspace/[workspaceId]/settings/hooks/use-settings-unsaved-guard'
import { ForkSyncView } from '@/ee/workspace-forking/components/fork-sync/fork-sync-view'
import {
  ARCHIVED_PREVIEW_LIMIT,
  useForkSync,
} from '@/ee/workspace-forking/components/fork-sync/use-fork-sync'
import type { ForkDirection } from '@/ee/workspace-forking/hooks/workspace-fork'

interface ForkSyncDetailViewProps {
  title: string
  workspaceId: string
  /** This workspace's name — a pull overwrites it, and the copy has to say which side that is. */
  workspaceName?: string
  /** The other side of the edge being synced (this workspace's parent). */
  otherWorkspaceId: string
  otherWorkspaceName: string
  onBack: () => void
  /** Header chips rendered left of Sync (e.g. Open workspace) — the caller owns those. */
  actions: SettingsAction[]
}

/**
 * The parent edge's sync page (reached from the parent row): direction, deployed-workflow
 * changes, per-kind mappings (each an expandable row whose status badge is the summary),
 * copy resources, and blocking references, all as page sections.
 * The header's Sync chip is gated until zero blockers + required mappings + reconfigure are
 * complete, and always confirms the overwrite first — that confirm is the flow's one modal.
 * While the mapping has unsaved edits the header swaps to Discard/Save and leaving is guarded;
 * Sync itself persists the effective mapping as part of the run.
 */
export function ForkSyncDetailView({
  title,
  workspaceId,
  workspaceName,
  otherWorkspaceId,
  otherWorkspaceName,
  onBack,
  actions,
}: ForkSyncDetailViewProps) {
  // Sync direction is shareable view state: a copied link opens the same side of the sync.
  const [direction, setDirection] = useQueryState(forkSyncDirectionParam.key, {
    ...forkSyncDirectionParam.parser,
    ...forkSyncDirectionUrlKeys,
  })

  const controller = useForkSync({
    workspaceId,
    workspaceName,
    otherWorkspaceId,
    otherWorkspaceName,
    direction,
    enabled: true,
  })

  // Guard leaving the detail view (Back) while the mapping has unsaved edits, and feed
  // the shared settings dirty store so a sidebar section switch confirms too.
  const guard = useSettingsUnsavedGuard({ isDirty: controller.dirty })

  const [confirmSyncOpen, setConfirmSyncOpen] = useState(false)
  // A direction switch drops every in-session choice (see `useForkSync`), so any confirms first.
  const [pendingDirection, setPendingDirection] = useState<ForkDirection | null>(null)
  const changeDirection = (next: ForkDirection) => {
    if (controller.hasSessionChoices) setPendingDirection(next)
    else void setDirection(next)
  }

  // Sync is the edge's primary action, so it's the rightmost/black chip; the caller's
  // Open workspace chip sits left of it. Dirty mapping edits swap the whole cluster
  // for Discard/Save until they're saved or discarded.
  const panelActions: SettingsAction[] = controller.dirty
    ? saveDiscardActions({
        dirty: controller.dirty,
        saving: controller.saving,
        onSave: controller.save,
        onDiscard: controller.discard,
      })
    : [
        ...actions,
        {
          text: controller.submitting ? 'Working...' : 'Sync',
          variant: 'primary' as const,
          onSelect: () => setConfirmSyncOpen(true),
          disabled: controller.syncDisabled,
          tooltip: controller.syncDisabled
            ? controller.syncDisabledReason
            : `Push to or pull from ${otherWorkspaceName}`,
        },
      ]

  const targetWorkspaceName = controller.targetWorkspaceName

  return (
    <>
      <SettingsPanel
        back={{
          text: 'Workspace Forks',
          icon: ArrowLeft,
          onSelect: () =>
            guard.guardBack(() => {
              void setDirection(null)
              onBack()
            }),
        }}
        title={title}
        actions={panelActions}
      >
        <ForkSyncView controller={controller} onDirectionChange={changeDirection} />
      </SettingsPanel>

      <UnsavedChangesModal
        open={guard.showUnsavedModal}
        onOpenChange={guard.setShowUnsavedModal}
        onDiscard={guard.confirmDiscard}
      />

      <UnsavedChangesModal
        open={pendingDirection !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDirection(null)
        }}
        onDiscard={() => {
          if (pendingDirection) void setDirection(pendingDirection)
          setPendingDirection(null)
        }}
      />

      <ChipConfirmModal
        open={confirmSyncOpen}
        onOpenChange={setConfirmSyncOpen}
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
            setConfirmSyncOpen(false)
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
            {controller.archivedWorkflowNames
              .slice(0, ARCHIVED_PREVIEW_LIMIT)
              .map((name, index) => (
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
    </>
  )
}
