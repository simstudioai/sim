import { task } from '@trigger.dev/sdk'
import {
  ACTIVITY_ROLLUP_TASK_ID,
  runActivityRollupMaintenance,
} from '@/lib/billing/activity-rollup/enqueue'

/**
 * Runs one activity rollup pass. One runs at a time; the cron enqueues one every two minutes, so a
 * failed pass is not retried: the next one starts from the state the failed one committed, since
 * every hour is written together with the progress it completes.
 */
export const activityRollupTask = task({
  id: ACTIVITY_ROLLUP_TASK_ID,
  machine: 'small-1x',
  maxDuration: 10 * 60,
  retry: { maxAttempts: 1 },
  queue: { name: ACTIVITY_ROLLUP_TASK_ID, concurrencyLimit: 1 },
  run: async () => runActivityRollupMaintenance(),
})
