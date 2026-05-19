import { db } from '@sim/db'
import { organization, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { tasks } from '@trigger.dev/sdk'
import { eq, isNull } from 'drizzle-orm'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { getPlanType, type PlanCategory } from '@/lib/billing/plan-helpers'
import { getJobQueue } from '@/lib/core/async-jobs'
import { shouldExecuteInline } from '@/lib/core/async-jobs/config'
import type { EnqueueOptions } from '@/lib/core/async-jobs/types'
import { isTriggerAvailable } from '@/lib/knowledge/documents/service'

const logger = createLogger('RetentionDispatcher')

const BATCH_TRIGGER_CHUNK_SIZE = 1000

export type CleanupJobType = 'cleanup-logs' | 'cleanup-soft-deletes' | 'cleanup-tasks'

export type OrganizationRetentionKey =
  | 'logRetentionHours'
  | 'softDeleteRetentionHours'
  | 'taskCleanupHours'

export type OrganizationRetentionSettings = {
  [K in OrganizationRetentionKey]: number | null
}

export type NonEnterprisePlan = Exclude<PlanCategory, 'enterprise'>

const NON_ENTERPRISE_PLANS = ['free', 'pro', 'team'] as const satisfies readonly NonEnterprisePlan[]

export type CleanupJobPayload =
  | { plan: NonEnterprisePlan }
  | { plan: 'enterprise'; workspaceId: string }

interface CleanupJobConfig {
  key: OrganizationRetentionKey
  defaults: Record<PlanCategory, number | null>
}

interface WorkspaceCleanupScopeRow {
  id: string
  billedAccountUserId: string
  organizationSettings: OrganizationRetentionSettings | null
}

const DAY = 24

/**
 * Single source of truth for cleanup retention: which key each job type reads
 * from `organization.dataRetentionSettings`, and the default retention (in
 * hours) per plan. Enterprise is always `null` here — enterprise orgs must
 * set their own value.
 */
export const CLEANUP_CONFIG = {
  'cleanup-logs': {
    key: 'logRetentionHours',
    defaults: { free: 30 * DAY, pro: null, team: null, enterprise: null },
  },
  'cleanup-soft-deletes': {
    key: 'softDeleteRetentionHours',
    defaults: { free: 30 * DAY, pro: 90 * DAY, team: 90 * DAY, enterprise: null },
  },
  'cleanup-tasks': {
    key: 'taskCleanupHours',
    defaults: { free: null, pro: null, team: null, enterprise: null },
  },
} as const satisfies Record<CleanupJobType, CleanupJobConfig>

async function listActiveWorkspaceCleanupScopeRows(): Promise<WorkspaceCleanupScopeRow[]> {
  const rows = await db
    .select({
      id: workspace.id,
      billedAccountUserId: workspace.billedAccountUserId,
      organizationSettings: organization.dataRetentionSettings,
    })
    .from(workspace)
    .leftJoin(organization, eq(organization.id, workspace.organizationId))
    .where(isNull(workspace.archivedAt))

  return rows.map((row) => ({
    ...row,
    organizationSettings:
      (row.organizationSettings as OrganizationRetentionSettings | null) ?? null,
  }))
}

async function resolvePlanTypesByBilledUserId(
  rows: WorkspaceCleanupScopeRow[]
): Promise<Map<string, PlanCategory>> {
  const billedUserIds = Array.from(new Set(rows.map((row) => row.billedAccountUserId)))
  const entries = await Promise.all(
    billedUserIds.map(async (userId) => {
      const subscription = await getHighestPrioritySubscription(userId, { onError: 'throw' })
      return [userId, getPlanType(subscription?.plan)] as const
    })
  )

  return new Map(entries)
}

/**
 * Bulk-lookup workspace IDs for a non-enterprise plan category using the same
 * effective-plan lookup used by execution, limits, and workspace policy.
 * Enterprise is per-workspace (routed through the owning organization's
 * retention config).
 */
async function resolveWorkspaceIdsForPlan(plan: NonEnterprisePlan): Promise<string[]> {
  const rows = await listActiveWorkspaceCleanupScopeRows()
  const planByBilledUserId = await resolvePlanTypesByBilledUserId(rows)
  return rows
    .filter((row) => planByBilledUserId.get(row.billedAccountUserId) === plan)
    .map((row) => row.id)
}

export interface ResolvedCleanupScope {
  workspaceIds: string[]
  retentionHours: number
  label: string
}

/**
 * Translate a queued cleanup payload into a concrete cleanup scope: the set of
 * workspaces and the retention cutoff to apply. Returns `null` when the plan
 * has no retention configured (default is null, or the enterprise org has not
 * set this key).
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

  const [row] = await db
    .select({ settings: organization.dataRetentionSettings })
    .from(workspace)
    .innerJoin(organization, eq(organization.id, workspace.organizationId))
    .where(eq(workspace.id, payload.workspaceId))
    .limit(1)

  const hours = row?.settings?.[config.key]
  if (hours == null) return null

  return {
    workspaceIds: [payload.workspaceId],
    retentionHours: hours,
    label: `enterprise/${payload.workspaceId}`,
  }
}

async function buildCleanupRunner(jobType: CleanupJobType): Promise<EnqueueOptions['runner']> {
  const cleanupRunner = await (async () => {
    switch (jobType) {
      case 'cleanup-logs':
        return (await import('@/background/cleanup-logs')).runCleanupLogs
      case 'cleanup-soft-deletes':
        return (await import('@/background/cleanup-soft-deletes')).runCleanupSoftDeletes
      case 'cleanup-tasks':
        return (await import('@/background/cleanup-tasks')).runCleanupTasks
    }
  })()
  return ((payload) => cleanupRunner(payload as CleanupJobPayload)) as EnqueueOptions['runner']
}

/**
 * Dispatcher: enqueue cleanup jobs driven by `CLEANUP_CONFIG`.
 *
 * - One job per non-enterprise plan with a non-null default
 * - One enterprise job per workspace whose owning organization has a non-null
 *   retention value for this job's key
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
    const jobId = await jobQueue.enqueue(jobType, payload, {
      runner: shouldExecuteInline() ? await buildCleanupRunner(jobType) : undefined,
    })
    jobIds.push(jobId)
  }

  const activeWorkspaceRows = await listActiveWorkspaceCleanupScopeRows()
  const planByBilledUserId = await resolvePlanTypesByBilledUserId(activeWorkspaceRows)
  const enterpriseRows = activeWorkspaceRows.filter(
    (row) =>
      planByBilledUserId.get(row.billedAccountUserId) === 'enterprise' &&
      row.organizationSettings?.[config.key] != null
  )

  const enterpriseCount = enterpriseRows.length

  const planLabels = plansWithDefaults.join('+') || 'none'
  logger.info(
    `[${jobType}] Dispatching: plans=[${planLabels}] + ${enterpriseCount} enterprise jobs (key: ${config.key})`
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
    const inlineRunner = shouldExecuteInline() ? await buildCleanupRunner(jobType) : undefined
    const results = await Promise.allSettled(
      enterpriseRows.map(async (row) => {
        const payload: CleanupJobPayload = { plan: 'enterprise', workspaceId: row.id }
        return jobQueue.enqueue(jobType, payload, { runner: inlineRunner })
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
