import { task } from '@trigger.dev/sdk'
import {
  type BackgroundRetryPolicy,
  backgroundRetryAttemptCeiling,
  getBackgroundRetryDecision,
} from '@/lib/core/errors/background-retry'
import {
  KNOWLEDGE_PROJECTION_PASS_BUDGET_MS,
  KNOWLEDGE_PROJECTION_TASK_ID,
  requestKnowledgeProjection,
} from '@/lib/knowledge/projection/enqueue'
import { runKnowledgeProjectionPass } from '@/lib/knowledge/projection/run'

/**
 * A pass gives a single document up on a lock or statement timeout without failing, so a failed
 * pass lost its connection or its database. Those back off for minutes; the sweep starts a fresh
 * pass every minute regardless, so a few attempts are enough.
 */
export const KNOWLEDGE_PROJECTION_RETRY_POLICY: BackgroundRetryPolicy = {
  maxAttempts: 2,
  database: { maxAttempts: 3, baseDelayMs: 60 * 1000, maxDelayMs: 5 * 60 * 1000 },
}

/**
 * Runs one knowledge projector pass. One pass runs at a time and projects several documents at
 * once itself; the prompt requests and the sweep collapse into whichever pass is queued. A pass
 * that ran out of budget with marks left asks for the next one. Retry-safe: a pass writes only rows
 * that differ from their source and removes a mark only on the generation it read.
 */
export const knowledgeProjectionTask = task({
  id: KNOWLEDGE_PROJECTION_TASK_ID,
  machine: 'small-1x',
  maxDuration: 15 * 60,
  retry: { maxAttempts: backgroundRetryAttemptCeiling(KNOWLEDGE_PROJECTION_RETRY_POLICY) },
  queue: { name: KNOWLEDGE_PROJECTION_TASK_ID, concurrencyLimit: 1 },
  catchError: async ({ error, ctx }) =>
    getBackgroundRetryDecision(error, ctx.attempt.number, KNOWLEDGE_PROJECTION_RETRY_POLICY),
  run: async () => {
    const result = await runKnowledgeProjectionPass({
      budgetMs: KNOWLEDGE_PROJECTION_PASS_BUDGET_MS,
    })
    if (result.remaining) await requestKnowledgeProjection()
    return result
  },
})
