import { db } from '@sim/db'
import type { WorkspaceMode } from '@sim/db/schema'
import { organization, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { tasks } from '@trigger.dev/sdk'
import { and, asc, eq, gt, isNull } from 'drizzle-orm'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { getHighestPriorityPersonalSubscription } from '@/lib/billing/core/subscription'
import { getPlanType, type PlanCategory } from '@/lib/billing/plan-helpers'
import { chunkArray } from '@/lib/cleanup/batch-delete'
import { getJobQueue } from '@/lib/core/async-jobs'
import { shouldExecuteInline } from '@/lib/core/async-jobs/config'
import type { EnqueueOptions } from '@/lib/core/async-jobs/types'
import { isTriggerAvailable } from '@/lib/knowledge/documents/service'
import { isOrganizationWorkspace, WORKSPACE_MODE } from '@/lib/workspaces/policy'

const logger = createLogger('RetentionDispatcher')

/** Trigger.dev's documented cap on items per `batchTrigger` call (SDK 4.3.1+). */
const BATCH_TRIGGER_CHUNK_SIZE = 1000
const WORKSPACE_SCOPE_PAGE_SIZE = 500

/** Bounds per-run memory + DB connections regardless of plan size. */
const WORKSPACES_PER_CLEANUP_CHUNK = 500

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

export interface CleanupJobPayload {
  plan: PlanCategory
  workspaceIds: string[]
  retentionHours: number
  label: string
  /** Set on exactly one chunk per dispatch so plan-wide housekeeping runs once. */
  runGlobalHousekeeping?: boolean
}

interface CleanupJobConfig {
  key: OrganizationRetentionKey
  defaults: Record<PlanCategory, number | null>
}

interface WorkspaceCleanupScopeRow {
  id: string
  billedAccountUserId: string
  organizationId: string | null
  workspaceMode: WorkspaceMode
  organizationSettings: OrganizationRetentionSettings | null
}

const DAY = 24

type PlanResolutionEntry = readonly [string, PlanCategory]

function getCleanupConcurrencyKey(jobType: CleanupJobType): string {
  return `cleanup:${jobType}`
}

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

async function listActiveWorkspaceCleanupScopeRowsPage(
  afterId: string | null
): Promise<WorkspaceCleanupScopeRow[]> {
  const rows = await db
    .select({
      id: workspace.id,
      billedAccountUserId: workspace.billedAccountUserId,
      organizationId: workspace.organizationId,
      workspaceMode: workspace.workspaceMode,
      organizationSettings: organization.dataRetentionSettings,
    })
    .from(workspace)
    .leftJoin(organization, eq(organization.id, workspace.organizationId))
    .where(
      afterId
        ? and(isNull(workspace.archivedAt), gt(workspace.id, afterId))
        : isNull(workspace.archivedAt)
    )
    .orderBy(asc(workspace.id))
    .limit(WORKSPACE_SCOPE_PAGE_SIZE)

  return rows.map((row) => ({
    ...row,
    organizationSettings:
      (row.organizationSettings as OrganizationRetentionSettings | null) ?? null,
  }))
}

async function resolvePersonalPlanTypesByBilledUserId(
  rows: WorkspaceCleanupScopeRow[]
): Promise<Map<string, PlanCategory>> {
  const billedUserIds = Array.from(new Set(rows.map((row) => row.billedAccountUserId)))
  const entries = await Promise.all(
    billedUserIds.map(async (userId) => {
      try {
        const subscription = await getHighestPriorityPersonalSubscription(userId, {
          onError: 'throw',
        })
        return [userId, getPlanType(subscription?.plan)] as const
      } catch (error) {
        logger.error('Skipping cleanup for billed user after plan lookup failed', {
          userId,
          error,
        })
        return null
      }
    })
  )

  return new Map(entries.filter((entry): entry is PlanResolutionEntry => entry !== null))
}

async function resolvePlanTypesByWorkspaceId(
  rows: WorkspaceCleanupScopeRow[]
): Promise<Map<string, PlanCategory>> {
  const userScopedRows = rows.filter((row) => row.workspaceMode !== WORKSPACE_MODE.ORGANIZATION)
  const userPlanByBilledUserId = await resolvePersonalPlanTypesByBilledUserId(userScopedRows)
  const entries = await Promise.all(
    rows.map(async (row) => {
      if (row.workspaceMode === WORKSPACE_MODE.ORGANIZATION) {
        const organizationId = isOrganizationWorkspace(row) ? row.organizationId : null
        if (!organizationId) {
          logger.error('Skipping cleanup for malformed organization workspace', {
            workspaceId: row.id,
            organizationId: row.organizationId,
          })
          return null
        }

        try {
          const subscription = await getOrganizationSubscription(organizationId, {
            onError: 'throw',
          })
          if (!subscription) {
            logger.warn('Skipping cleanup for organization workspace without an org subscription', {
              workspaceId: row.id,
              organizationId,
            })
            return null
          }

          return [row.id, getPlanType(subscription?.plan)] as const
        } catch (error) {
          logger.error('Skipping cleanup for organization workspace after plan lookup failed', {
            workspaceId: row.id,
            organizationId,
            error,
          })
          return null
        }
      }

      const plan = userPlanByBilledUserId.get(row.billedAccountUserId)
      if (plan === undefined) {
        return null
      }

      return [row.id, plan] as const
    })
  )

  return new Map(entries.filter((entry): entry is PlanResolutionEntry => entry !== null))
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

/** Job type → plan whose housekeeping is global, not per-workspace. */
const GLOBAL_HOUSEKEEPING_PLAN: Partial<Record<CleanupJobType, PlanCategory>> = {
  'cleanup-logs': 'free',
}

async function forEachCleanupChunk(
  jobType: CleanupJobType,
  onChunk: (payload: CleanupJobPayload) => Promise<void>
): Promise<{ chunkCount: number; workspaceCount: number }> {
  const config = CLEANUP_CONFIG[jobType]
  const chunkCountByPlan: Partial<Record<NonEnterprisePlan, number>> = {}
  const housekeepingPlan = GLOBAL_HOUSEKEEPING_PLAN[jobType]
  let housekeepingAssigned = false
  let workspaceCount = 0
  let chunkCount = 0
  let afterId: string | null = null

  const emitChunk = async (payload: CleanupJobPayload) => {
    if (payload.plan === housekeepingPlan && !housekeepingAssigned) {
      payload.runGlobalHousekeeping = true
      housekeepingAssigned = true
    }
    chunkCount++
    await onChunk(payload)
  }

  while (true) {
    const rows = await listActiveWorkspaceCleanupScopeRowsPage(afterId)
    if (rows.length === 0) break

    afterId = rows[rows.length - 1].id
    const planByWorkspaceId = await resolvePlanTypesByWorkspaceId(rows)

    for (const plan of NON_ENTERPRISE_PLANS) {
      const retentionHours = config.defaults[plan]
      if (retentionHours === null) continue

      const workspaceIds = rows
        .filter((row) => planByWorkspaceId.get(row.id) === plan)
        .map((row) => row.id)
      if (workspaceIds.length === 0) continue

      workspaceCount += workspaceIds.length
      const planChunks = chunkArray(workspaceIds, WORKSPACES_PER_CLEANUP_CHUNK)
      for (const ws of planChunks) {
        const chunkNumber = (chunkCountByPlan[plan] ?? 0) + 1
        chunkCountByPlan[plan] = chunkNumber
        await emitChunk({
          plan,
          workspaceIds: ws,
          retentionHours,
          label: `${plan}/${chunkNumber}`,
        })
      }
    }

    for (const row of rows) {
      if (planByWorkspaceId.get(row.id) !== 'enterprise') continue
      const hours = row.organizationSettings?.[config.key]
      if (hours == null) continue
      workspaceCount++
      await emitChunk({
        plan: 'enterprise',
        workspaceIds: [row.id],
        retentionHours: hours,
        label: `enterprise/${row.id}`,
      })
    }
  }

  if (housekeepingPlan && housekeepingPlan !== 'enterprise' && !housekeepingAssigned) {
    const retentionHours = config.defaults[housekeepingPlan]
    if (retentionHours != null) {
      await emitChunk({
        plan: housekeepingPlan,
        workspaceIds: [],
        retentionHours,
        label: `${housekeepingPlan}/housekeeping`,
        runGlobalHousekeeping: true,
      })
    }
  }

  return { chunkCount, workspaceCount }
}

/**
 * Resolve the workspace set + retention cutoff once, then fan out one task
 * run per `WORKSPACES_PER_CLEANUP_CHUNK` workspaces via `tasks.batchTrigger`.
 * Falls back to `JobQueueBackend` enqueue when Trigger.dev isn't available.
 */
export async function dispatchCleanupJobs(jobType: CleanupJobType): Promise<{
  jobIds: string[]
  jobCount: number
  chunkCount: number
  workspaceCount: number
}> {
  const jobIds: string[] = []
  let succeeded = 0
  let failed = 0

  if (isTriggerAvailable()) {
    let batch: CleanupJobPayload[] = []
    const flushBatch = async () => {
      if (batch.length === 0) return
      const currentBatch = batch
      batch = []
      const batchResult = await tasks.batchTrigger(
        jobType,
        currentBatch.map((payload) => ({
          payload,
          options: {
            tags: [`plan:${payload.plan}`, `jobType:${jobType}`],
            concurrencyKey: getCleanupConcurrencyKey(jobType),
          },
        }))
      )
      jobIds.push(batchResult.batchId)
      succeeded += currentBatch.length
    }

    const { chunkCount, workspaceCount } = await forEachCleanupChunk(jobType, async (payload) => {
      batch.push(payload)
      if (batch.length >= BATCH_TRIGGER_CHUNK_SIZE) {
        await flushBatch()
      }
    })
    await flushBatch()

    logger.info(
      `[${jobType}] Trigger cleanup chunks: ${succeeded} dispatched in ${jobIds.length} batch(es)`
    )
    return { jobIds, jobCount: jobIds.length, chunkCount, workspaceCount }
  }

  const inlineRunner = shouldExecuteInline() ? await buildCleanupRunner(jobType) : undefined
  if (inlineRunner) {
    const { chunkCount, workspaceCount } = await forEachCleanupChunk(jobType, async (payload) => {
      try {
        await inlineRunner(payload, new AbortController().signal)
        jobIds.push(`inline:${jobType}:${payload.label}`)
        succeeded++
      } catch (error) {
        failed++
        logger.error(`[${jobType}] Inline cleanup chunk failed:`, {
          plan: payload.plan,
          label: payload.label,
          error,
        })
      }
    })

    logger.info(`[${jobType}] Inline cleanup chunks: ${succeeded} succeeded, ${failed} failed`)
    return { jobIds, jobCount: jobIds.length, chunkCount, workspaceCount }
  }

  const jobQueue = await getJobQueue()
  const { chunkCount, workspaceCount } = await forEachCleanupChunk(jobType, async (payload) => {
    try {
      const jobId = await jobQueue.enqueue(jobType, payload, {
        concurrencyKey: getCleanupConcurrencyKey(jobType),
      })
      jobIds.push(jobId)
      succeeded++
    } catch (reason) {
      failed++
      logger.error(`[${jobType}] Failed to enqueue chunk:`, { reason })
    }
  })
  logger.info(`[${jobType}] Chunk enqueue: ${succeeded} succeeded, ${failed} failed`)

  return { jobIds, jobCount: jobIds.length, chunkCount, workspaceCount }
}
