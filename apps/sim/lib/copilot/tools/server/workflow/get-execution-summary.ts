import { db } from '@sim/db'
import { workflow, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, type SQL } from 'drizzle-orm'
import { GetExecutionSummary } from '@/lib/copilot/generated/tool-catalog-v1'
import type { BaseServerTool, ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import { materializeExecutionData } from '@/lib/logs/execution/trace-store'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('GetExecutionSummaryServerTool')

interface GetExecutionSummaryArgs {
  workspaceId: string
  workflowId?: string
  limit?: number
  status?: 'success' | 'error' | 'all'
}

interface ExecutionSummary {
  executionId: string
  workflowId: string | null
  workflowName: string | null
  status: string
  trigger: string
  startedAt: string
  durationMs: number | null
  cost: number | null
  error: string | null
}

function extractErrorMessage(executionData: any): string | null {
  if (!executionData) return null
  return (
    executionData?.errorDetails?.error ||
    executionData?.errorDetails?.message ||
    executionData?.finalOutput?.error ||
    executionData?.error ||
    null
  )
}

export const getExecutionSummaryServerTool: BaseServerTool<
  GetExecutionSummaryArgs,
  ExecutionSummary[]
> = {
  name: GetExecutionSummary.id,
  async execute(
    rawArgs: GetExecutionSummaryArgs,
    context?: ServerToolContext
  ): Promise<ExecutionSummary[]> {
    const { workspaceId, workflowId, limit = 10, status = 'all' } = rawArgs || {}

    if (!workspaceId || typeof workspaceId !== 'string') {
      throw new Error('workspaceId is required')
    }
    if (!context?.userId) {
      throw new Error('Unauthorized access')
    }

    const access = await checkWorkspaceAccess(workspaceId, context.userId)
    if (!access.hasAccess) {
      throw new Error('Unauthorized workspace access')
    }

    const clampedLimit = Math.min(Math.max(1, limit), 20)

    logger.info('Fetching execution summary', {
      workspaceId,
      workflowId,
      limit: clampedLimit,
      status,
    })

    const conditions: SQL[] = [eq(workflowExecutionLogs.workspaceId, workspaceId)]

    if (workflowId) {
      conditions.push(eq(workflowExecutionLogs.workflowId, workflowId))
    }

    if (status === 'error') {
      conditions.push(eq(workflowExecutionLogs.level, 'error'))
    } else if (status === 'success') {
      conditions.push(eq(workflowExecutionLogs.level, 'info'))
    }

    const rows = await db
      .select({
        executionId: workflowExecutionLogs.executionId,
        workflowId: workflowExecutionLogs.workflowId,
        workspaceId: workflowExecutionLogs.workspaceId,
        workflowName: workflow.name,
        status: workflowExecutionLogs.status,
        level: workflowExecutionLogs.level,
        trigger: workflowExecutionLogs.trigger,
        startedAt: workflowExecutionLogs.startedAt,
        totalDurationMs: workflowExecutionLogs.totalDurationMs,
        costTotal: workflowExecutionLogs.costTotal,
        executionData: workflowExecutionLogs.executionData,
      })
      .from(workflowExecutionLogs)
      .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
      .where(and(...conditions))
      .orderBy(desc(workflowExecutionLogs.startedAt))
      .limit(clampedLimit)

    const summaries: ExecutionSummary[] = await Promise.all(
      rows.map(async (row) => {
        // Only externalized rows need a fetch; error fields live in the heavy data.
        const executionData =
          row.level === 'error'
            ? await materializeExecutionData(row.executionData as Record<string, unknown> | null, {
                workspaceId: row.workspaceId,
                workflowId: row.workflowId,
                executionId: row.executionId,
              })
            : row.executionData
        const errorMsg = row.level === 'error' ? extractErrorMessage(executionData) : null

        return {
          executionId: row.executionId,
          workflowId: row.workflowId,
          workflowName: row.workflowName,
          status: row.status,
          trigger: row.trigger,
          startedAt: row.startedAt.toISOString(),
          durationMs: row.totalDurationMs ?? null,
          cost: row.costTotal != null ? Number(row.costTotal) : null,
          error: errorMsg
            ? typeof errorMsg === 'string'
              ? errorMsg
              : JSON.stringify(errorMsg)
            : null,
        }
      })
    )

    logger.info('Execution summary prepared', {
      count: summaries.length,
      workspaceId,
    })

    return summaries
  },
}
