import { Icon } from '@sim/emcn/icon'
import { OverflowText } from '@sim/emcn/overflow-text'
import { StatusText } from '@sim/emcn/status'
import styles from '@/app/(product)/_components/workspace/logs/run-status/run-status.module.css'
import type { RunStatus, RunTrigger } from '@/platform/shared/workspace-records'

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  completed: 'Completed',
  failed: 'Failed',
  waiting: 'Waiting',
  running: 'Running',
  cancelled: 'Cancelled',
}

/** Settled runs read in secondary ink, as in Paper's RunRow; a run that needs attention keeps its tone. */
const RUN_STATUS_INTENT = {
  completed: 'neutral',
  failed: 'danger',
  waiting: 'warning',
  running: 'info',
  cancelled: 'neutral',
} as const satisfies Record<RunStatus, string>

/** A run's status as text in its semantic ink; no badge or glyph. */
export function RunStatusText({ status }: { status: RunStatus }) {
  return <StatusText label={RUN_STATUS_LABEL[status]} intent={RUN_STATUS_INTENT[status]} />
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
        <OverflowText text={trigger.label}>{trigger.label}</OverflowText>
      </span>
    </span>
  )
}
