'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Modal } from '@sim/emcn/modal'
import {
  DetailHeader,
  Muted,
  RowStack,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { ForkSyncView } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/forks/fork-sync-view'
import styles from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/forks/forks.module.css'
import {
  ARCHIVED_PREVIEW_LIMIT,
  buildWebhookTriggerUrl,
  type ForkDirection,
  type ForkLineageNodeApi,
  useForkSync,
  useForkSyncDirectionParam,
} from '@/platform/lib/data/forks'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'

/** Explains a disabled action on a workspace the viewer cannot open. */
const NO_ACCESS_REASON = "You don't have access to this workspace"

interface ForkSyncDetailProps {
  workspaceId: string
  /** This workspace's name: a pull overwrites it, and the copy says which side that is. */
  workspaceName?: string
  parent: ForkLineageNodeApi
  onBack: () => void
  onOpenWorkspace: () => void
}

/**
 * The parent edge's sync page. Sync stays off until nothing blocks it and every required mapping
 * and field is set, and always confirms the overwrite first. Unsaved mapping edits swap the
 * header's actions for Discard and Save and guard leaving; Sync itself saves the mapping it runs.
 */
export function ForkSyncDetail({
  workspaceId,
  workspaceName,
  parent,
  onBack,
  onOpenWorkspace,
}: ForkSyncDetailProps) {
  const [direction, setDirection] = useForkSyncDirectionParam()
  const controller = useForkSync({
    workspaceId,
    workspaceName,
    otherWorkspaceId: parent.id,
    otherWorkspaceName: parent.name,
    direction,
    enabled: true,
  })
  const guard = useSettingsUnsavedGuard({
    isDirty: controller.hasSessionChoices,
    navigationBlocked: controller.saving || controller.submitting,
    onDiscard: controller.discard,
  })
  const [confirmingSync, setConfirmingSync] = useState(false)
  const target = controller.targetWorkspaceName
  const busy = controller.saving || controller.submitting

  const changeDirection = (next: ForkDirection) => {
    if (next === controller.direction) return
    guard.guardBack(() => void setDirection(next))
  }

  return (
    <SectionStack>
      <DetailHeader
        backLabel='Workspace forks'
        onBack={() =>
          guard.guardBack(() => {
            void setDirection(null)
            onBack()
          })
        }
        title={parent.name}
      >
        {controller.dirty ? (
          <>
            <Button variant='quiet' size='compact' disabled={busy} onClick={controller.discard}>
              Discard
            </Button>
            <Button variant='primary' size='compact' disabled={busy} onClick={controller.save}>
              {controller.saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant='secondary'
              size='compact'
              disabled={!parent.viewerAccessible}
              disabledReason={parent.viewerAccessible ? undefined : NO_ACCESS_REASON}
              onClick={onOpenWorkspace}
            >
              Open workspace
            </Button>
            <Button
              variant='primary'
              size='compact'
              disabled={controller.syncDisabled}
              disabledReason={controller.syncDisabled ? controller.syncDisabledReason : undefined}
              onClick={() => setConfirmingSync(true)}
            >
              {controller.submitting ? 'Working…' : 'Sync'}
            </Button>
          </>
        )}
      </DetailHeader>
      <ForkSyncView controller={controller} onDirectionChange={changeDirection} />
      <Modal
        variant='confirm'
        open={confirmingSync}
        onOpenChange={setConfirmingSync}
        title={`Overwrite ${target}`}
        description={`Syncing will overwrite any changes made in ${target} since the last sync. Continue?`}
        confirmLabel='Sync'
        onConfirm={() => {
          void controller.sync()
        }}
      >
        {controller.archivedWorkflowNames.length > 0 && (
          <RowStack>
            <span data-type='T043'>{`Will be archived in ${target} (deleted in the source):`}</span>
            {controller.archivedWorkflowNames
              .slice(0, ARCHIVED_PREVIEW_LIMIT)
              .map((name, index) => (
                <Muted key={`${name}:${index}`}>{name}</Muted>
              ))}
            {controller.archivedWorkflowNames.length > ARCHIVED_PREVIEW_LIMIT && (
              <Muted>
                {`and ${controller.archivedWorkflowNames.length - ARCHIVED_PREVIEW_LIMIT} more`}
              </Muted>
            )}
          </RowStack>
        )}
        {controller.triggerUrlChanges.length > 0 && (
          <RowStack>
            <span data-type='T043'>
              {controller.triggerUrlChanges.length === 1
                ? `A webhook URL in ${target} will stop being served — anything calling it breaks until you re-register:`
                : `Webhook URLs in ${target} will stop being served — anything calling them breaks until you re-register:`}
            </span>
            {controller.triggerUrlChanges.slice(0, ARCHIVED_PREVIEW_LIMIT).map((change) => (
              <Muted key={`${change.workflowName}:${change.path}`}>
                {change.workflowName}
                <span className={styles.url} data-type='T005'>
                  {buildWebhookTriggerUrl(change.path)}
                </span>
              </Muted>
            ))}
            {controller.triggerUrlChanges.length > ARCHIVED_PREVIEW_LIMIT && (
              <Muted>
                {`and ${controller.triggerUrlChanges.length - ARCHIVED_PREVIEW_LIMIT} more`}
              </Muted>
            )}
          </RowStack>
        )}
      </Modal>
    </SectionStack>
  )
}
