import { db } from '@sim/db'
import { permissions, workflow, workflowExecutionLogs } from '@sim/db/schema'
import { and, eq, gte, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('ExecutionHistoryAPI')

const QueryParamsSchema = z.object({
  timeFilter: z.enum(['1h', '12h', '24h', '1w']).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  segments: z.coerce.number().min(1).max(200).default(120),
  workflowIds: z.string().optional(),
  folderIds: z.string().optional(),
  triggers: z.string().optional(),
})

interface TimeSegment {
  successRate: number
  timestamp: string
  hasExecutions: boolean
  totalExecutions: number
  successfulExecutions: number
}

interface WorkflowExecution {
  workflowId: string
  workflowName: string
  segments: TimeSegment[]
  overallSuccessRate: number
}

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

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized execution history access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const { id: workspaceId } = await params
    const { searchParams } = new URL(request.url)
    const queryParams = QueryParamsSchema.parse(Object.fromEntries(searchParams.entries()))

    // Calculate time range - use custom times if provided, otherwise use timeFilter
    let endTime: Date
    let startTime: Date

    if (queryParams.startTime && queryParams.endTime) {
      startTime = new Date(queryParams.startTime)
      endTime = new Date(queryParams.endTime)
    } else {
      endTime = new Date()
      const timeRangeMs = getTimeRangeMs(queryParams.timeFilter || '24h')
      startTime = new Date(endTime.getTime() - timeRangeMs)
    }

    const timeRangeMs = endTime.getTime() - startTime.getTime()
    const segmentDurationMs = timeRangeMs / queryParams.segments

    logger.debug(`[${requestId}] Fetching execution history for workspace ${workspaceId}`)
    logger.debug(
      `[${requestId}] Time range: ${startTime.toISOString()} to ${endTime.toISOString()}`
    )
    logger.debug(
      `[${requestId}] Segments: ${queryParams.segments}, duration: ${segmentDurationMs}ms`
    )

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

    // Build workflow query conditions
    const workflowConditions = [eq(workflow.workspaceId, workspaceId)]

    // Apply workflow ID filter
    if (queryParams.workflowIds) {
      const workflowIdList = queryParams.workflowIds.split(',')
      workflowConditions.push(inArray(workflow.id, workflowIdList))
    }

    // Apply folder ID filter
    if (queryParams.folderIds) {
      const folderIdList = queryParams.folderIds.split(',')
      workflowConditions.push(inArray(workflow.folderId, folderIdList))
    }

    // Get all workflows in the workspace with optional filters
    const workflows = await db
      .select({
        id: workflow.id,
        name: workflow.name,
      })
      .from(workflow)
      .where(and(...workflowConditions))

    logger.debug(`[${requestId}] Found ${workflows.length} workflows`)

    // For each workflow, get execution logs and calculate segments
    const workflowExecutions: WorkflowExecution[] = await Promise.all(
      workflows.map(async (wf) => {
        // Build conditions for log filtering
        const logConditions = [
          eq(workflowExecutionLogs.workflowId, wf.id),
          gte(workflowExecutionLogs.startedAt, startTime),
        ]

        // Add trigger filter if specified
        if (queryParams.triggers) {
          const triggerList = queryParams.triggers.split(',')
          logConditions.push(inArray(workflowExecutionLogs.trigger, triggerList))
        }

        // Fetch all logs for this workflow in the time range
        const logs = await db
          .select({
            id: workflowExecutionLogs.id,
            level: workflowExecutionLogs.level,
            startedAt: workflowExecutionLogs.startedAt,
          })
          .from(workflowExecutionLogs)
          .where(and(...logConditions))

        // Initialize segments with timestamps
        const segments: TimeSegment[] = []
        let totalSuccess = 0
        let totalExecutions = 0

        for (let i = 0; i < queryParams.segments; i++) {
          const segmentStart = new Date(startTime.getTime() + i * segmentDurationMs)
          const segmentEnd = new Date(startTime.getTime() + (i + 1) * segmentDurationMs)

          // Count executions in this segment
          const segmentLogs = logs.filter((log) => {
            const logTime = log.startedAt.getTime()
            return logTime >= segmentStart.getTime() && logTime < segmentEnd.getTime()
          })

          const segmentTotal = segmentLogs.length
          const segmentErrors = segmentLogs.filter((log) => log.level === 'error').length
          const segmentSuccess = segmentTotal - segmentErrors

          // Calculate success rate (default to 100% if no executions in this segment)
          const hasExecutions = segmentTotal > 0
          const successRate = hasExecutions ? (segmentSuccess / segmentTotal) * 100 : 100

          segments.push({
            successRate,
            timestamp: segmentStart.toISOString(),
            hasExecutions,
            totalExecutions: segmentTotal,
            successfulExecutions: segmentSuccess,
          })

          totalExecutions += segmentTotal
          totalSuccess += segmentSuccess
        }

        // Calculate overall success rate (percentage of non-errored executions)
        const overallSuccessRate =
          totalExecutions > 0 ? (totalSuccess / totalExecutions) * 100 : 100

        return {
          workflowId: wf.id,
          workflowName: wf.name,
          segments,
          overallSuccessRate,
        }
      })
    )

    logger.debug(
      `[${requestId}] Successfully calculated execution history for ${workflowExecutions.length} workflows`
    )

    return NextResponse.json({
      workflows: workflowExecutions,
      segments: queryParams.segments,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching execution history:`, error)
    return NextResponse.json({ error: 'Failed to fetch execution history' }, { status: 500 })
  }
}
