import { task, tasks } from '@trigger.dev/sdk'
import { resolveTriggerRegion } from '@/lib/core/async-jobs/region'
import {
  PROJECTION_SOURCE_ACL_BACKFILL_TASK_ID,
  type ProjectionSourceAclBackfillPayload,
  runProjectionSourceAclBackfill,
} from '@/lib/knowledge/search/projection-source-acl-backfill'

/** One run's share of the backfill, inside the worker's run ceiling with room to end its page. */
const RUN_BUDGET_MS = 60 * 60 * 1000

/**
 * Trigger.dev wrapper around `runProjectionSourceAclBackfill`. A run fills unset rows for up to
 * {@link RUN_BUDGET_MS}, then triggers its continuation from the cursor it reached, so the whole
 * projection is filled across as many bounded runs as it takes. Retry-safe: every run writes only
 * rows still unset, so a retried or restarted run repeats no write. The queue admits one run at a
 * time, so two starts never fill the same pages against each other.
 */
export const projectionSourceAclBackfillTask = task({
  id: PROJECTION_SOURCE_ACL_BACKFILL_TASK_ID,
  machine: 'small-1x',
  retry: { maxAttempts: 3 },
  queue: {
    name: PROJECTION_SOURCE_ACL_BACKFILL_TASK_ID,
    concurrencyLimit: 1,
  },
  run: async (payload: ProjectionSourceAclBackfillPayload) => {
    const cursor = await runProjectionSourceAclBackfill(payload, { budgetMs: RUN_BUDGET_MS })
    if (!cursor) return
    const continuation: ProjectionSourceAclBackfillPayload = { ...payload, cursor }
    await tasks.trigger(PROJECTION_SOURCE_ACL_BACKFILL_TASK_ID, continuation, {
      region: await resolveTriggerRegion(),
    })
  },
})
