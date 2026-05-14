import { createHash } from 'node:crypto'
import { db } from '@sim/db'
import { usageLog } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import {
  resolveUsageBillingContext,
  type UsageBillingAttribution,
  type UsageBillingContext,
} from '@/lib/billing/ledger/usage-ledger'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-types'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'

const logger = createLogger('UsageLog')

/**
 * Usage log category types
 */
export type UsageLogCategory = 'model' | 'fixed'

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

/**
 * A single usage entry to be recorded in the usage_log table.
 */
interface UsageEntry {
  category: UsageLogCategory
  source: UsageLogSource
  description: string
  cost: number
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
  /** Stable idempotency key for this source event. Replays with the same payload are ignored. */
  sourceEventKey?: string
  /** Billing owner captured when usage is recorded. Defaults to current subscription context. */
  billingAttribution?: UsageBillingAttribution
}

export interface RecordUsageResult {
  recorded: boolean
  userId: string
  billingAttribution: UsageBillingAttribution | null
  subscriptionId: string | null
  thresholdCheckEnqueued?: boolean
}

/**
 * Records usage by inserting immutable rows into usage_log.
 *
 * Usage_log is the source of truth for active billing, enforcement, and
 * display aggregates. Do not mirror cost counters into user_stats here; that
 * hot-row write was the source of connection-pool contention under load.
 */
export async function recordUsage(params: RecordUsageParams): Promise<RecordUsageResult> {
  if (!isBillingEnabled) {
    return {
      recorded: false,
      userId: params.userId,
      billingAttribution: null,
      subscriptionId: null,
      thresholdCheckEnqueued: false,
    }
  }

  const {
    userId,
    entries,
    workspaceId,
    workflowId,
    executionId,
    sourceEventKey,
    billingAttribution,
  } = params

  const validEntries = entries.filter((e) => e.cost >= 0)

  if (validEntries.length === 0) {
    return {
      recorded: false,
      userId,
      billingAttribution: null,
      subscriptionId: null,
      thresholdCheckEnqueued: false,
    }
  }

  const billingContext: UsageBillingContext = billingAttribution
    ? { attribution: billingAttribution, subscriptionId: null }
    : await resolveUsageBillingContext(userId)
  const attribution = billingContext.attribution

  return db.transaction(async (tx) => {
    const usageRows: (typeof usageLog.$inferInsert)[] = []
    let recordedUsageRows: (typeof usageLog.$inferInsert)[] = []

    for (const [index, entry] of validEntries.entries()) {
      const eventKey = sourceEventKey ? `${sourceEventKey}:${index}` : undefined
      const eventHash = eventKey
        ? hashUsageEvent({
            userId,
            entry,
            entryIndex: index,
            entryCount: validEntries.length,
            workspaceId,
            workflowId,
            executionId,
          })
        : null

      if (eventKey) {
        const existingRows = await tx
          .select({ sourceEventHash: usageLog.sourceEventHash })
          .from(usageLog)
          .where(eq(usageLog.sourceEventKey, eventKey))
          .limit(1)

        if (existingRows.length > 0) {
          if (existingRows[0].sourceEventHash !== eventHash) {
            throw new Error(`Usage event key ${eventKey} was replayed with a different payload`)
          }
          continue
        }
      }

      usageRows.push({
        id: generateId(),
        userId,
        category: entry.category,
        source: entry.source,
        description: entry.description,
        metadata: entry.metadata ?? null,
        cost: entry.cost.toString(),
        workspaceId: workspaceId ?? null,
        workflowId: workflowId ?? null,
        executionId: executionId ?? null,
        sourceEventKey: eventKey ?? null,
        sourceEventHash: eventHash,
        billingEntityType: attribution?.entityType ?? null,
        billingEntityId: attribution?.entityId ?? null,
      })
    }

    if (usageRows.length === 0) {
      logger.debug('Usage event replay ignored', {
        userId,
        sourceEventKey,
        entryCount: validEntries.length,
      })
      const thresholdCheckEnqueued = await enqueueThresholdCheckForUsage({
        executor: tx,
        userId,
        billingAttribution: attribution,
        subscriptionId: billingContext.subscriptionId,
      })
      return {
        recorded: false,
        userId,
        billingAttribution: attribution,
        subscriptionId: billingContext.subscriptionId,
        thresholdCheckEnqueued,
      }
    }

    const insertedRows = await tx
      .insert(usageLog)
      .values(usageRows)
      .onConflictDoNothing({
        target: usageLog.sourceEventKey,
        where: sql`${usageLog.sourceEventKey} IS NOT NULL`,
      })
      .returning({ id: usageLog.id, sourceEventKey: usageLog.sourceEventKey })

    const insertedIds = new Set(insertedRows.map((row) => row.id))
    const insertedKeys = new Set(insertedRows.map((row) => row.sourceEventKey).filter(Boolean))
    for (const row of usageRows) {
      if (!row.sourceEventKey || insertedKeys.has(row.sourceEventKey)) continue

      const existingRows = await tx
        .select({ sourceEventHash: usageLog.sourceEventHash })
        .from(usageLog)
        .where(eq(usageLog.sourceEventKey, row.sourceEventKey))
        .limit(1)

      if (existingRows[0]?.sourceEventHash !== row.sourceEventHash) {
        throw new Error(
          `Usage event key ${row.sourceEventKey} was replayed with a different payload`
        )
      }
    }

    recordedUsageRows = usageRows.filter((row) => insertedIds.has(row.id))
    if (recordedUsageRows.length === 0) {
      logger.debug('Usage event replay ignored', {
        userId,
        sourceEventKey,
        entryCount: validEntries.length,
      })
      const thresholdCheckEnqueued = await enqueueThresholdCheckForUsage({
        executor: tx,
        userId,
        billingAttribution: attribution,
        subscriptionId: billingContext.subscriptionId,
      })
      return {
        recorded: false,
        userId,
        billingAttribution: attribution,
        subscriptionId: billingContext.subscriptionId,
        thresholdCheckEnqueued,
      }
    }
    logger.debug('Recorded usage', {
      userId,
      totalCost: recordedUsageRows.reduce((sum, row) => sum + Number.parseFloat(row.cost), 0),
      entryCount: recordedUsageRows.length,
      sources: [...new Set(recordedUsageRows.map((e) => e.source))],
    })

    const thresholdCheckEnqueued = await enqueueThresholdCheckForUsage({
      executor: tx,
      userId,
      billingAttribution: attribution,
      subscriptionId: billingContext.subscriptionId,
    })

    return {
      recorded: true,
      userId,
      billingAttribution: attribution,
      subscriptionId: billingContext.subscriptionId,
      thresholdCheckEnqueued,
    }
  })
}

async function enqueueThresholdCheckForUsage(params: {
  executor: Pick<typeof db, 'insert'>
  userId: string
  billingAttribution: UsageBillingAttribution | null
  subscriptionId: string | null
}): Promise<boolean> {
  if (!params.subscriptionId || !params.billingAttribution) return false

  await enqueueOutboxEvent(
    params.executor,
    OUTBOX_EVENT_TYPES.BILLING_THRESHOLD_CHECK,
    {
      userId: params.userId,
      subscriptionId: params.subscriptionId,
      billingEntityType: params.billingAttribution.entityType,
      billingEntityId: params.billingAttribution.entityId,
    },
    { maxAttempts: 3 }
  )

  return true
}

function hashUsageEvent(params: {
  userId: string
  entry: UsageEntry
  entryIndex: number
  entryCount: number
  workspaceId?: string
  workflowId?: string
  executionId?: string
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        userId: params.userId,
        entry: params.entry,
        entryIndex: params.entryIndex,
        entryCount: params.entryCount,
        workspaceId: params.workspaceId ?? null,
        workflowId: params.workflowId ?? null,
        executionId: params.executionId ?? null,
      })
    )
    .digest('hex')
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
