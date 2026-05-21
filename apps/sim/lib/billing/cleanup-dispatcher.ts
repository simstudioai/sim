import { db } from '@sim/db'
import type { WorkspaceMode } from '@sim/db/schema'
import { organization, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { tasks } from '@trigger.dev/sdk'
import { eq, isNull } from 'drizzle-orm'
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
      organizationId: workspace.organizationId,
      workspaceMode: workspace.workspaceMode,
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

async function buildCleanupChunks(jobType: CleanupJobType): Promise<CleanupJobPayload[]> {
  const config = CLEANUP_CONFIG[jobType]
  const activeRows = await listActiveWorkspaceCleanupScopeRows()
  const planByWorkspaceId = await resolvePlanTypesByWorkspaceId(activeRows)

  const chunks: CleanupJobPayload[] = []

  for (const plan of NON_ENTERPRISE_PLANS) {
    const retentionHours = config.defaults[plan]
    if (retentionHours === null) continue
    const workspaceIds = activeRows
      .filter((row) => planByWorkspaceId.get(row.id) === plan)
      .map((row) => row.id)
    if (workspaceIds.length === 0) continue
    const planChunks = chunkArray(workspaceIds, WORKSPACES_PER_CLEANUP_CHUNK)
    for (const [idx, ws] of planChunks.entries()) {
      chunks.push({
        plan,
        workspaceIds: ws,
        retentionHours,
        label: planChunks.length > 1 ? `${plan}/${idx + 1}` : plan,
      })
    }
  }

  for (const row of activeRows) {
    if (planByWorkspaceId.get(row.id) !== 'enterprise') continue
    const hours = row.organizationSettings?.[config.key]
    if (hours == null) continue
    chunks.push({
      plan: 'enterprise',
      workspaceIds: [row.id],
      retentionHours: hours,
      label: `enterprise/${row.id}`,
    })
  }

  const housekeepingPlan = GLOBAL_HOUSEKEEPING_PLAN[jobType]
  if (housekeepingPlan) {
    const target = chunks.find((c) => c.plan === housekeepingPlan)
    if (target) {
      target.runGlobalHousekeeping = true
    } else if (housekeepingPlan !== 'enterprise') {
      // Synthetic empty chunk so housekeeping still fires when the plan has no workspaces.
      const retentionHours = config.defaults[housekeepingPlan]
      if (retentionHours != null) {
        chunks.push({
          plan: housekeepingPlan,
          workspaceIds: [],
          retentionHours,
          label: `${housekeepingPlan}/housekeeping`,
          runGlobalHousekeeping: true,
        })
      }
    }
  }

  return chunks
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
  const chunks = await buildCleanupChunks(jobType)
  const workspaceCount = chunks.reduce((sum, c) => sum + c.workspaceIds.length, 0)

  logger.info(
    `[${jobType}] Dispatching: ${chunks.length} chunk(s) covering ${workspaceCount} workspace(s)`
  )

  if (chunks.length === 0) {
    return { jobIds: [], jobCount: 0, chunkCount: 0, workspaceCount: 0 }
  }

  const jobIds: string[] = []

  if (isTriggerAvailable()) {
    for (let i = 0; i < chunks.length; i += BATCH_TRIGGER_CHUNK_SIZE) {
      const batch = chunks.slice(i, i + BATCH_TRIGGER_CHUNK_SIZE)
      const batchResult = await tasks.batchTrigger(
        jobType,
        batch.map((payload) => ({
          payload,
          options: {
            tags: [`plan:${payload.plan}`, `jobType:${jobType}`],
          },
        }))
      )
      jobIds.push(batchResult.batchId)
    }
    return { jobIds, jobCount: jobIds.length, chunkCount: chunks.length, workspaceCount }
  }

  // Fallback: parallel enqueue via abstraction (self-hosted / inline path)
  const inlineRunner = shouldExecuteInline() ? await buildCleanupRunner(jobType) : undefined
  const jobQueue = await getJobQueue()
  const results = await Promise.allSettled(
    chunks.map((payload) => jobQueue.enqueue(jobType, payload, { runner: inlineRunner }))
  )

  let succeeded = 0
  let failed = 0
  for (const result of results) {
    if (result.status === 'fulfilled') {
      jobIds.push(result.value)
      succeeded++
    } else {
      failed++
      logger.error(`[${jobType}] Failed to enqueue chunk:`, { reason: result.reason })
    }
  }
  logger.info(`[${jobType}] Chunk enqueue: ${succeeded} succeeded, ${failed} failed`)

  return { jobIds, jobCount: jobIds.length, chunkCount: chunks.length, workspaceCount }
}
