import { task, tasks } from '@trigger.dev/sdk'
import { resolveTriggerRegion } from '@/lib/core/async-jobs/region'
import {
  PROJECTION_SOURCE_ACL_BACKFILL_SHARDS,
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
 * rows still unset, so a retried or restarted run repeats no write. A shard's continuation keeps
 * its shard, so a sliced fill stays sliced until every slice is done.
 */
export const projectionSourceAclBackfillTask = task({
  id: PROJECTION_SOURCE_ACL_BACKFILL_TASK_ID,
  machine: 'small-1x',
  retry: { maxAttempts: 3 },
  /**
   * One run per shard the id space may be sliced into. Shards fill disjoint ranges, so runs never
   * fill the same page against each other; an unsliced chain still runs one at a time because each
   * run triggers its continuation only as it ends.
   */
  queue: {
    name: PROJECTION_SOURCE_ACL_BACKFILL_TASK_ID,
    concurrencyLimit: PROJECTION_SOURCE_ACL_BACKFILL_SHARDS,
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
