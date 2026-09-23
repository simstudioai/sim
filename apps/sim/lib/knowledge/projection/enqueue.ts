import { db } from '@sim/db'
import { SOURCE_ACL_PROJECTIONS } from '@sim/db/knowledge-projection'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sql } from 'drizzle-orm'
import { env } from '@/lib/core/config/env'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { isInsideTriggerRun } from '@/lib/core/config/trigger-runtime'

const logger = createLogger('KnowledgeProjectionEnqueue')

export const KNOWLEDGE_PROJECTION_TASK_ID = 'knowledge-projection'

/**
 * How long one pass starts pages before it hands the rest to the next. The task's duration leaves
 * minutes past it: a page started at the budget runs to its own statement timeout, and closing the
 * pass's connections follows.
 */
export const KNOWLEDGE_PROJECTION_PASS_BUDGET_MS = 8 * 60 * 1000

/** The periodic sweep's window: at most one sweep run is enqueued per window. */
const KNOWLEDGE_PROJECTION_SWEEP_INTERVAL_MS = 60 * 1000

/**
 * A prompt request waits this long for more writes before its run starts, and is never pushed
 * back past the maximum, so a steady stream of writes still gets a run each window.
 */
const PROMPT_DEBOUNCE = { key: KNOWLEDGE_PROJECTION_TASK_ID, delay: '5s', maxDelay: '1m' } as const

/** Trigger.dev requests from one process closer together than this collapse into the first. */
const PROMPT_REQUEST_INTERVAL_MS = 5_000

let lastPromptAt = 0

/** Whether an inline pass is running when no Trigger.dev worker is configured, and whether another is owed. */
let inlineRunning = false
let inlinePassOwed = false

/**
 * Starts a pass in this process without waiting for it: at most one runs at a time, a request while
 * one runs is folded into a single pass after it, and a failed pass is logged without dropping one
 * owed after it. The loop reads the owed flag and clears the running flag in the same synchronous
 * step, so a request can never land between the two and be dropped. The pass module loads on first
 * use. For deployments without a Trigger.dev worker, whose sweep and writes run passes here, as
 * their document processing does.
 */
function runInline(): void {
  if (inlineRunning) {
    inlinePassOwed = true
    return
  }
  inlineRunning = true
  void (async () => {
    for (;;) {
      inlinePassOwed = false
      try {
        const { runKnowledgeProjectionPass } = await import('@/lib/knowledge/projection/run')
        await runKnowledgeProjectionPass({ budgetMs: KNOWLEDGE_PROJECTION_PASS_BUDGET_MS })
      } catch (error) {
        logger.error('Inline knowledge projection pass failed', { error: getErrorMessage(error) })
      }
      if (!inlinePassOwed) {
        inlineRunning = false
        return
      }
    }
  })()
}

/**
 * Whether passes run on Trigger.dev, by the rule document processing dispatches with: inside a
 * Trigger.dev run always, and otherwise only where Trigger.dev is enabled and the secret key the
 * SDK authenticates with is set.
 */
function projectsOnTrigger(): boolean {
  return isInsideTriggerRun() || Boolean(isTriggerDevEnabled && env.TRIGGER_SECRET_KEY)
}

/**
 * Asks for a projector pass soon after a knowledge write commits, so its marked documents are
 * converged within seconds rather than at the next sweep. Debounced twice: in this process, and
 * across processes by the task's debounce key. Without a Trigger.dev worker the pass runs in this
 * process, one at a time, as document processing does there. Never throws: a request that fails
 * leaves the marks to the sweep, which keeps enqueueing a pass every minute until one runs.
 */
export async function requestKnowledgeProjection(): Promise<void> {
  if (!projectsOnTrigger()) {
    runInline()
    return
  }
  const now = Date.now()
  if (now - lastPromptAt < PROMPT_REQUEST_INTERVAL_MS) return
  lastPromptAt = now
  try {
    const [{ tasks }, { resolveTriggerRegion }] = await Promise.all([
      import('@trigger.dev/sdk'),
      import('@/lib/core/async-jobs/region'),
    ])
    await tasks.trigger(KNOWLEDGE_PROJECTION_TASK_ID, undefined, {
      debounce: PROMPT_DEBOUNCE,
      region: await resolveTriggerRegion(),
    })
  } catch (error) {
    logger.warn('Knowledge projection request failed; the sweep will pick the marks up', {
      error: getErrorMessage(error),
    })
  }
}

export interface KnowledgeProjectionSweepResult {
  /** Whether a pass was started; the sweep starts none when nothing is marked or left to fill. */
  triggered: boolean
  backend: 'trigger-dev' | 'inline' | null
  jobId: string | null
}

/**
 * Whether a pass would find anything to do: a marked document, or, while the fill is on, a
 * projection row it has not reached. Each is one probe of an index that is empty once the
 * projector has caught up.
 */
async function hasKnowledgeProjectionWork(): Promise<boolean> {
  const fill = await isFeatureEnabled('knowledge-projection-fill')
  const unfilled = SOURCE_ACL_PROJECTIONS.map(
    (projection) => `EXISTS (SELECT 1 FROM ${projection} WHERE acl IS NULL)`
  ).join(' OR ')
  const [row] = await db.execute<{ pending: boolean }>(
    sql`SELECT EXISTS (SELECT 1 FROM knowledge_projection_dirty)${fill ? sql.raw(` OR ${unfilled}`) : sql``} AS pending`
  )
  return Boolean(row?.pending)
}

/**
 * The periodic sweep behind the prompt requests: one pass per window while there is work, so a
 * mark whose request was lost, or a document a pass gave up, is still converged, and an idle
 * deployment starts no pass at all.
 */
export async function enqueueKnowledgeProjectionSweep(): Promise<KnowledgeProjectionSweepResult> {
  if (!(await hasKnowledgeProjectionWork())) {
    return { triggered: false, backend: null, jobId: null }
  }
  if (!projectsOnTrigger()) {
    runInline()
    return { triggered: true, backend: 'inline', jobId: null }
  }
  const [{ tasks }, { resolveTriggerRegion }] = await Promise.all([
    import('@trigger.dev/sdk'),
    import('@/lib/core/async-jobs/region'),
  ])
  const window = Math.floor(Date.now() / KNOWLEDGE_PROJECTION_SWEEP_INTERVAL_MS)
  const handle = await tasks.trigger(KNOWLEDGE_PROJECTION_TASK_ID, undefined, {
    idempotencyKey: `${KNOWLEDGE_PROJECTION_TASK_ID}:sweep:${window}`,
    idempotencyKeyTTL: '5m',
    region: await resolveTriggerRegion(),
    ttl: '5m',
  })
  return { triggered: true, backend: 'trigger-dev', jobId: handle.id }
}
