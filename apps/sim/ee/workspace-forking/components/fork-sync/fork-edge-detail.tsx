'use client'

import { useState } from 'react'
import { ChipConfirmModal } from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { saveDiscardActions } from '@/components/settings/save-discard-actions'
import type { SettingsAction } from '@/components/settings/settings-header'
import type { ForkForestNode } from '@/lib/api/contracts/workspace-fork'
import { UnsavedChangesModal } from '@/app/workspace/[workspaceId]/components/credential-detail'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { useSettingsUnsavedGuard } from '@/app/workspace/[workspaceId]/settings/hooks/use-settings-unsaved-guard'
import { ForkSyncView } from '@/ee/workspace-forking/components/fork-sync/fork-sync-view'
import {
  ARCHIVED_PREVIEW_LIMIT,
  useForkSync,
} from '@/ee/workspace-forking/components/fork-sync/use-fork-sync'
import { forkDirectionParam, forkDirectionUrlKeys } from '@/ee/workspace-forking/search-params'
import { buildWebhookTriggerUrl } from '@/triggers/webhook-url'

interface ForkEdgeDetailProps {
  /** The edge's child workspace — the side that owns the mapping, and the sync's anchor. */
  child: ForkForestNode
  /** The edge's parent workspace. */
  parent: ForkForestNode
  onBack: () => void
}

/**
 * One fork edge's sync page: direction, the deployed-workflow changes, the references still to
 * resolve, the trigger URLs it decides, and the run itself.
 *
 * Anchored on the edge's CHILD workspace because that is where an edge's mapping lives, which is
 * what lets the console open any edge in the lineage rather than only the one the viewer happens to
 * be standing in. The Sync chip is gated until nothing blocks and every required field has a value,
 * and always confirms the overwrite first — that confirm is the flow's one modal. While the mapping
 * has unsaved edits the header swaps to Discard and Save, and leaving is guarded.
 */
export function ForkEdgeDetail({ child, parent, onBack }: ForkEdgeDetailProps) {
  const router = useRouter()
  const [directionParam, setDirection] = useQueryState(forkDirectionParam.key, {
    ...forkDirectionParam.parser,
    ...forkDirectionUrlKeys,
  })
  const direction = directionParam ?? 'push'

  const controller = useForkSync({
    workspaceId: child.id,
    otherWorkspaceId: parent.id,
    otherWorkspaceName: parent.name,
    direction,
    enabled: true,
  })

  // Guard leaving while the mapping has unsaved edits, and feed the shared settings dirty store so
  // a sidebar section switch confirms too.
  const guard = useSettingsUnsavedGuard({ isDirty: controller.dirty })
  const [confirmSyncOpen, setConfirmSyncOpen] = useState(false)

  const source = direction === 'push' ? child : parent
  const target = direction === 'push' ? parent : child

  // Sync is the edge's primary action, so it is the rightmost chip. Unsaved mapping edits swap the
  // whole cluster for Discard and Save until they are saved or discarded.
  const actions: SettingsAction[] = controller.dirty
    ? saveDiscardActions({
        dirty: controller.dirty,
        saving: controller.saving,
        onSave: controller.save,
        onDiscard: controller.discard,
      })
    : [
        {
          text: `Open ${target.name}`,
          onSelect: () => router.push(`/workspace/${target.id}/w`),
          disabled: !target.viewerAccessible,
          tooltip: target.viewerAccessible ? undefined : "You don't have access to this workspace",
        },
        {
          id: 'sync',
          text: controller.submitting ? 'Syncing...' : 'Sync',
          variant: 'primary' as const,
          onSelect: () => setConfirmSyncOpen(true),
          disabled: controller.syncDisabled,
          tooltip: controller.syncDisabled
            ? controller.syncDisabledReason
            : `Overwrites ${target.name} with the deployed workflows in ${source.name}`,
        },
      ]

  return (
    <>
      <SettingsPanel
        back={{
          text: 'Forks',
          icon: ArrowLeft,
          onSelect: () =>
            guard.guardBack(() => {
              void setDirection(null)
              onBack()
            }),
        }}
        title={`${source.name} → ${target.name}`}
        description={`Move deployed workflows from ${source.name} into ${target.name}.`}
        actions={actions}
      >
        <ForkSyncView
          controller={controller}
          onDirectionChange={(next) => void setDirection(next)}
        />
      </SettingsPanel>

      <UnsavedChangesModal
        open={guard.showUnsavedModal}
        onOpenChange={guard.setShowUnsavedModal}
        onDiscard={guard.confirmDiscard}
      />

      <ChipConfirmModal
        open={confirmSyncOpen}
        onOpenChange={setConfirmSyncOpen}
        srTitle='Sync workspace'
        title={`Overwrite ${target.name}`}
        text={[
          `${target.name} may have changed since the last sync. Syncing will `,
          { text: 'overwrite those changes', bold: true },
          '. Continue?',
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
              Archived in {target.name}, because the source no longer has them:
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
            quiet, so it belongs in the confirm beside the other irreversible consequences. */}
        {controller.triggerUrlChanges.length > 0 ? (
          <div className='flex flex-col gap-1 px-2'>
            <p className='break-words text-[var(--text-primary)] text-sm'>
              {controller.triggerUrlChanges.length === 1 ? 'A webhook URL' : 'Webhook URLs'} in{' '}
              {target.name} will stop being served, so anything calling{' '}
              {controller.triggerUrlChanges.length === 1 ? 'it' : 'them'} breaks until you
              re-register:
            </p>
            {controller.triggerUrlChanges.slice(0, ARCHIVED_PREVIEW_LIMIT).map((change) => (
              // Naming the URL, not just its workflow: several URLs in one workflow would render as
              // identical lines, and this confirm is the last point before they stop serving.
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
