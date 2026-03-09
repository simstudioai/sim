import { db } from '@sim/db'
import {
  pausedExecutions,
  permissions,
  workflow,
  workflowDeploymentVersion,
  workflowExecutionLogs,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { buildFilterConditions, LogFilterParamsSchema } from '@/lib/logs/filters'

const logger = createLogger('LogsAPI')

export const revalidate = 0

const QueryParamsSchema = LogFilterParamsSchema.extend({
  details: z.enum(['basic', 'full']).optional().default('basic'),
  limit: z.coerce.number().optional().default(100),
  offset: z.coerce.number().optional().default(0),
})

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized logs access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    try {
      const { searchParams } = new URL(request.url)
      const params = QueryParamsSchema.parse(Object.fromEntries(searchParams.entries()))

      const selectColumns =
        params.details === 'full'
          ? {
              id: workflowExecutionLogs.id,
              workflowId: workflowExecutionLogs.workflowId,
              executionId: workflowExecutionLogs.executionId,
              stateSnapshotId: workflowExecutionLogs.stateSnapshotId,
              deploymentVersionId: workflowExecutionLogs.deploymentVersionId,
              level: workflowExecutionLogs.level,
              status: workflowExecutionLogs.status,
              trigger: workflowExecutionLogs.trigger,
              startedAt: workflowExecutionLogs.startedAt,
              endedAt: workflowExecutionLogs.endedAt,
              totalDurationMs: workflowExecutionLogs.totalDurationMs,
              executionData: workflowExecutionLogs.executionData,
              cost: workflowExecutionLogs.cost,
              files: workflowExecutionLogs.files,
              createdAt: workflowExecutionLogs.createdAt,
              workflowName: workflow.name,
              workflowDescription: workflow.description,
              workflowColor: workflow.color,
              workflowFolderId: workflow.folderId,
              workflowUserId: workflow.userId,
              workflowWorkspaceId: workflow.workspaceId,
              workflowCreatedAt: workflow.createdAt,
              workflowUpdatedAt: workflow.updatedAt,
              pausedStatus: pausedExecutions.status,
              pausedTotalPauseCount: pausedExecutions.totalPauseCount,
              pausedResumedCount: pausedExecutions.resumedCount,
              deploymentVersion: workflowDeploymentVersion.version,
              deploymentVersionName: workflowDeploymentVersion.name,
            }
          : {
              id: workflowExecutionLogs.id,
              workflowId: workflowExecutionLogs.workflowId,
              executionId: workflowExecutionLogs.executionId,
              stateSnapshotId: workflowExecutionLogs.stateSnapshotId,
              deploymentVersionId: workflowExecutionLogs.deploymentVersionId,
              level: workflowExecutionLogs.level,
              status: workflowExecutionLogs.status,
              trigger: workflowExecutionLogs.trigger,
              startedAt: workflowExecutionLogs.startedAt,
              endedAt: workflowExecutionLogs.endedAt,
              totalDurationMs: workflowExecutionLogs.totalDurationMs,
              executionData: sql<null>`NULL`,
              cost: workflowExecutionLogs.cost,
              files: sql<null>`NULL`,
              createdAt: workflowExecutionLogs.createdAt,
              workflowName: workflow.name,
              workflowDescription: workflow.description,
              workflowColor: workflow.color,
              workflowFolderId: workflow.folderId,
              workflowUserId: workflow.userId,
              workflowWorkspaceId: workflow.workspaceId,
              workflowCreatedAt: workflow.createdAt,
              workflowUpdatedAt: workflow.updatedAt,
              pausedStatus: pausedExecutions.status,
              pausedTotalPauseCount: pausedExecutions.totalPauseCount,
              pausedResumedCount: pausedExecutions.resumedCount,
              deploymentVersion: workflowDeploymentVersion.version,
              deploymentVersionName: sql<null>`NULL`,
            }

      const workspaceFilter = eq(workflowExecutionLogs.workspaceId, params.workspaceId)

      const baseQuery = db
        .select(selectColumns)
        .from(workflowExecutionLogs)
        .leftJoin(
          pausedExecutions,
          eq(pausedExecutions.executionId, workflowExecutionLogs.executionId)
        )
        .leftJoin(
          workflowDeploymentVersion,
          eq(workflowDeploymentVersion.id, workflowExecutionLogs.deploymentVersionId)
        )
        .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
        .innerJoin(
          permissions,
          and(
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workflowExecutionLogs.workspaceId),
            eq(permissions.userId, userId)
          )
        )

      let conditions: SQL | undefined

      if (params.level && params.level !== 'all') {
        const levels = params.level.split(',').filter(Boolean)
        const levelConditions: SQL[] = []

        for (const level of levels) {
          if (level === 'error') {
            levelConditions.push(eq(workflowExecutionLogs.level, 'error'))
          } else if (level === 'info') {
            const condition = and(
              eq(workflowExecutionLogs.level, 'info'),
              isNotNull(workflowExecutionLogs.endedAt)
            )
            if (condition) levelConditions.push(condition)
          } else if (level === 'running') {
            const condition = and(
              eq(workflowExecutionLogs.level, 'info'),
              isNull(workflowExecutionLogs.endedAt)
            )
            if (condition) levelConditions.push(condition)
          } else if (level === 'pending') {
            const condition = and(
              eq(workflowExecutionLogs.level, 'info'),
              or(
                sql`(${pausedExecutions.totalPauseCount} > 0 AND ${pausedExecutions.resumedCount} < ${pausedExecutions.totalPauseCount})`,
                and(
                  isNotNull(pausedExecutions.status),
                  sql`${pausedExecutions.status} != 'fully_resumed'`
                )
              )
            )
            if (condition) levelConditions.push(condition)
          }
        }

        if (levelConditions.length > 0) {
          conditions = and(
            conditions,
            levelConditions.length === 1 ? levelConditions[0] : or(...levelConditions)
          )
        }
      }

      // Apply common filters (workflowIds, folderIds, triggers, dates, search, cost, duration)
      // Level filtering is handled above with advanced running/pending state logic
      const commonFilters = buildFilterConditions(params, { useSimpleLevelFilter: false })
      if (commonFilters) {
        conditions = and(conditions, commonFilters)
      }

      const logs = await baseQuery
        .where(and(workspaceFilter, conditions))
        .orderBy(desc(workflowExecutionLogs.startedAt))
        .limit(params.limit)
        .offset(params.offset)

      const countQuery = db
        .select({ count: sql<number>`count(*)` })
        .from(workflowExecutionLogs)
        .leftJoin(
          pausedExecutions,
          eq(pausedExecutions.executionId, workflowExecutionLogs.executionId)
        )
        .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
        .innerJoin(
          permissions,
          and(
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workflowExecutionLogs.workspaceId),
            eq(permissions.userId, userId)
          )
        )
        .where(and(eq(workflowExecutionLogs.workspaceId, params.workspaceId), conditions))

      const countResult = await countQuery

      const count = countResult[0]?.count || 0

      const blockExecutionsByExecution: Record<string, any[]> = {}

      const createTraceSpans = (blockExecutions: any[]) => {
        return blockExecutions.map((block, index) => {
          let output = block.outputData
          if (block.status === 'error' && block.errorMessage) {
            output = {
              ...output,
              error: block.errorMessage,
              stackTrace: block.errorStackTrace,
            }
          }

          return {
            id: block.id,
            name: `Block ${block.blockName || block.blockType} (${block.blockType})`,
            type: block.blockType,
            duration: block.durationMs,
            startTime: block.startedAt,
            endTime: block.endedAt,
            status: block.status === 'success' ? 'success' : 'error',
            blockId: block.blockId,
            input: block.inputData,
            output,
            tokens: block.cost?.tokens?.total || 0,
            relativeStartMs: index * 100,
            children: [],
            toolCalls: [],
          }
        })
      }

      const extractCostSummary = (blockExecutions: any[]) => {
        let totalCost = 0
        let totalInputCost = 0
        let totalOutputCost = 0
        let totalTokens = 0
        let totalPromptTokens = 0
        let totalCompletionTokens = 0
        const models = new Map()

        blockExecutions.forEach((block) => {
          if (block.cost) {
            totalCost += Number(block.cost.total) || 0
            totalInputCost += Number(block.cost.input) || 0
            totalOutputCost += Number(block.cost.output) || 0
            totalTokens += block.cost.tokens?.total || 0
            totalPromptTokens += block.cost.tokens?.prompt || 0
            totalCompletionTokens += block.cost.tokens?.completion || 0

            if (block.cost.model) {
              if (!models.has(block.cost.model)) {
                models.set(block.cost.model, {
                  input: 0,
                  output: 0,
                  total: 0,
                  tokens: { input: 0, output: 0, total: 0 },
                })
              }
              const modelCost = models.get(block.cost.model)
              modelCost.input += Number(block.cost.input) || 0
              modelCost.output += Number(block.cost.output) || 0
              modelCost.total += Number(block.cost.total) || 0
              modelCost.tokens.input += block.cost.tokens?.input || block.cost.tokens?.prompt || 0
              modelCost.tokens.output +=
                block.cost.tokens?.output || block.cost.tokens?.completion || 0
              modelCost.tokens.total += block.cost.tokens?.total || 0
            }
          }
        })

        return {
          total: totalCost,
          input: totalInputCost,
          output: totalOutputCost,
          tokens: {
            total: totalTokens,
            input: totalPromptTokens,
            output: totalCompletionTokens,
          },
          models: Object.fromEntries(models),
        }
      }

      const enhancedLogs = logs.map((log) => {
        const blockExecutions = blockExecutionsByExecution[log.executionId] || []

        let traceSpans = []
        let finalOutput: any
        let costSummary = (log.cost as any) || { total: 0 }

        if (params.details === 'full' && log.executionData) {
          const storedTraceSpans = (log.executionData as any)?.traceSpans
          traceSpans =
            storedTraceSpans && Array.isArray(storedTraceSpans) && storedTraceSpans.length > 0
              ? storedTraceSpans
              : createTraceSpans(blockExecutions)

          costSummary =
            log.cost && Object.keys(log.cost as any).length > 0
              ? (log.cost as any)
              : extractCostSummary(blockExecutions)

          try {
            const fo = (log.executionData as any)?.finalOutput
            if (fo !== undefined) finalOutput = fo
          } catch {}
        }

        const workflowSummary = log.workflowId
          ? {
              id: log.workflowId,
              name: log.workflowName,
              description: log.workflowDescription,
              color: log.workflowColor,
              folderId: log.workflowFolderId,
              userId: log.workflowUserId,
              workspaceId: log.workflowWorkspaceId,
              createdAt: log.workflowCreatedAt,
              updatedAt: log.workflowUpdatedAt,
            }
          : null

        return {
          id: log.id,
          workflowId: log.workflowId,
          executionId: log.executionId,
          deploymentVersionId: log.deploymentVersionId,
          deploymentVersion: log.deploymentVersion ?? null,
          deploymentVersionName: log.deploymentVersionName ?? null,
          level: log.level,
          status: log.status,
          duration: log.totalDurationMs ? `${log.totalDurationMs}ms` : null,
          trigger: log.trigger,
          createdAt: log.startedAt.toISOString(),
          files: params.details === 'full' ? log.files || undefined : undefined,
          workflow: workflowSummary,
          pauseSummary: {
            status: log.pausedStatus ?? null,
            total: log.pausedTotalPauseCount ?? 0,
            resumed: log.pausedResumedCount ?? 0,
          },
          executionData:
            params.details === 'full'
              ? {
                  totalDuration: log.totalDurationMs,
                  traceSpans,
                  blockExecutions,
                  finalOutput,
                  enhanced: true,
                }
              : undefined,
          cost:
            params.details === 'full'
              ? (costSummary as any)
              : { total: (costSummary as any)?.total || 0 },
          hasPendingPause:
            (Number(log.pausedTotalPauseCount ?? 0) > 0 &&
              Number(log.pausedResumedCount ?? 0) < Number(log.pausedTotalPauseCount ?? 0)) ||
            (log.pausedStatus && log.pausedStatus !== 'fully_resumed'),
        }
      })
      return NextResponse.json(
        {
          data: enhancedLogs,
          total: Number(count),
          page: Math.floor(params.offset / params.limit) + 1,
          pageSize: params.limit,
          totalPages: Math.ceil(Number(count) / params.limit),
        },
        { status: 200 }
      )
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid logs request parameters`, {
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
    logger.error(`[${requestId}] logs fetch error`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
