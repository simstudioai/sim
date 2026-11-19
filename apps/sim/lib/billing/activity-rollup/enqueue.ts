import { type ScheduledPassResult, startScheduledPass } from '@/lib/core/async-jobs/scheduled-pass'
import { env } from '@/lib/core/config/env'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { isTriggerAvailable } from '@/lib/core/config/trigger-availability'
import { createDetachedTouch } from '@/lib/core/utils/background'

export const ACTIVITY_ROLLUP_TASK_ID = 'activity-rollup'

/**
 * How long one pass starts work. A pass runs every two minutes, so it finishes well before the
 * next, and its lease (three minutes) outlives a statement started at the budget.
 */
const ACTIVITY_ROLLUP_PASS_BUDGET_MS = 40 * 1000

/** The cron's window: at most one pass is enqueued per window. */
const ACTIVITY_ROLLUP_INTERVAL_MS = 2 * 60 * 1000

const DEFAULT_BACKFILL_ROWS_PER_SECOND = 20_000
const BACKFILL_MIN_GAP_MS = 200

/**
 * One maintenance pass, when the `activity-rollup-maintenance` flag is on. Checked again here,
 * not only when the pass is enqueued, so turning the flag off stops passes already queued.
 */
export async function runActivityRollupMaintenance(): Promise<void> {
  if (!(await isFeatureEnabled('activity-rollup-maintenance'))) return
  const { runActivityRollupPass } = await import('@/lib/billing/activity-rollup/pass')
  await runActivityRollupPass({
    budgetMs: ACTIVITY_ROLLUP_PASS_BUDGET_MS,
    backfillRowsPerSecond:
      env.ACTIVITY_ROLLUP_BACKFILL_ROWS_PER_SECOND ?? DEFAULT_BACKFILL_ROWS_PER_SECOND,
    backfillMinGapMs: BACKFILL_MIN_GAP_MS,
  })
}

/**
 * Starts a pass in this process without waiting for it, for deployments without a Trigger.dev
 * worker. A tick while one runs is dropped: the next tick starts the next pass, and the pass's
 * lease keeps an inline pass and a Trigger.dev pass from ever overlapping.
 */
const runInline = createDetachedTouch({
  label: 'Inline activity rollup pass',
  write: runActivityRollupMaintenance,
})

/**
 * The activity rollup's cron tick: enqueues one pass per window while the maintenance flag is on,
 * and none while it is off.
 */
export async function enqueueActivityRollupPass(): Promise<ScheduledPassResult> {
  return startScheduledPass({
    due: await isFeatureEnabled('activity-rollup-maintenance'),
    triggerAvailable: isTriggerAvailable,
    startInline: () => runInline(ACTIVITY_ROLLUP_TASK_ID),
    trigger: {
      taskId: ACTIVITY_ROLLUP_TASK_ID,
      intervalMs: ACTIVITY_ROLLUP_INTERVAL_MS,
      options: { ttl: '5m' },
    },
  })
}
