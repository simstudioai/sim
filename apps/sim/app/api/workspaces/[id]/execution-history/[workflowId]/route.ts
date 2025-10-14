import { db } from '@sim/db'
import { permissions, workflowExecutionLogs } from '@sim/db/schema'
import { and, desc, eq, gte } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('WorkflowExecutionDetailsAPI')

const QueryParamsSchema = z.object({
  timeFilter: z.enum(['1h', '12h', '24h', '1w']).default('24h'),
})

function getTimeRangeMs(filter: string): number {
  switch (filter) {
    case '1h':
      return 60 * 60 * 1000
    case '12h':
      return 12 * 60 * 60 * 1000
    case '24h':
      return 24 * 60 * 60 * 1000
    case '1w':
      return 7 * 24 * 60 * 60 * 1000
    default:
      return 24 * 60 * 60 * 1000
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; workflowId: string }> }
) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized workflow details access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const { id: workspaceId, workflowId } = await params
    const { searchParams } = new URL(request.url)
    const queryParams = QueryParamsSchema.parse(Object.fromEntries(searchParams.entries()))

    // Calculate time range
    const endTime = new Date()
    const timeRangeMs = getTimeRangeMs(queryParams.timeFilter)
    const startTime = new Date(endTime.getTime() - timeRangeMs)

    // Number of data points for the line charts
    const dataPoints = 30
    const segmentDurationMs = timeRangeMs / dataPoints

    logger.debug(`[${requestId}] Fetching workflow details for ${workflowId}`)

    // Check permissions
    const [permission] = await db
      .select()
      .from(permissions)
      .where(
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workspaceId),
          eq(permissions.userId, userId)
        )
      )
      .limit(1)

    if (!permission) {
      logger.warn(`[${requestId}] User ${userId} has no permission for workspace ${workspaceId}`)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch all logs for this workflow in the time range
    const logs = await db
      .select({
        id: workflowExecutionLogs.id,
        executionId: workflowExecutionLogs.executionId,
        level: workflowExecutionLogs.level,
        trigger: workflowExecutionLogs.trigger,
        startedAt: workflowExecutionLogs.startedAt,
        totalDurationMs: workflowExecutionLogs.totalDurationMs,
        executionData: workflowExecutionLogs.executionData,
        cost: workflowExecutionLogs.cost,
      })
      .from(workflowExecutionLogs)
      .where(
        and(
          eq(workflowExecutionLogs.workflowId, workflowId),
          gte(workflowExecutionLogs.startedAt, startTime)
        )
      )
      .orderBy(desc(workflowExecutionLogs.startedAt))
      .limit(50)

    // Calculate metrics for each time segment
    const errorRates: { timestamp: string; value: number }[] = []
    const durations: { timestamp: string; value: number }[] = []
    const executionCounts: { timestamp: string; value: number }[] = []

    for (let i = 0; i < dataPoints; i++) {
      const segmentStart = new Date(startTime.getTime() + i * segmentDurationMs)
      const segmentEnd = new Date(startTime.getTime() + (i + 1) * segmentDurationMs)

      // Filter logs for this segment
      const segmentLogs = logs.filter((log) => {
        const logTime = log.startedAt.getTime()
        return logTime >= segmentStart.getTime() && logTime < segmentEnd.getTime()
      })

      const totalExecutions = segmentLogs.length
      const errorExecutions = segmentLogs.filter((log) => log.level === 'error').length
      const errorRate = totalExecutions > 0 ? (errorExecutions / totalExecutions) * 100 : 0

      // Calculate average duration for this segment
      const durationsInSegment = segmentLogs
        .filter((log) => log.totalDurationMs !== null)
        .map((log) => log.totalDurationMs!)
      const avgDuration =
        durationsInSegment.length > 0
          ? durationsInSegment.reduce((sum, d) => sum + d, 0) / durationsInSegment.length
          : 0

      errorRates.push({
        timestamp: segmentStart.toISOString(),
        value: errorRate,
      })

      durations.push({
        timestamp: segmentStart.toISOString(),
        value: avgDuration,
      })

      executionCounts.push({
        timestamp: segmentStart.toISOString(),
        value: totalExecutions,
      })
    }

    // Helper function to recursively search for error in trace spans
    const findErrorInSpans = (spans: any[]): string | null => {
      for (const span of spans) {
        if (span.status === 'error' && span.output?.error) {
          return span.output.error
        }
        if (span.children && Array.isArray(span.children)) {
          const childError = findErrorInSpans(span.children)
          if (childError) return childError
        }
      }
      return null
    }

    // Helper function to get all blocks from trace spans (flattened)
    const flattenTraceSpans = (spans: any[]): any[] => {
      const flattened: any[] = []
      for (const span of spans) {
        if (span.type !== 'workflow') {
          flattened.push(span)
        }
        if (span.children && Array.isArray(span.children)) {
          flattened.push(...flattenTraceSpans(span.children))
        }
      }
      return flattened
    }

    // Format logs for response
    const formattedLogs = logs.map((log) => {
      const executionData = log.executionData as any
      const triggerData = executionData?.trigger || {}
      const traceSpans = executionData?.traceSpans || []
      
      // Extract error message from trace spans
      let errorMessage = null
      if (log.level === 'error') {
        errorMessage = findErrorInSpans(traceSpans)
        // Fallback to executionData.errorDetails
        if (!errorMessage) {
          errorMessage = executionData?.errorDetails?.error || null
        }
      }
      
      // Extract outputs from the last block in trace spans
      let outputs = null
      let cost = null
      
      if (traceSpans.length > 0) {
        // Flatten all blocks from trace spans
        const allBlocks = flattenTraceSpans(traceSpans)
        
        // Find the last successful block execution
        const successBlocks = allBlocks.filter((span: any) => 
          span.status !== 'error' && 
          span.output &&
          Object.keys(span.output).length > 0
        )
        
        if (successBlocks.length > 0) {
          const lastBlock = successBlocks[successBlocks.length - 1]
          const blockOutput = lastBlock.output || {}
          
          // Clean up the output to show meaningful data
          // Priority: content > result > data > the whole output object
          if (blockOutput.content) {
            outputs = { content: blockOutput.content }
          } else if (blockOutput.result !== undefined) {
            outputs = { result: blockOutput.result }
          } else if (blockOutput.data !== undefined) {
            outputs = { data: blockOutput.data }
          } else {
            // Filter out internal/metadata fields for cleaner display
            const cleanOutput: any = {}
            for (const [key, value] of Object.entries(blockOutput)) {
              if (!['executionTime', 'tokens', 'model', 'cost', 'childTraceSpans', 'error', 'stackTrace'].includes(key)) {
                cleanOutput[key] = value
              }
            }
            if (Object.keys(cleanOutput).length > 0) {
              outputs = cleanOutput
            }
          }
          
          // Extract cost from the block output
          if (blockOutput.cost) {
            cost = blockOutput.cost
          }
        }
      }
      
      // Use the cost stored at the top-level in workflowExecutionLogs table
      // This is the same cost shown in the logs page
      const logCost = log.cost as any
      
      return {
        id: log.id,
        executionId: log.executionId,
        startedAt: log.startedAt.toISOString(),
        level: log.level,
        trigger: log.trigger,
        triggerUserId: triggerData.userId || null,
        triggerInputs: triggerData.inputs || triggerData.data || null,
        outputs,
        errorMessage,
        duration: log.totalDurationMs,
        cost: logCost ? {
          input: logCost.input || 0,
          output: logCost.output || 0,
          total: logCost.total || 0,
        } : null,
      }
    })

    logger.debug(`[${requestId}] Successfully calculated workflow details`)

    return NextResponse.json({
      errorRates,
      durations,
      executionCounts,
      logs: formattedLogs,
      timeFilter: queryParams.timeFilter,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching workflow details:`, error)
    return NextResponse.json({ error: 'Failed to fetch workflow details' }, { status: 500 })
  }
}

