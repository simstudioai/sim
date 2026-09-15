import { db } from '@sim/db'
import type { DataRetentionSettings, WorkspaceMode } from '@sim/db/schema'
import { organization, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { chunkArray } from '@sim/utils/helpers'
import { runs, tasks } from '@trigger.dev/sdk'
import { and, asc, eq, gt, isNull } from 'drizzle-orm'
import { validateBoundedCleanupOptions } from '@/lib/api/contracts/cleanup'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { getHighestPriorityPersonalSubscription } from '@/lib/billing/core/subscription'
import { getPlanType, type PlanCategory } from '@/lib/billing/plan-helpers'
import { type RetentionHoursKey, resolveEffectiveRetentionHours } from '@/lib/billing/retention'
import type { CleanupQuery, CleanupTransaction } from '@/lib/cleanup/bounded'
import {
  type BoundedCleanupJobType,
  type BoundedCleanupOptions,
  type BoundedCleanupPayload,
  LOG_CLEANUP_TYPES,
  SOFT_DELETE_CLEANUP_TYPES,
} from '@/lib/cleanup/bounded-types'
import { getJobQueue } from '@/lib/core/async-jobs'
import { shouldExecuteInline } from '@/lib/core/async-jobs/config'
import { resolveTriggerRegion } from '@/lib/core/async-jobs/region'
import type { EnqueueOptions } from '@/lib/core/async-jobs/types'
import { isBillingEnabled, isDataRetentionEnabled } from '@/lib/core/config/env-flags'
import { isTriggerAvailable } from '@/lib/knowledge/documents/service'
import { isOrganizationWorkspace, WORKSPACE_MODE } from '@/lib/workspaces/policy'

const logger = createLogger('RetentionDispatcher')

/** Trigger.dev's documented cap on items per `batchTrigger` call (SDK 4.3.1+). */
const BATCH_TRIGGER_CHUNK_SIZE = 1000
const WORKSPACE_SCOPE_PAGE_SIZE = 500

/** Bounds per-run memory + DB connections regardless of plan size. */
const WORKSPACES_PER_CLEANUP_CHUNK = 500

export type CleanupJobType = 'cleanup-logs' | 'cleanup-soft-deletes' | 'cleanup-tasks'

export type NonEnterprisePlan = Exclude<PlanCategory, 'enterprise'>

const NON_ENTERPRISE_PLANS = ['free', 'pro', 'team'] as const satisfies readonly NonEnterprisePlan[]

export interface CleanupJobPayload {
  plan: PlanCategory
  workspaceIds: string[]
  /** Organization-owned Search data is retained independently of workspace membership. */
  organizationIds?: string[]
  retentionHours: number
  label: string
  /** Set on exactly one chunk per dispatch so plan-wide housekeeping runs once. */
  runGlobalHousekeeping?: boolean
}

interface CleanupJobConfig {
  key: RetentionHoursKey
  defaults: Record<PlanCategory, number | null>
}

interface WorkspaceCleanupScopeRow {
  id: string
  billedAccountUserId: string
  organizationId: string | null
  workspaceMode: WorkspaceMode
  organizationSettings: DataRetentionSettings | null
}

const DAY = 24

type PlanResolutionEntry = readonly [string, PlanCategory]

function getCleanupConcurrencyKey(jobType: CleanupJobType): string | undefined {
  return jobType === 'cleanup-tasks' ? `cleanup:${jobType}` : undefined
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
  afterId: string | null,
  executor: Pick<typeof db, 'select'> = db
): Promise<WorkspaceCleanupScopeRow[]> {
  const rows = await executor
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
    organizationSettings: (row.organizationSettings as DataRetentionSettings | null) ?? null,
  }))
}

async function resolvePersonalPlanTypesByBilledUserId(
  rows: WorkspaceCleanupScopeRow[],
  options: CleanupScopeOptions = {}
): Promise<Map<string, PlanCategory>> {
  const billedUserIds = Array.from(new Set(rows.map((row) => row.billedAccountUserId)))
  const entries = await mapCleanupScopes(billedUserIds, options, async (userId) => {
    try {
      const subscription = await (options.query
        ? options.query((executor) =>
            getHighestPriorityPersonalSubscription(userId, { onError: 'throw', executor })
          )
        : getHighestPriorityPersonalSubscription(userId, { onError: 'throw' }))
      return [userId, getPlanType(subscription?.plan)] as const
    } catch (error) {
      if (options.strict) throw error
      logger.error('Skipping cleanup for billed user after plan lookup failed', {
        userId,
        error,
      })
      return null
    }
  })

  return new Map(entries.filter((entry): entry is PlanResolutionEntry => entry !== null))
}

async function resolvePlanTypesByWorkspaceId(
  rows: WorkspaceCleanupScopeRow[],
  options: CleanupScopeOptions = {}
): Promise<Map<string, PlanCategory>> {
  /**
   * Without billing there are no subscription rows to read, and the per-plan
   * defaults describe hosted tiers the operator never bought — falling through
   * to them would expire logs on a 30-day free-tier window nobody chose.
   *
   * Classifying every workspace as enterprise gives the semantics a self-hosted
   * deployment actually wants: enterprise carries no default, so retention
   * comes only from explicitly configured `organization.dataRetentionSettings`
   * and a workspace with nothing configured keeps its data forever. It also
   * keeps org-owned workspaces in scope, which the subscription lookup below
   * would otherwise skip on every billing-free deployment.
   */
  if (!isBillingEnabled) {
    return new Map(rows.map((row) => [row.id, 'enterprise' as PlanCategory]))
  }

  const userScopedRows = rows.filter((row) => row.workspaceMode !== WORKSPACE_MODE.ORGANIZATION)
  const userPlanByBilledUserId = await resolvePersonalPlanTypesByBilledUserId(
    userScopedRows,
    options
  )
  const entries = await mapCleanupScopes(rows, options, async (row) => {
    if (row.workspaceMode === WORKSPACE_MODE.ORGANIZATION) {
      const organizationId = isOrganizationWorkspace(row) ? row.organizationId : null
      if (!organizationId) {
        if (options.strict) throw new Error(`Malformed organization workspace ${row.id}`)
        logger.error('Skipping cleanup for malformed organization workspace', {
          workspaceId: row.id,
          organizationId: row.organizationId,
        })
        return null
      }

      try {
        const subscription = await (options.query
          ? options.query((executor) =>
              getOrganizationSubscription(organizationId, { onError: 'throw', executor })
            )
          : getOrganizationSubscription(organizationId, { onError: 'throw' }))
        if (!subscription) {
          logger.warn('Skipping cleanup for organization workspace without an org subscription', {
            workspaceId: row.id,
            organizationId,
          })
          return null
        }

        return [row.id, getPlanType(subscription?.plan)] as const
      } catch (error) {
        if (options.strict) throw error
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

type CleanupScopeOptions = {
  shouldStop?: () => boolean
  strict?: boolean
  query?: CleanupQuery
}

export async function forEachCleanupChunk(
  jobType: CleanupJobType,
  onChunk: (payload: CleanupJobPayload) => Promise<void>,
  options: CleanupScopeOptions = {}
): Promise<{ chunkCount: number; workspaceCount: number }> {
  const config = CLEANUP_CONFIG[jobType]
  const chunkCountByPlan: Partial<Record<NonEnterprisePlan, number>> = {}
  const housekeepingPlan = GLOBAL_HOUSEKEEPING_PLAN[jobType]
  let housekeepingAssigned = false
  let workspaceCount = 0
  let chunkCount = 0
  let afterId: string | null = null

  const emitChunk = async (payload: CleanupJobPayload) => {
    if (options.shouldStop?.()) return
    if (payload.plan === housekeepingPlan && !housekeepingAssigned) {
      payload.runGlobalHousekeeping = true
      housekeepingAssigned = true
    }
    chunkCount++
    await onChunk(payload)
  }

  while (!options.shouldStop?.()) {
    const rows: WorkspaceCleanupScopeRow[] = await (options.query
      ? options.query((tx) => listActiveWorkspaceCleanupScopeRowsPage(afterId, tx))
      : listActiveWorkspaceCleanupScopeRowsPage(afterId))
    if (rows.length === 0) break

    afterId = rows[rows.length - 1].id
    const planByWorkspaceId = await resolvePlanTypesByWorkspaceId(rows, options)

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
      if (options.shouldStop?.()) break
      if (planByWorkspaceId.get(row.id) !== 'enterprise') continue
      const hours = resolveEffectiveRetentionHours({
        orgSettings: row.organizationSettings,
        workspaceId: row.id,
        key: config.key,
      })
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

  if (jobType === 'cleanup-soft-deletes' || jobType === 'cleanup-tasks') {
    let afterOrganizationId: string | null = null
    while (!options.shouldStop?.()) {
      const selectOrganizations = async (executor: Pick<CleanupTransaction, 'select'>) =>
        executor
          .select({ id: organization.id, settings: organization.dataRetentionSettings })
          .from(organization)
          .where(afterOrganizationId ? gt(organization.id, afterOrganizationId) : undefined)
          .orderBy(asc(organization.id))
          .limit(WORKSPACE_SCOPE_PAGE_SIZE)
      const organizations = await (options.query
        ? options.query(selectOrganizations)
        : selectOrganizations(db))
      if (organizations.length === 0) break
      afterOrganizationId = organizations[organizations.length - 1].id
      for (const row of organizations) {
        if (options.shouldStop?.()) break
        let plan: PlanCategory = 'enterprise'
        if (isBillingEnabled) {
          try {
            const subscription = await (options.query
              ? options.query((executor) =>
                  getOrganizationSubscription(row.id, { onError: 'throw', executor })
                )
              : getOrganizationSubscription(row.id, { onError: 'throw' }))
            if (!subscription) continue
            plan = getPlanType(subscription.plan)
          } catch (error) {
            if (options.strict) throw error
            logger.error('Skipping organization cleanup after plan lookup failed', {
              organizationId: row.id,
              error,
            })
            continue
          }
        }
        const retentionHours =
          plan === 'enterprise' ? (row.settings?.[config.key] ?? null) : config.defaults[plan]
        if (retentionHours == null) continue
        await emitChunk({
          plan,
          workspaceIds: [],
          organizationIds: [row.id],
          retentionHours,
          label: `${plan}/organization/${row.id}`,
        })
      }
    }
  }

  /**
   * Global housekeeping is keyed to a plan's default retention window, so it
   * only makes sense where those plans exist. Emitting it with billing off
   * would reach for the hosted free-tier window — the same 30 days the
   * per-workspace pass deliberately refuses to apply — and act on it, which is
   * exactly the rule `resolvePlanTypesByWorkspaceId` exists to enforce.
   */
  if (
    isBillingEnabled &&
    housekeepingPlan &&
    housekeepingPlan !== 'enterprise' &&
    !housekeepingAssigned
  ) {
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
  /**
   * Plan-based retention is a hosted billing policy, so a billing-disabled
   * deployment must never start expiring data on hosted defaults it never
   * chose. Retention is therefore opt-in off-hosted: the operator turns it on
   * with `DATA_RETENTION_ENABLED` (or the `ENTERPRISE_ENABLED` suite switch)
   * after configuring the windows they want.
   */
  if (!isBillingEnabled && !isDataRetentionEnabled) {
    logger.info(
      `[${jobType}] Skipping cleanup dispatch: billing is disabled and data retention is not enabled`
    )
    return { jobIds: [], jobCount: 0, chunkCount: 0, workspaceCount: 0 }
  }

  const jobIds: string[] = []
  let succeeded = 0
  let failed = 0

  if (isTriggerAvailable()) {
    let batch: CleanupJobPayload[] = []
    const flushBatch = async () => {
      if (batch.length === 0) return
      const currentBatch = batch
      batch = []
      const region = await resolveTriggerRegion()
      const batchResult = await tasks.batchTrigger(
        jobType,
        currentBatch.map((payload) => ({
          payload,
          options: {
            tags: [`plan:${payload.plan}`, `jobType:${jobType}`],
            concurrencyKey: getCleanupConcurrencyKey(jobType),
            region,
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

/** One idempotent, sequential maintenance run; no inline or queue fallback. */
export async function dispatchBoundedCleanup(
  jobType: BoundedCleanupJobType,
  input: BoundedCleanupOptions
) {
  if (!isBillingEnabled && !isDataRetentionEnabled) throw new Error('Data retention is disabled')
  if (!isTriggerAvailable()) throw new Error('Bounded cleanup requires Trigger.dev')
  const types = jobType === 'cleanup-logs' ? LOG_CLEANUP_TYPES : SOFT_DELETE_CLEANUP_TYPES
  const options = validateBoundedCleanupOptions(input, types)
  const payload: BoundedCleanupPayload = { mode: 'bounded', options }
  const handle = await tasks.trigger(jobType, payload, {
    idempotencyKey: `${jobType}:${options.requestId}`,
    idempotencyKeyTTL: '7d',
    maxAttempts: 1,
    maxDuration: 180,
    tags: [`jobType:${jobType}`, 'cleanup:bounded'],
    region: await resolveTriggerRegion(),
  })
  // The same requestId may have been submitted earlier with different options.
  // Return the original accepted payload rather than claiming the new limits applied.
  const run = await runs.retrieve(handle.id)
  const accepted = run.payload as BoundedCleanupPayload | undefined
  if (accepted?.mode !== 'bounded' || !accepted.options)
    throw new Error('Missing bounded cleanup run payload')
  return {
    triggered: true,
    mode: 'bounded' as const,
    runId: handle.id,
    ...validateBoundedCleanupOptions(accepted.options, types),
  }
}

/** Bounded maintenance resolves payers serially instead of queuing hundreds of reads. */
async function mapCleanupScopes<T, R>(
  rows: T[],
  options: CleanupScopeOptions,
  map: (row: T) => Promise<R>
): Promise<R[]> {
  if (!options.strict) return Promise.all(rows.map(map))
  const result: R[] = []
  for (const row of rows) {
    if (options.shouldStop?.()) break
    result.push(await map(row))
  }
  return result
}
