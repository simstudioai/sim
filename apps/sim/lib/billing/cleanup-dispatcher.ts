import { db } from '@sim/db'
import { subscription, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { tasks } from '@trigger.dev/sdk'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { type PlanCategory, sqlIsPaid, sqlIsPro, sqlIsTeam } from '@/lib/billing/plan-helpers'
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { getJobQueue } from '@/lib/core/async-jobs'
import { shouldExecuteInline } from '@/lib/core/async-jobs/config'
import { isTriggerAvailable } from '@/lib/knowledge/documents/service'

const logger = createLogger('RetentionDispatcher')

const BATCH_TRIGGER_CHUNK_SIZE = 1000

export type CleanupJobType = 'cleanup-logs' | 'cleanup-soft-deletes' | 'cleanup-tasks'

export type WorkspaceRetentionColumn =
  | 'logRetentionHours'
  | 'softDeleteRetentionHours'
  | 'taskCleanupHours'

export type NonEnterprisePlan = Exclude<PlanCategory, 'enterprise'>

const NON_ENTERPRISE_PLANS = ['free', 'pro', 'team'] as const satisfies readonly NonEnterprisePlan[]

export type CleanupJobPayload =
  | { plan: NonEnterprisePlan }
  | { plan: 'enterprise'; workspaceId: string }

interface CleanupJobConfig {
  column: WorkspaceRetentionColumn
  defaults: Record<PlanCategory, number | null>
}

const DAY = 24

/**
 * Single source of truth for cleanup retention: which workspace column each job
 * type inspects, and the default retention (in hours) per plan. Enterprise is
 * always `null` here — enterprise tenants must set their own value per workspace.
 */
export const CLEANUP_CONFIG = {
  'cleanup-logs': {
    column: 'logRetentionHours',
    defaults: { free: 30 * DAY, pro: null, team: null, enterprise: null },
  },
  'cleanup-soft-deletes': {
    column: 'softDeleteRetentionHours',
    defaults: { free: 30 * DAY, pro: 90 * DAY, team: 90 * DAY, enterprise: null },
  },
  'cleanup-tasks': {
    column: 'taskCleanupHours',
    defaults: { free: null, pro: null, team: null, enterprise: null },
  },
} as const satisfies Record<CleanupJobType, CleanupJobConfig>

/**
 * Bulk-lookup workspace IDs for a non-enterprise plan category. Enterprise is
 * per-workspace (has explicit opt-in retention), so it's not handled here.
 */
export async function resolveWorkspaceIdsForPlan(plan: NonEnterprisePlan): Promise<string[]> {
  if (plan === 'free') {
    const rows = await db
      .select({ id: workspace.id })
      .from(workspace)
      .leftJoin(
        subscription,
        and(
          eq(subscription.referenceId, workspace.billedAccountUserId),
          inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES),
          sqlIsPaid(subscription.plan)
        )
      )
      .where(and(isNull(subscription.id), isNull(workspace.archivedAt)))

    return rows.map((r) => r.id)
  }

  const planPredicate = plan === 'pro' ? sqlIsPro(subscription.plan) : sqlIsTeam(subscription.plan)
  const rows = await db
    .select({ id: workspace.id })
    .from(workspace)
    .innerJoin(
      subscription,
      and(
        eq(subscription.referenceId, workspace.billedAccountUserId),
        inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES),
        planPredicate!
      )
    )
    .where(isNull(workspace.archivedAt))
    .groupBy(workspace.id)

  return rows.map((r) => r.id)
}

export interface ResolvedCleanupScope {
  workspaceIds: string[]
  retentionHours: number
  label: string
}

/**
 * Translate a queued cleanup payload into a concrete cleanup scope: the set of
 * workspaces and the retention cutoff to apply. Returns `null` when the plan
 * has no retention configured (default is null, or the enterprise workspace
 * has not opted in).
 */
export async function resolveCleanupScope(
  jobType: CleanupJobType,
  payload: CleanupJobPayload
): Promise<ResolvedCleanupScope | null> {
  const config = CLEANUP_CONFIG[jobType]

  if (payload.plan !== 'enterprise') {
    const retentionHours = config.defaults[payload.plan]
    if (retentionHours === null) return null
    const workspaceIds = await resolveWorkspaceIdsForPlan(payload.plan)
    return { workspaceIds, retentionHours, label: payload.plan }
  }

  const [ws] = await db
    .select({ hours: workspace[config.column] })
    .from(workspace)
    .where(eq(workspace.id, payload.workspaceId))
    .limit(1)

  if (ws?.hours == null) return null

  return {
    workspaceIds: [payload.workspaceId],
    retentionHours: ws.hours,
    label: `enterprise/${payload.workspaceId}`,
  }
}

type RunnerFn = (payload: CleanupJobPayload) => Promise<void>

async function getInlineRunner(jobType: CleanupJobType): Promise<RunnerFn> {
  switch (jobType) {
    case 'cleanup-logs': {
      const { runCleanupLogs } = await import('@/background/cleanup-logs')
      return runCleanupLogs
    }
    case 'cleanup-soft-deletes': {
      const { runCleanupSoftDeletes } = await import('@/background/cleanup-soft-deletes')
      return runCleanupSoftDeletes
    }
    case 'cleanup-tasks': {
      const { runCleanupTasks } = await import('@/background/cleanup-tasks')
      return runCleanupTasks
    }
  }
}

/**
 * When the job queue backend is "database" (no Trigger.dev, no BullMQ), the
 * enqueued rows just sit in async_jobs forever. Run them inline as fire-and-forget
 * promises, following the same pattern as the workflow execution API route.
 */
async function runInlineIfNeeded(
  jobQueue: Awaited<ReturnType<typeof getJobQueue>>,
  jobType: CleanupJobType,
  jobId: string,
  payload: CleanupJobPayload
): Promise<void> {
  if (!shouldExecuteInline()) return
  const runner = await getInlineRunner(jobType)
  void (async () => {
    try {
      await jobQueue.startJob(jobId)
      await runner(payload)
      await jobQueue.completeJob(jobId, null)
    } catch (error) {
      const errorMessage = toError(error).message
      logger.error(`[${jobType}] Inline job ${jobId} failed`, { error: errorMessage })
      try {
        await jobQueue.markJobFailed(jobId, errorMessage)
      } catch (markErr) {
        logger.error(`[${jobType}] Failed to mark job ${jobId} as failed`, { markErr })
      }
    }
  })()
}

/**
 * Dispatcher: enqueue cleanup jobs driven by `CLEANUP_CONFIG`.
 *
 * - One job per non-enterprise plan with a non-null default
 * - One enterprise job per workspace with a non-NULL retention value in the column
 *
 * Uses Trigger.dev batchTrigger when available, otherwise parallel enqueue via
 * the JobQueueBackend abstraction. On the database backend (no external worker),
 * jobs run inline in the same process via fire-and-forget promises.
 */
export async function dispatchCleanupJobs(
  jobType: CleanupJobType
): Promise<{ jobIds: string[]; jobCount: number; enterpriseCount: number }> {
  const config = CLEANUP_CONFIG[jobType]
  const jobQueue = await getJobQueue()
  const jobIds: string[] = []

  const plansWithDefaults = NON_ENTERPRISE_PLANS.filter((plan) => config.defaults[plan] !== null)

  for (const plan of plansWithDefaults) {
    const payload: CleanupJobPayload = { plan }
    const jobId = await jobQueue.enqueue(jobType, payload)
    jobIds.push(jobId)
    await runInlineIfNeeded(jobQueue, jobType, jobId, payload)
  }

  // Enterprise: query workspaces with non-NULL retention column. The JOIN can
  // match multiple subscription rows per workspace (e.g. active + past_due both
  // in ENTITLED_SUBSCRIPTION_STATUSES) — groupBy dedupes to one row per workspace
  // so we don't dispatch the same cleanup job twice.
  const retentionCol = workspace[config.column]
  const enterpriseRows = await db
    .select({ id: workspace.id })
    .from(workspace)
    .innerJoin(
      subscription,
      and(
        eq(subscription.referenceId, workspace.billedAccountUserId),
        inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES),
        eq(subscription.plan, 'enterprise')
      )
    )
    .where(and(isNull(workspace.archivedAt), isNotNull(retentionCol)))
    .groupBy(workspace.id)

  const enterpriseCount = enterpriseRows.length

  const planLabels = plansWithDefaults.join('+') || 'none'
  logger.info(
    `[${jobType}] Dispatching: plans=[${planLabels}] + ${enterpriseCount} enterprise jobs (column: ${config.column})`
  )

  if (enterpriseCount === 0) {
    return { jobIds, jobCount: jobIds.length, enterpriseCount: 0 }
  }

  if (isTriggerAvailable()) {
    // Trigger.dev: use batchTrigger, chunked
    for (let i = 0; i < enterpriseRows.length; i += BATCH_TRIGGER_CHUNK_SIZE) {
      const chunk = enterpriseRows.slice(i, i + BATCH_TRIGGER_CHUNK_SIZE)
      const batchResult = await tasks.batchTrigger(
        jobType,
        chunk.map((row) => ({
          payload: { plan: 'enterprise' as const, workspaceId: row.id },
          options: {
            tags: [`workspaceId:${row.id}`, `jobType:${jobType}`],
          },
        }))
      )
      jobIds.push(batchResult.batchId)
    }
  } else {
    // Fallback: parallel enqueue via abstraction
    const results = await Promise.allSettled(
      enterpriseRows.map(async (row) => {
        const payload: CleanupJobPayload = { plan: 'enterprise', workspaceId: row.id }
        const jobId = await jobQueue.enqueue(jobType, payload)
        await runInlineIfNeeded(jobQueue, jobType, jobId, payload)
        return jobId
      })
    )

    let succeeded = 0
    let failed = 0
    for (const result of results) {
      if (result.status === 'fulfilled') {
        jobIds.push(result.value)
        succeeded++
      } else {
        failed++
        logger.error(`[${jobType}] Failed to enqueue enterprise job:`, { reason: result.reason })
      }
    }
    logger.info(`[${jobType}] Enterprise enqueue: ${succeeded} succeeded, ${failed} failed`)
  }

  return { jobIds, jobCount: jobIds.length, enterpriseCount }
}
