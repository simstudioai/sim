import { createHash } from 'node:crypto'
import { db } from '@sim/db'
import { usageLog } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { defaultBillingPeriod } from '@/lib/billing/core/billing-period'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import { isOrgScopedSubscription } from '@/lib/billing/subscriptions/utils'
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('UsageLog')

/**
 * Usage log category types
 */
export type UsageLogCategory = 'model' | 'fixed' | 'tool'

/**
 * Usage log source types
 */
export type UsageLogSource =
  | 'workflow'
  | 'wand'
  | 'copilot'
  | 'workspace-chat'
  | 'mcp_copilot'
  | 'mothership_block'
  | 'knowledge-base'
  | 'voice-input'
  | 'enrichment'

/**
 * usage_log sources that make up the "copilot" cost breakdown shown in billing
 * summaries: the copilot agent, mothership/workspace chat, MCP copilot, and
 * mothership blocks. Mirrors the source set billed via /api/billing/update-cost.
 */
export const COPILOT_USAGE_SOURCES: UsageLogSource[] = [
  'copilot',
  'workspace-chat',
  'mcp_copilot',
  'mothership_block',
]

/**
 * Metadata for 'model' category charges
 */
export interface ModelUsageMetadata {
  inputTokens: number
  outputTokens: number
  toolCost?: number
}

/**
 * Union type for all usage log metadata types
 */
export type UsageLogMetadata = ModelUsageMetadata | Record<string, unknown> | null

export type BillingEntityType = 'user' | 'organization'

export interface BillingEntity {
  type: BillingEntityType
  id: string
}

/**
 * A single usage entry to be recorded in the usage_log table.
 */
interface UsageEntry {
  category: UsageLogCategory
  source: UsageLogSource
  description: string
  cost: number
  eventKey?: string
  sourceReference?: string
  metadata?: UsageLogMetadata
}

/**
 * Parameters for the central recordUsage function.
 * This is the single entry point for all billing mutations.
 */
export interface RecordUsageParams {
  /** The user being charged */
  userId: string
  /** One or more usage_log entries to record. Total cost is derived from these. */
  entries: UsageEntry[]
  /** Workspace context */
  workspaceId?: string
  /** Workflow context */
  workflowId?: string
  /** Execution context */
  executionId?: string
  /** Billing entity scope, resolved by caller when already known. */
  billingEntity?: BillingEntity
  /** Billing period bounds, resolved by caller when already known. */
  billingPeriod?: { start: Date; end: Date }
  /**
   * Optional transaction to run the ledger INSERT in. Callers that reconcile a
   * read-then-insert under a lock (e.g. the per-execution advisory lock in the
   * workflow completion path) pass their tx so the insert participates in the
   * same locked transaction. Defaults to the pooled db.
   */
  tx?: DbOrTx
}

export function stableEventKey(parts: Record<string, unknown>): string {
  const payload = Object.keys(parts)
    .sort()
    .map((key) => `${key}:${String(parts[key] ?? '')}`)
    .join('|')
  return createHash('sha256').update(payload).digest('hex')
}

type ResolvedSubscription = Awaited<ReturnType<typeof getHighestPrioritySubscription>>

export interface BillingContext {
  billingEntity: BillingEntity
  billingPeriod: { start: Date; end: Date }
}

/**
 * Derive the billing entity + period from an ALREADY-resolved subscription.
 * Callers that already hold the subscription (e.g. the workflow completion path,
 * which fetches it for usage-threshold emails) can derive the context once and
 * pass it into recordUsage so resolveBillingContext skips a redundant lookup.
 * This is the single source of the entity/period derivation — keep it the only
 * place that maps a subscription to a billing context.
 */
export function deriveBillingContext(
  userId: string,
  subscription: ResolvedSubscription
): BillingContext {
  const billingEntity: BillingEntity =
    subscription && isOrgScopedSubscription(subscription, userId)
      ? { type: 'organization', id: subscription.referenceId }
      : { type: 'user', id: userId }

  const billingPeriod =
    subscription?.periodStart && subscription.periodEnd
      ? { start: subscription.periodStart, end: subscription.periodEnd }
      : defaultBillingPeriod()

  return { billingEntity, billingPeriod }
}

async function resolveBillingContext(
  userId: string,
  billingEntity?: BillingEntity,
  billingPeriod?: { start: Date; end: Date }
): Promise<BillingContext> {
  if (billingEntity && billingPeriod) {
    return { billingEntity, billingPeriod }
  }

  const subscription = await getHighestPrioritySubscription(userId)
  const derived = deriveBillingContext(userId, subscription)
  return {
    billingEntity: billingEntity ?? derived.billingEntity,
    billingPeriod: billingPeriod ?? derived.billingPeriod,
  }
}

/**
 * Returns post-cutover usage for an attributed billing entity/period.
 * Legacy pre-cutover usage remains in userStats as a baseline until reset.
 */
export async function getBillingPeriodUsageCost(
  billingEntity: BillingEntity,
  billingPeriod: { start: Date; end: Date },
  source?: UsageLogSource | UsageLogSource[]
): Promise<number> {
  const conditions = [
    eq(usageLog.billingEntityType, billingEntity.type),
    eq(usageLog.billingEntityId, billingEntity.id),
    eq(usageLog.billingPeriodStart, billingPeriod.start),
    eq(usageLog.billingPeriodEnd, billingPeriod.end),
  ]
  if (source) {
    conditions.push(
      Array.isArray(source) ? inArray(usageLog.source, source) : eq(usageLog.source, source)
    )
  }

  const [row] = await db
    .select({
      cost: sql<string>`COALESCE(SUM(${usageLog.cost}), 0)`,
    })
    .from(usageLog)
    .where(and(...conditions))

  return Number.parseFloat(row?.cost ?? '0')
}

export async function getBillingPeriodUsageCostByUser(
  billingEntity: BillingEntity,
  billingPeriod: { start: Date; end: Date },
  source?: UsageLogSource | UsageLogSource[]
): Promise<Map<string, number>> {
  const conditions = [
    eq(usageLog.billingEntityType, billingEntity.type),
    eq(usageLog.billingEntityId, billingEntity.id),
    eq(usageLog.billingPeriodStart, billingPeriod.start),
    eq(usageLog.billingPeriodEnd, billingPeriod.end),
  ]
  if (source) {
    conditions.push(
      Array.isArray(source) ? inArray(usageLog.source, source) : eq(usageLog.source, source)
    )
  }

  const rows = await db
    .select({
      userId: usageLog.userId,
      cost: sql<string>`COALESCE(SUM(${usageLog.cost}), 0)`,
    })
    .from(usageLog)
    .where(and(...conditions))
    .groupBy(usageLog.userId)

  return new Map(rows.map((row) => [row.userId, Number.parseFloat(row.cost ?? '0')]))
}

/**
 * Records usage as append-only billing events.
 *
 * This intentionally avoids per-event userStats updates: userStats is retained
 * as the pre-cutover period baseline and for low-frequency billing trackers,
 * but usage writes no longer contend on the user_stats row.
 */
export async function recordUsage(params: RecordUsageParams): Promise<void> {
  // The usage ledger is written regardless of BILLING_ENABLED so it is the
  // single, universal source of truth for cost (including self-hosted, where
  // it powers the logs-page cost display). Billing *enforcement* (Stripe /
  // overage) is gated separately by callers, not here.
  const {
    userId,
    entries,
    workspaceId,
    workflowId,
    executionId,
    billingEntity,
    billingPeriod,
    tx,
  } = params

  const validEntries = entries.filter((e) => e.cost > 0)

  if (validEntries.length === 0) {
    return
  }

  const context = await resolveBillingContext(userId, billingEntity, billingPeriod)

  const insertedRows = await (tx ?? db)
    .insert(usageLog)
    .values(
      validEntries.map((entry, index) => {
        const sourceReference =
          entry.sourceReference ??
          [executionId, workflowId, workspaceId, entry.source, entry.description, index]
            .filter((part) => part !== undefined && part !== null && part !== '')
            .join(':')
        const eventKey =
          entry.eventKey ??
          stableEventKey({
            userId,
            source: entry.source,
            category: entry.category,
            description: entry.description,
            sourceReference,
            executionId,
            workflowId,
            workspaceId,
            index,
          })

        return {
          id: generateId(),
          userId,
          category: entry.category,
          source: entry.source,
          description: entry.description,
          metadata: entry.metadata ?? null,
          cost: entry.cost.toString(),
          eventKey,
          billingEntityType: context.billingEntity.type,
          billingEntityId: context.billingEntity.id,
          billingPeriodStart: context.billingPeriod.start,
          billingPeriodEnd: context.billingPeriod.end,
          workspaceId: workspaceId ?? null,
          workflowId: workflowId ?? null,
          executionId: executionId ?? null,
        }
      })
    )
    .onConflictDoNothing({
      target: usageLog.eventKey,
      where: sql`${usageLog.eventKey} IS NOT NULL`,
    })
    .returning({ cost: usageLog.cost })

  const insertedCost = insertedRows.reduce((sum, row) => sum + Number.parseFloat(row.cost), 0)

  if (insertedRows.length < validEntries.length) {
    logger.debug('Skipped duplicate usage events', {
      userId,
      attemptedEntries: validEntries.length,
      insertedEntries: insertedRows.length,
    })
  }

  logger.debug('Recorded usage', {
    userId,
    totalCost: insertedCost,
    entryCount: validEntries.length,
    sources: [...new Set(validEntries.map((e) => e.source))],
  })
}

/**
 * Options for querying usage logs
 */
export interface GetUsageLogsOptions {
  /** Filter by source */
  source?: UsageLogSource
  /** Filter by workspace */
  workspaceId?: string
  /** Start date (inclusive) */
  startDate?: Date
  /** End date (inclusive) */
  endDate?: Date
  /** Maximum number of results */
  limit?: number
  /** Cursor for pagination (log ID) */
  cursor?: string
}

/**
 * Usage log entry returned from queries
 */
interface UsageLogEntry {
  id: string
  createdAt: string
  category: UsageLogCategory
  source: UsageLogSource
  description: string
  metadata?: UsageLogMetadata
  cost: number
  workspaceId?: string
  workflowId?: string
  executionId?: string
}

/**
 * Result from getUserUsageLogs
 */
export interface UsageLogsResult {
  logs: UsageLogEntry[]
  summary: {
    totalCost: number
    bySource: Record<string, number>
  }
  pagination: {
    nextCursor?: string
    hasMore: boolean
  }
}

/**
 * Get usage logs for a user with optional filtering and pagination
 */
export async function getUserUsageLogs(
  userId: string,
  options: GetUsageLogsOptions = {}
): Promise<UsageLogsResult> {
  const { source, workspaceId, startDate, endDate, limit = 50, cursor } = options

  try {
    const conditions = [eq(usageLog.userId, userId)]

    if (source) {
      conditions.push(eq(usageLog.source, source))
    }

    if (workspaceId) {
      conditions.push(eq(usageLog.workspaceId, workspaceId))
    }

    if (startDate) {
      conditions.push(gte(usageLog.createdAt, startDate))
    }

    if (endDate) {
      conditions.push(lte(usageLog.createdAt, endDate))
    }

    if (cursor) {
      const cursorLog = await db
        .select({ createdAt: usageLog.createdAt })
        .from(usageLog)
        .where(eq(usageLog.id, cursor))
        .limit(1)

      if (cursorLog.length > 0) {
        conditions.push(
          sql`(${usageLog.createdAt} < ${cursorLog[0].createdAt} OR (${usageLog.createdAt} = ${cursorLog[0].createdAt} AND ${usageLog.id} < ${cursor}))`
        )
      }
    }

    const logs = await db
      .select()
      .from(usageLog)
      .where(and(...conditions))
      .orderBy(desc(usageLog.createdAt), desc(usageLog.id))
      .limit(limit + 1)

    const hasMore = logs.length > limit
    const resultLogs = hasMore ? logs.slice(0, limit) : logs

    const transformedLogs: UsageLogEntry[] = resultLogs.map((log) => ({
      id: log.id,
      createdAt: log.createdAt.toISOString(),
      category: log.category as UsageLogCategory,
      source: log.source as UsageLogSource,
      description: log.description,
      ...(log.metadata ? { metadata: log.metadata as UsageLogMetadata } : {}),
      cost: Number.parseFloat(log.cost),
      ...(log.workspaceId ? { workspaceId: log.workspaceId } : {}),
      ...(log.workflowId ? { workflowId: log.workflowId } : {}),
      ...(log.executionId ? { executionId: log.executionId } : {}),
    }))

    const summaryConditions = [eq(usageLog.userId, userId)]
    if (source) summaryConditions.push(eq(usageLog.source, source))
    if (workspaceId) summaryConditions.push(eq(usageLog.workspaceId, workspaceId))
    if (startDate) summaryConditions.push(gte(usageLog.createdAt, startDate))
    if (endDate) summaryConditions.push(lte(usageLog.createdAt, endDate))

    const summaryResult = await db
      .select({
        source: usageLog.source,
        totalCost: sql<string>`SUM(${usageLog.cost})`,
      })
      .from(usageLog)
      .where(and(...summaryConditions))
      .groupBy(usageLog.source)

    const bySource: Record<string, number> = {}
    let totalCost = 0

    for (const row of summaryResult) {
      const sourceCost = Number.parseFloat(row.totalCost || '0')
      bySource[row.source] = sourceCost
      totalCost += sourceCost
    }

    return {
      logs: transformedLogs,
      summary: {
        totalCost,
        bySource,
      },
      pagination: {
        nextCursor:
          hasMore && resultLogs.length > 0 ? resultLogs[resultLogs.length - 1].id : undefined,
        hasMore,
      },
    }
  } catch (error) {
    logger.error('Failed to get usage logs', {
      error: toError(error).message,
      userId,
      options,
    })
    throw error
  }
}
