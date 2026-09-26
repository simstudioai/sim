import { db } from '@sim/db'
import {
  hasKnowledgeProjectionWork,
  MARK_RELEASE_BUDGET_MS,
  releaseSettledMarks,
} from '@sim/db/knowledge-projection'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isTriggerAvailable } from '@/lib/core/config/trigger-availability'
import { isIndexedOrgSearchEnabled } from '@/lib/sim-search/indexed/gate'

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

/** Whether an inline pass is running when no Trigger.dev worker is configured, and whether another is owed. */
let inlineRunning = false
let inlinePassOwed = false

/**
 * Starts a pass in this process without waiting for it: at most one runs at a time, a sweep while
 * one runs is folded into a single pass after it, and a failed pass is logged without dropping one
 * owed after it. The loop reads the owed flag and clears the running flag in the same synchronous
 * step, so a sweep can never land between the two and be dropped. The pass module loads on first
 * use. For deployments without a Trigger.dev worker, whose sweep runs passes here, as their
 * document processing does.
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

export interface KnowledgeProjectionSweepResult {
  /** Whether a pass was started; the sweep starts none when nothing is marked. */
  triggered: boolean
  backend: 'trigger-dev' | 'inline' | null
  jobId: string | null
}

/**
 * The knowledge projector's only trigger: one pass per window while marks need one, so marks are
 * settled within about a minute of their write, a document a pass gave up is retried by the next,
 * and an idle deployment starts no pass at all. The sweep first releases, on the pooled database,
 * the marks no pass is owed, so the always-on marking of writes never starts one. While indexed
 * organization search is off that is every mark without content to project, search-index ones
 * included, since nothing reads their mirrored source and ACL.
 */
export async function enqueueKnowledgeProjectionSweep(): Promise<KnowledgeProjectionSweepResult> {
  const scope = { searchIndexes: isIndexedOrgSearchEnabled() }
  let release = { drained: false, empty: false }
  try {
    release = await releaseSettledMarks(db.$client, Date.now() + MARK_RELEASE_BUDGET_MS, scope)
  } catch (error) {
    /** A release that failed leaves its marks for the next sweep; whether a pass is owed still stands. */
    logger.warn('Releasing settled projection marks failed', { error: getErrorMessage(error) })
  }
  if (release.empty || !(await hasKnowledgeProjectionWork(db.$client, release, scope))) {
    return { triggered: false, backend: null, jobId: null }
  }
  if (!isTriggerAvailable()) {
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
