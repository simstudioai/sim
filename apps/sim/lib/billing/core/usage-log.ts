import { db } from '@sim/db'
import { usageLog, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, desc, eq, gte, lte, type SQL, sql } from 'drizzle-orm'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'

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
export interface UsageEntry {
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
  /** Source-specific counter increments (e.g. totalCopilotCalls, totalManualExecutions) */
  additionalStats?: Record<string, SQL>
}

/**
 * Records usage in a single atomic transaction.
 *
 * Inserts all entries into usage_log and updates userStats counters
 * (totalCost, currentPeriodCost, lastActive) within one Postgres transaction.
 * The total cost added to userStats is derived from summing entry costs,
 * ensuring usage_log and currentPeriodCost can never drift apart.
 *
 * If billing is disabled, total cost is zero, or no entries have positive cost,
 * this function returns early without writing anything.
 */
export async function recordUsage(params: RecordUsageParams): Promise<void> {
  if (!isBillingEnabled) {
    return
  }

  const { userId, entries, workspaceId, workflowId, executionId, additionalStats } = params

  const validEntries = entries.filter((e) => e.cost > 0)
  const totalCost = validEntries.reduce((sum, e) => sum + e.cost, 0)

  if (
    validEntries.length === 0 &&
    (!additionalStats || Object.keys(additionalStats).length === 0)
  ) {
    return
  }

  const RESERVED_KEYS = new Set(['totalCost', 'currentPeriodCost', 'lastActive'])
  const safeStats = additionalStats
    ? Object.fromEntries(Object.entries(additionalStats).filter(([k]) => !RESERVED_KEYS.has(k)))
    : undefined

  await db.transaction(async (tx) => {
    if (validEntries.length > 0) {
      await tx.insert(usageLog).values(
        validEntries.map((entry) => ({
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
        }))
      )
    }

    const updateFields: Record<string, SQL | Date> = {
      lastActive: new Date(),
      ...(totalCost > 0 && {
        totalCost: sql`total_cost + ${totalCost}`,
        currentPeriodCost: sql`current_period_cost + ${totalCost}`,
      }),
      ...safeStats,
    }

    const result = await tx
      .update(userStats)
      .set(updateFields)
      .where(eq(userStats.userId, userId))
      .returning({ userId: userStats.userId })

    if (result.length === 0) {
      logger.warn('recordUsage: userStats row not found, transaction will roll back', {
        userId,
        totalCost,
      })
      throw new Error(`userStats row not found for userId: ${userId}`)
    }
  })

  logger.debug('Recorded usage', {
    userId,
    totalCost,
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
export interface UsageLogEntry {
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
