import { Icon } from '@sim/emcn/icon'
import { OverflowText } from '@sim/emcn/overflow-text'
import type {
  RunStatus,
  RunTrigger,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/run-status/run-status.module.css'

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  completed: 'Completed',
  failed: 'Failed',
  waiting: 'Waiting',
  running: 'Running',
  cancelled: 'Cancelled',
}

/** A run's status as text in its semantic ink; no badge or glyph. */
export function RunStatusText({ status }: { status: RunStatus }) {
  return (
    <span className={styles.status} data-status={status}>
      {RUN_STATUS_LABEL[status]}
    </span>
  )
}

/** Where a run came from: its 16px mark and name. */
export function RunTriggerLabel({ trigger }: { trigger: RunTrigger }) {
  return (
    <span className={styles.trigger}>
      {trigger.providerId ? (
        <Icon providerId={trigger.providerId} />
      ) : (
        <Icon name={trigger.icon ?? 'I030'} />
      )}
      <span className={styles.triggerLabel}>
        <OverflowText text={trigger.label} />
      </span>
    </span>
  )
}
