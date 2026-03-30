import { db } from '@sim/db'
import { jobExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq } from 'drizzle-orm'
import type { BaseServerTool, ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('GetJobLogsServerTool')

interface GetJobLogsArgs {
  jobId: string
  executionId?: string
  limit?: number
  includeDetails?: boolean
  workspaceId?: string
}

interface ToolCallDetail {
  name: string
  input: unknown
  output: unknown
  error?: string
  duration: number
}

interface JobLogEntry {
  executionId: string
  status: string
  trigger: string
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  error?: string
  toolCalls?: ToolCallDetail[]
  output?: unknown
  cost?: unknown
  tokens?: unknown
}

function extractToolCalls(traceSpan: any): ToolCallDetail[] {
  if (!traceSpan?.toolCalls || !Array.isArray(traceSpan.toolCalls)) return []

  return traceSpan.toolCalls.map((tc: any) => ({
    name: tc.name || 'unknown',
    input: tc.input || tc.arguments || {},
    output: tc.output || tc.result || undefined,
    error: tc.error || undefined,
    duration: tc.duration || 0,
  }))
}

function extractOutputAndError(executionData: any): {
  output: unknown
  error: string | undefined
  toolCalls: ToolCallDetail[]
  cost: unknown
  tokens: unknown
} {
  const traceSpans = executionData?.traceSpans || []
  const mainSpan = traceSpans[0]

  const toolCalls = mainSpan ? extractToolCalls(mainSpan) : []
  const output = mainSpan?.output || executionData?.finalOutput || undefined
  const cost = mainSpan?.cost || executionData?.cost || undefined
  const tokens = mainSpan?.tokens || undefined

  const errorMsg =
    mainSpan?.status === 'error'
      ? mainSpan?.output?.error || executionData?.error
      : executionData?.error || undefined

  return {
    output,
    error: errorMsg
      ? typeof errorMsg === 'string'
        ? errorMsg
        : JSON.stringify(errorMsg)
      : undefined,
    toolCalls,
    cost,
    tokens,
  }
}

export const getJobLogsServerTool: BaseServerTool<GetJobLogsArgs, JobLogEntry[]> = {
  name: 'get_job_logs',
  async execute(rawArgs: GetJobLogsArgs, context?: ServerToolContext): Promise<JobLogEntry[]> {
    const reqLogger = logger.withMetadata({ messageId: context?.messageId })

    const {
      jobId,
      executionId,
      limit = 3,
      includeDetails = false,
      workspaceId,
    } = rawArgs || ({} as GetJobLogsArgs)

    if (!jobId || typeof jobId !== 'string') {
      throw new Error('jobId is required')
    }
    if (!context?.userId) {
      throw new Error('Unauthorized access')
    }

    const wsId = workspaceId || context.workspaceId
    if (wsId) {
      const access = await checkWorkspaceAccess(wsId, context.userId)
      if (!access.hasAccess) {
        throw new Error('Unauthorized workspace access')
      }
    }

    const clampedLimit = Math.min(Math.max(1, limit), 5)

    reqLogger.info('Fetching job logs', {
      jobId,
      executionId,
      limit: clampedLimit,
      includeDetails,
    })

    const conditions = [eq(jobExecutionLogs.scheduleId, jobId)]
    if (executionId) {
      conditions.push(eq(jobExecutionLogs.executionId, executionId))
    }

    const rows = await db
      .select({
        id: jobExecutionLogs.id,
        executionId: jobExecutionLogs.executionId,
        status: jobExecutionLogs.status,
        level: jobExecutionLogs.level,
        trigger: jobExecutionLogs.trigger,
        startedAt: jobExecutionLogs.startedAt,
        endedAt: jobExecutionLogs.endedAt,
        totalDurationMs: jobExecutionLogs.totalDurationMs,
        executionData: jobExecutionLogs.executionData,
        cost: jobExecutionLogs.cost,
      })
      .from(jobExecutionLogs)
      .where(and(...conditions))
      .orderBy(desc(jobExecutionLogs.startedAt))
      .limit(executionId ? 1 : clampedLimit)

    const entries: JobLogEntry[] = rows.map((row) => {
      const executionData = row.executionData as any
      const details = includeDetails ? extractOutputAndError(executionData) : null

      const entry: JobLogEntry = {
        executionId: row.executionId,
        status: row.status,
        trigger: row.trigger,
        startedAt: row.startedAt.toISOString(),
        endedAt: row.endedAt ? row.endedAt.toISOString() : null,
        durationMs: row.totalDurationMs ?? null,
      }

      if (details) {
        if (details.error) entry.error = details.error
        if (details.toolCalls.length > 0) entry.toolCalls = details.toolCalls
        if (details.output) entry.output = details.output
        if (details.cost) entry.cost = details.cost
        if (details.tokens) entry.tokens = details.tokens
      } else {
        const errorMsg = executionData?.error || executionData?.traceSpans?.[0]?.output?.error
        if (row.status === 'error' && errorMsg) {
          entry.error = typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg)
        }
      }

      return entry
    })

    reqLogger.info('Job logs prepared', {
      jobId,
      count: entries.length,
      resultSizeKB: Math.round(JSON.stringify(entries).length / 1024),
    })

    return entries
  },
}
