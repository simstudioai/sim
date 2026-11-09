'use client'

import { Button } from '@sim/emcn/button'
import { StatusTag } from '@sim/emcn/status'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/schedule-info/schedule-info.module.css'
import { useSubBlockStore, useWorkflowScope } from '@/platform/lib/data/workflow-editor'
import {
  MAX_CONSECUTIVE_FAILURES,
  parseCronToHumanReadable,
  useRedeployWorkflowSchedule,
  useScheduleQuery,
} from '@/platform/lib/data/workflow-editor/uploads'
import { calendarDayFormatter, formatCalendarDate, formatClockTime } from '@/platform/shared/time'

interface ScheduleInfoProps {
  blockId: string
  isPreview?: boolean
}

/** The next run as a date and clock time in the schedule's own zone, falling back to UTC. */
function formatNextRun(instantMs: number, timeZone: string): string {
  try {
    const day = calendarDayFormatter(timeZone)(new Date(instantMs))
    return `${formatCalendarDate(day)}, ${formatClockTime(instantMs, timeZone)}`
  } catch {
    const day = calendarDayFormatter('UTC')(new Date(instantMs))
    return `${formatCalendarDate(day)}, ${formatClockTime(instantMs)}`
  }
}

/**
 * A schedule trigger's status: its cadence and next run while active, a failure count while it
 * keeps failing, and a redeploy once consecutive failures disabled it. Deploying creates and
 * removes the schedule; this only reads it.
 */
export function ScheduleInfo({ blockId, isPreview = false }: ScheduleInfoProps) {
  const { workflowId } = useWorkflowScope()
  const scheduleTimezone = useSubBlockStore((state) => state.getValue(blockId, 'timezone'))
  const { data: schedule, isLoading } = useScheduleQuery(workflowId ?? undefined, blockId, {
    enabled: !isPreview,
  })
  const redeploy = useRedeployWorkflowSchedule()

  if (!schedule || isLoading) return null

  const timezone =
    (typeof scheduleTimezone === 'string' && scheduleTimezone) || schedule.timezone || 'UTC'
  const failedCount = schedule.failedCount || 0
  const isDisabled = schedule.status === 'disabled'
  const exhausted = isDisabled && failedCount >= MAX_CONSECUTIVE_FAILURES
  const nextRunMs = schedule.nextRunAt ? new Date(schedule.nextRunAt).getTime() : null
  const cadence = schedule.cronExpression
    ? parseCronToHumanReadable(schedule.cronExpression, timezone)
    : null

  function handleRedeploy() {
    if (isPreview || !workflowId || redeploy.isPending) return
    redeploy.mutate({ workflowId, blockId })
  }

  return (
    <div className={styles.scheduleInfo}>
      {exhausted ? (
        <div className={styles.status}>
          <div className={styles.statusRow}>
            <StatusTag label='Disabled' intent='warning' />
            <Button
              variant='quiet'
              size='compact'
              disabled={isPreview || !workflowId || redeploy.isPending}
              onClick={handleRedeploy}
            >
              {redeploy.isPending ? 'Redeploying…' : 'Redeploy'}
            </Button>
          </div>
          <p className={styles.detail} data-type='T052'>
            Disabled after {MAX_CONSECUTIVE_FAILURES} consecutive failures
          </p>
          {redeploy.isError && (
            <p className={styles.error} data-type='T052' role='alert'>
              Failed to redeploy. Please try again.
            </p>
          )}
        </div>
      ) : (
        failedCount > 0 && (
          <div className={styles.statusRow}>
            <StatusTag label={`${failedCount} failed`} intent='warning' />
          </div>
        )
      )}
      {!isDisabled && (cadence || nextRunMs !== null) && (
        <p className={styles.detail} data-type='T052'>
          {cadence}
          {cadence && nextRunMs !== null && ' · '}
          {nextRunMs !== null && `Next: ${formatNextRun(nextRunMs, timezone)}`}
        </p>
      )}
    </div>
  )
}
