import { db } from '@sim/db'
import type { WorkspaceMode } from '@sim/db/schema'
import { organization, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { tasks } from '@trigger.dev/sdk'
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { getHighestPriorityPersonalSubscription } from '@/lib/billing/core/subscription'
import { getPlanType, type PlanCategory } from '@/lib/billing/plan-helpers'
import { getJobQueue } from '@/lib/core/async-jobs'
import { shouldExecuteInline } from '@/lib/core/async-jobs/config'
import type { EnqueueOptions } from '@/lib/core/async-jobs/types'
import { isTriggerAvailable } from '@/lib/knowledge/documents/service'
import { isOrganizationWorkspace, WORKSPACE_MODE } from '@/lib/workspaces/policy'

const logger = createLogger('RetentionDispatcher')

const BATCH_TRIGGER_CHUNK_SIZE = 1000
const WORKSPACE_SCOPE_PAGE_SIZE = 500
const WORKSPACE_PAYLOAD_CHUNK_SIZE = 500

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
  | { plan: NonEnterprisePlan; workspaceIds?: string[]; runGlobalMaintenance?: boolean }
  | { plan: 'enterprise'; workspaceId: string }

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

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size))
  }
  return chunks
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

async function listActiveWorkspaceCleanupScopeRowsByIds(
  workspaceIds: string[]
): Promise<WorkspaceCleanupScopeRow[]> {
  if (workspaceIds.length === 0) return []

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
    .where(and(isNull(workspace.archivedAt), inArray(workspace.id, workspaceIds)))

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

async function resolveCurrentWorkspaceIdsForPlan(
  plan: NonEnterprisePlan,
  workspaceIds: string[]
): Promise<string[]> {
  const scopedWorkspaceIds: string[] = []

  for (const chunk of chunkArray(workspaceIds, WORKSPACE_PAYLOAD_CHUNK_SIZE)) {
    const rows = await listActiveWorkspaceCleanupScopeRowsByIds(chunk)
    const planByWorkspaceId = await resolvePlanTypesByWorkspaceId(rows)
    scopedWorkspaceIds.push(
      ...rows.filter((row) => planByWorkspaceId.get(row.id) === plan).map((row) => row.id)
    )
  }

  return scopedWorkspaceIds
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
    if (!payload.workspaceIds) {
      logger.warn(
        `[${payload.plan}] Cleanup payload missing workspaceIds; skipping unsafe broad scan`
      )
      return { workspaceIds: [], retentionHours, label: payload.plan }
    }
    const workspaceIds = await resolveCurrentWorkspaceIdsForPlan(payload.plan, payload.workspaceIds)
    return { workspaceIds, retentionHours, label: payload.plan }
  }

  const [row] = await db
    .select({
      id: workspace.id,
      organizationId: workspace.organizationId,
      workspaceMode: workspace.workspaceMode,
      billedAccountUserId: workspace.billedAccountUserId,
      settings: organization.dataRetentionSettings,
    })
    .from(workspace)
    .innerJoin(organization, eq(organization.id, workspace.organizationId))
    .where(eq(workspace.id, payload.workspaceId))
    .limit(1)

  if (!row || !isOrganizationWorkspace(row)) return null

  const organizationId = row.organizationId
  if (!organizationId) return null

  const subscription = await getOrganizationSubscription(organizationId, { onError: 'throw' })
  if (getPlanType(subscription?.plan) !== 'enterprise') return null

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

async function enqueuePlanWorkspaceChunk({
  jobType,
  plan,
  workspaceIds,
  jobQueue,
  inlineRunner,
  runGlobalMaintenance = false,
}: {
  jobType: CleanupJobType
  plan: NonEnterprisePlan
  workspaceIds: string[]
  jobQueue: Awaited<ReturnType<typeof getJobQueue>>
  inlineRunner: EnqueueOptions['runner'] | undefined
  runGlobalMaintenance?: boolean
}): Promise<string> {
  const payload: CleanupJobPayload = { plan, workspaceIds, runGlobalMaintenance }
  if (inlineRunner) {
    try {
      await inlineRunner(payload, new AbortController().signal)
      return `inline:${jobType}:${plan}:${workspaceIds[0] ?? 'global'}`
    } catch (error) {
      logger.error(`[${jobType}] Inline cleanup chunk failed`, { plan, workspaceIds, error })
      return ''
    }
  }

  return jobQueue.enqueue(jobType, payload, {
    concurrencyKey: getCleanupConcurrencyKey(jobType),
  })
}

async function enqueueEnterpriseWorkspaceRows({
  jobType,
  rows,
  jobQueue,
  inlineRunner,
}: {
  jobType: CleanupJobType
  rows: WorkspaceCleanupScopeRow[]
  jobQueue: Awaited<ReturnType<typeof getJobQueue>>
  inlineRunner: EnqueueOptions['runner'] | undefined
}): Promise<string[]> {
  if (rows.length === 0) return []

  if (inlineRunner) {
    const jobIds: string[] = []
    for (const row of rows) {
      const payload: CleanupJobPayload = { plan: 'enterprise', workspaceId: row.id }
      try {
        await inlineRunner(payload, new AbortController().signal)
        jobIds.push(`inline:${jobType}:enterprise:${row.id}`)
      } catch (error) {
        logger.error(`[${jobType}] Inline enterprise cleanup failed`, {
          workspaceId: row.id,
          error,
        })
      }
    }
    return jobIds
  }

  if (isTriggerAvailable()) {
    const jobIds: string[] = []
    for (const chunk of chunkArray(rows, BATCH_TRIGGER_CHUNK_SIZE)) {
      const batchResult = await tasks.batchTrigger(
        jobType,
        chunk.map((row) => ({
          payload: { plan: 'enterprise' as const, workspaceId: row.id },
          options: {
            tags: [`workspaceId:${row.id}`, `jobType:${jobType}`],
            concurrencyKey: getCleanupConcurrencyKey(jobType),
          },
        }))
      )
      jobIds.push(batchResult.batchId)
    }
    return jobIds
  }

  const results = await Promise.allSettled(
    rows.map((row) => {
      const payload: CleanupJobPayload = { plan: 'enterprise', workspaceId: row.id }
      return jobQueue.enqueue(jobType, payload, {
        concurrencyKey: getCleanupConcurrencyKey(jobType),
      })
    })
  )

  const jobIds: string[] = []
  let failed = 0
  for (const result of results) {
    if (result.status === 'fulfilled') {
      jobIds.push(result.value)
    } else {
      failed++
      logger.error(`[${jobType}] Failed to enqueue enterprise job:`, { reason: result.reason })
    }
  }

  if (failed > 0) {
    logger.info(`[${jobType}] Enterprise enqueue: ${jobIds.length} succeeded, ${failed} failed`)
  }

  return jobIds
}

/**
 * Dispatcher: enqueue cleanup jobs driven by `CLEANUP_CONFIG`.
 *
 * - One chunked job per non-enterprise plan/workspace page with a non-null default
 * - One enterprise job per workspace whose owning organization has a non-null
 *   retention value for this job's key
 *
 * Workspaces are paged so the cron route never materializes the platform's
 * full active workspace set. Inline database fallback executes chunks directly
 * and sequentially so it does not create a backlog of in-process runners.
 */
export async function dispatchCleanupJobs(
  jobType: CleanupJobType
): Promise<{ jobIds: string[]; jobCount: number; enterpriseCount: number }> {
  const config = CLEANUP_CONFIG[jobType]
  const jobQueue = await getJobQueue()
  const jobIds: string[] = []

  const plansWithDefaults = NON_ENTERPRISE_PLANS.filter((plan) => config.defaults[plan] !== null)
  const inlineRunner = shouldExecuteInline() ? await buildCleanupRunner(jobType) : undefined
  let enterpriseCount = 0
  let freeGlobalMaintenanceEnqueued = false
  let afterId: string | null = null

  while (true) {
    const rows = await listActiveWorkspaceCleanupScopeRowsPage(afterId)
    if (rows.length === 0) break

    afterId = rows[rows.length - 1].id
    const planByWorkspaceId = await resolvePlanTypesByWorkspaceId(rows)

    for (const plan of plansWithDefaults) {
      const matchingWorkspaceIds = rows
        .filter((row) => planByWorkspaceId.get(row.id) === plan)
        .map((row) => row.id)

      for (const workspaceIds of chunkArray(matchingWorkspaceIds, WORKSPACE_PAYLOAD_CHUNK_SIZE)) {
        const runGlobalMaintenance =
          jobType === 'cleanup-logs' && plan === 'free' && !freeGlobalMaintenanceEnqueued
        const jobId = await enqueuePlanWorkspaceChunk({
          jobType,
          plan,
          workspaceIds,
          jobQueue,
          inlineRunner,
          runGlobalMaintenance,
        })
        if (jobId) {
          jobIds.push(jobId)
          if (runGlobalMaintenance) {
            freeGlobalMaintenanceEnqueued = true
          }
        }
      }
    }

    const enterpriseRows = rows.filter(
      (row) =>
        planByWorkspaceId.get(row.id) === 'enterprise' &&
        row.organizationSettings?.[config.key] != null
    )
    enterpriseCount += enterpriseRows.length
    jobIds.push(
      ...(await enqueueEnterpriseWorkspaceRows({
        jobType,
        rows: enterpriseRows,
        jobQueue,
        inlineRunner,
      }))
    )
  }

  if (
    jobType === 'cleanup-logs' &&
    plansWithDefaults.includes('free') &&
    !freeGlobalMaintenanceEnqueued
  ) {
    const jobId = await enqueuePlanWorkspaceChunk({
      jobType,
      plan: 'free',
      workspaceIds: [],
      jobQueue,
      inlineRunner,
      runGlobalMaintenance: true,
    })
    if (jobId) {
      jobIds.push(jobId)
    }
  }

  const planLabels = plansWithDefaults.join('+') || 'none'
  logger.info(
    `[${jobType}] Dispatched: plans=[${planLabels}], enterpriseWorkspaces=${enterpriseCount}, jobs=${jobIds.length} (key: ${config.key})`
  )

  return { jobIds, jobCount: jobIds.length, enterpriseCount }
}
