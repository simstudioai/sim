import { db } from '@sim/db'
import { usageLog, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'

const logger = createLogger('UsageLog')

/**
 * Usage log category types
 */
export type UsageLogCategory = 'model' | 'fixed'

/**
 * Usage log source types
 */
export type UsageLogSource = 'workflow' | 'wand' | 'copilot'

/**
 * Metadata for 'model' category charges
 */
export interface ModelUsageMetadata {
  inputTokens: number
  outputTokens: number
}

/**
 * Metadata for 'fixed' category charges (currently empty, extensible)
 */
export type FixedUsageMetadata = Record<string, never>

/**
 * Union type for all metadata types
 */
export type UsageLogMetadata = ModelUsageMetadata | FixedUsageMetadata | null

/**
 * Parameters for logging model usage (token-based charges)
 */
export interface LogModelUsageParams {
  userId: string
  source: UsageLogSource
  model: string
  inputTokens: number
  outputTokens: number
  cost: number
  workspaceId?: string
  workflowId?: string
  executionId?: string
}

/**
 * Parameters for logging fixed charges (flat fees)
 */
export interface LogFixedUsageParams {
  userId: string
  source: UsageLogSource
  description: string
  cost: number
  workspaceId?: string
  workflowId?: string
  executionId?: string
}

/**
 * Log a model usage charge (token-based)
 */
export async function logModelUsage(params: LogModelUsageParams): Promise<void> {
  if (!isBillingEnabled || params.cost <= 0) {
    return
  }

  try {
    const metadata: ModelUsageMetadata = {
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
    }

    await db.insert(usageLog).values({
      id: crypto.randomUUID(),
      userId: params.userId,
      category: 'model',
      source: params.source,
      description: params.model,
      metadata,
      cost: params.cost.toString(),
      workspaceId: params.workspaceId ?? null,
      workflowId: params.workflowId ?? null,
      executionId: params.executionId ?? null,
    })

    logger.debug('Logged model usage', {
      userId: params.userId,
      source: params.source,
      model: params.model,
      cost: params.cost,
    })
  } catch (error) {
    logger.error('Failed to log model usage', {
      error: error instanceof Error ? error.message : String(error),
      params,
    })
    // Don't throw - usage logging should not break the main flow
  }
}

/**
 * Log a fixed charge (flat fee like base execution charge or search)
 */
export async function logFixedUsage(params: LogFixedUsageParams): Promise<void> {
  if (!isBillingEnabled || params.cost <= 0) {
    return
  }

  try {
    await db.insert(usageLog).values({
      id: crypto.randomUUID(),
      userId: params.userId,
      category: 'fixed',
      source: params.source,
      description: params.description,
      metadata: null,
      cost: params.cost.toString(),
      workspaceId: params.workspaceId ?? null,
      workflowId: params.workflowId ?? null,
      executionId: params.executionId ?? null,
    })

    logger.debug('Logged fixed usage', {
      userId: params.userId,
      source: params.source,
      description: params.description,
      cost: params.cost,
    })
  } catch (error) {
    logger.error('Failed to log fixed usage', {
      error: error instanceof Error ? error.message : String(error),
      params,
    })
    // Don't throw - usage logging should not break the main flow
  }
}

/**
 * Parameters for batch logging workflow usage
 */
export interface LogWorkflowUsageBatchParams {
  userId: string
  workspaceId?: string
  workflowId: string
  executionId?: string
  baseExecutionCharge?: number
  models?: Record<
    string,
    {
      total: number
      tokens: { input: number; output: number }
    }
  >
}

/**
 * Log all workflow usage entries in a single batch insert (performance optimized)
 */
export async function logWorkflowUsageBatch(params: LogWorkflowUsageBatchParams): Promise<void> {
  if (!isBillingEnabled) {
    return
  }

  const entries: Array<{
    id: string
    userId: string
    category: 'model' | 'fixed'
    source: 'workflow'
    description: string
    metadata: ModelUsageMetadata | null
    cost: string
    workspaceId: string | null
    workflowId: string | null
    executionId: string | null
  }> = []

  if (params.baseExecutionCharge && params.baseExecutionCharge > 0) {
    entries.push({
      id: crypto.randomUUID(),
      userId: params.userId,
      category: 'fixed',
      source: 'workflow',
      description: 'execution_fee',
      metadata: null,
      cost: params.baseExecutionCharge.toString(),
      workspaceId: params.workspaceId ?? null,
      workflowId: params.workflowId,
      executionId: params.executionId ?? null,
    })
  }

  if (params.models) {
    for (const [modelName, modelData] of Object.entries(params.models)) {
      if (modelData.total > 0) {
        entries.push({
          id: crypto.randomUUID(),
          userId: params.userId,
          category: 'model',
          source: 'workflow',
          description: modelName,
          metadata: {
            inputTokens: modelData.tokens.input,
            outputTokens: modelData.tokens.output,
          },
          cost: modelData.total.toString(),
          workspaceId: params.workspaceId ?? null,
          workflowId: params.workflowId,
          executionId: params.executionId ?? null,
        })
      }
    }
  }

  if (entries.length === 0) {
    return
  }

  try {
    await db.insert(usageLog).values(entries)

    logger.debug('Logged workflow usage batch', {
      userId: params.userId,
      workflowId: params.workflowId,
      entryCount: entries.length,
    })
  } catch (error) {
    logger.error('Failed to log workflow usage batch', {
      error: error instanceof Error ? error.message : String(error),
      params,
    })
    // Don't throw - usage logging should not break the main flow
  }
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
      error: error instanceof Error ? error.message : String(error),
      userId,
      options,
    })
    throw error
  }
}

/**
 * Get the user ID associated with a workflow
 * Helper function for cases where we only have a workflow ID
 */
export async function getUserIdFromWorkflow(workflowId: string): Promise<string | null> {
  try {
    const [workflowRecord] = await db
      .select({ userId: workflow.userId })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    return workflowRecord?.userId ?? null
  } catch (error) {
    logger.error('Failed to get user ID from workflow', {
      error: error instanceof Error ? error.message : String(error),
      workflowId,
    })
    return null
  }
}
