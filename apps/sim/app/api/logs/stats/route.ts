import { db } from '@sim/db'
import { permissions, workflow, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { buildFilterConditions, LogFilterParamsSchema } from '@/lib/logs/filters'

const logger = createLogger('LogsStatsAPI')

export const revalidate = 0

const StatsQueryParamsSchema = LogFilterParamsSchema.extend({
  segmentCount: z.coerce.number().optional().default(72),
})

export interface SegmentStats {
  timestamp: string
  totalExecutions: number
  successfulExecutions: number
  avgDurationMs: number
}

export interface WorkflowStats {
  workflowId: string
  workflowName: string
  segments: SegmentStats[]
  overallSuccessRate: number
  totalExecutions: number
  totalSuccessful: number
}

export interface DashboardStatsResponse {
  workflows: WorkflowStats[]
  aggregateSegments: SegmentStats[]
  totalRuns: number
  totalErrors: number
  avgLatency: number
  timeBounds: {
    start: string
    end: string
  }
  segmentMs: number
}

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized logs stats access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    try {
      const { searchParams } = new URL(request.url)
      const params = StatsQueryParamsSchema.parse(Object.fromEntries(searchParams.entries()))

      const workspaceFilter = eq(workflowExecutionLogs.workspaceId, params.workspaceId)

      const commonFilters = buildFilterConditions(params, { useSimpleLevelFilter: true })
      const whereCondition = commonFilters ? and(workspaceFilter, commonFilters) : workspaceFilter

      const boundsQuery = await db
        .select({
          minTime: sql<string>`MIN(${workflowExecutionLogs.startedAt})`,
          maxTime: sql<string>`MAX(${workflowExecutionLogs.startedAt})`,
        })
        .from(workflowExecutionLogs)
        .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
        .innerJoin(
          permissions,
          and(
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workflowExecutionLogs.workspaceId),
            eq(permissions.userId, userId)
          )
        )
        .where(whereCondition)

      const bounds = boundsQuery[0]
      const now = new Date()

      let startTime: Date
      let endTime: Date

      if (!bounds?.minTime || !bounds?.maxTime) {
        endTime = now
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      } else {
        startTime = new Date(bounds.minTime)
        endTime = new Date(Math.max(new Date(bounds.maxTime).getTime(), now.getTime()))
      }

      const totalMs = Math.max(1, endTime.getTime() - startTime.getTime())
      const segmentMs = Math.max(60000, Math.floor(totalMs / params.segmentCount))
      const startTimeIso = startTime.toISOString()

      const statsQuery = await db
        .select({
          workflowId: sql<string>`COALESCE(${workflowExecutionLogs.workflowId}, 'deleted')`,
          workflowName: sql<string>`COALESCE(${workflow.name}, 'Deleted Workflow')`,
          segmentIndex:
            sql<number>`FLOOR(EXTRACT(EPOCH FROM (${workflowExecutionLogs.startedAt} - ${startTimeIso}::timestamp)) * 1000 / ${segmentMs})`.as(
              'segment_index'
            ),
          totalExecutions: sql<number>`COUNT(*)`.as('total_executions'),
          successfulExecutions:
            sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionLogs.level} != 'error')`.as(
              'successful_executions'
            ),
          avgDurationMs:
            sql<number>`COALESCE(AVG(${workflowExecutionLogs.totalDurationMs}) FILTER (WHERE ${workflowExecutionLogs.totalDurationMs} > 0), 0)`.as(
              'avg_duration_ms'
            ),
        })
        .from(workflowExecutionLogs)
        .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
        .innerJoin(
          permissions,
          and(
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workflowExecutionLogs.workspaceId),
            eq(permissions.userId, userId)
          )
        )
        .where(whereCondition)
        .groupBy(
          sql`COALESCE(${workflowExecutionLogs.workflowId}, 'deleted')`,
          sql`COALESCE(${workflow.name}, 'Deleted Workflow')`,
          sql`segment_index`
        )

      const workflowMap = new Map<
        string,
        {
          workflowId: string
          workflowName: string
          segments: Map<number, SegmentStats>
          totalExecutions: number
          totalSuccessful: number
        }
      >()

      for (const row of statsQuery) {
        const segmentIndex = Math.min(
          params.segmentCount - 1,
          Math.max(0, Math.floor(Number(row.segmentIndex)))
        )

        if (!workflowMap.has(row.workflowId)) {
          workflowMap.set(row.workflowId, {
            workflowId: row.workflowId,
            workflowName: row.workflowName,
            segments: new Map(),
            totalExecutions: 0,
            totalSuccessful: 0,
          })
        }

        const wf = workflowMap.get(row.workflowId)!
        wf.totalExecutions += Number(row.totalExecutions)
        wf.totalSuccessful += Number(row.successfulExecutions)

        const existing = wf.segments.get(segmentIndex)
        if (existing) {
          const oldTotal = existing.totalExecutions
          const newTotal = oldTotal + Number(row.totalExecutions)
          existing.totalExecutions = newTotal
          existing.successfulExecutions += Number(row.successfulExecutions)
          existing.avgDurationMs =
            newTotal > 0
              ? (existing.avgDurationMs * oldTotal +
                  Number(row.avgDurationMs || 0) * Number(row.totalExecutions)) /
                newTotal
              : 0
        } else {
          wf.segments.set(segmentIndex, {
            timestamp: new Date(startTime.getTime() + segmentIndex * segmentMs).toISOString(),
            totalExecutions: Number(row.totalExecutions),
            successfulExecutions: Number(row.successfulExecutions),
            avgDurationMs: Number(row.avgDurationMs || 0),
          })
        }
      }

      const workflows: WorkflowStats[] = []
      for (const wf of workflowMap.values()) {
        const segments: SegmentStats[] = []
        for (let i = 0; i < params.segmentCount; i++) {
          const existing = wf.segments.get(i)
          if (existing) {
            segments.push(existing)
          } else {
            segments.push({
              timestamp: new Date(startTime.getTime() + i * segmentMs).toISOString(),
              totalExecutions: 0,
              successfulExecutions: 0,
              avgDurationMs: 0,
            })
          }
        }

        workflows.push({
          workflowId: wf.workflowId,
          workflowName: wf.workflowName,
          segments,
          totalExecutions: wf.totalExecutions,
          totalSuccessful: wf.totalSuccessful,
          overallSuccessRate:
            wf.totalExecutions > 0 ? (wf.totalSuccessful / wf.totalExecutions) * 100 : 100,
        })
      }

      workflows.sort((a, b) => {
        const errA = a.overallSuccessRate < 100 ? 1 - a.overallSuccessRate / 100 : 0
        const errB = b.overallSuccessRate < 100 ? 1 - b.overallSuccessRate / 100 : 0
        if (errA !== errB) return errB - errA
        return a.workflowName.localeCompare(b.workflowName)
      })

      const aggregateSegments: SegmentStats[] = []
      let totalRuns = 0
      let totalErrors = 0
      let weightedLatencySum = 0
      let latencyCount = 0

      for (let i = 0; i < params.segmentCount; i++) {
        let segTotal = 0
        let segSuccess = 0
        let segWeightedLatency = 0
        let segLatencyCount = 0

        for (const wf of workflows) {
          const seg = wf.segments[i]
          segTotal += seg.totalExecutions
          segSuccess += seg.successfulExecutions
          if (seg.avgDurationMs > 0 && seg.totalExecutions > 0) {
            segWeightedLatency += seg.avgDurationMs * seg.totalExecutions
            segLatencyCount += seg.totalExecutions
          }
        }

        totalRuns += segTotal
        totalErrors += segTotal - segSuccess
        weightedLatencySum += segWeightedLatency
        latencyCount += segLatencyCount

        aggregateSegments.push({
          timestamp: new Date(startTime.getTime() + i * segmentMs).toISOString(),
          totalExecutions: segTotal,
          successfulExecutions: segSuccess,
          avgDurationMs: segLatencyCount > 0 ? segWeightedLatency / segLatencyCount : 0,
        })
      }

      const avgLatency = latencyCount > 0 ? weightedLatencySum / latencyCount : 0

      const response: DashboardStatsResponse = {
        workflows,
        aggregateSegments,
        totalRuns,
        totalErrors,
        avgLatency,
        timeBounds: {
          start: startTime.toISOString(),
          end: endTime.toISOString(),
        },
        segmentMs,
      }

      return NextResponse.json(response, { status: 200 })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid logs stats request parameters`, {
          errors: validationError.errors,
        })
        return NextResponse.json(
          {
            error: 'Invalid request parameters',
            details: validationError.errors,
          },
          { status: 400 }
        )
      }
      throw validationError
    }
  } catch (error: any) {
    logger.error(`[${requestId}] logs stats fetch error`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
