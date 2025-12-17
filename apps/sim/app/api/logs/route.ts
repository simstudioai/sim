import { db } from '@sim/db'
import {
  pausedExecutions,
  permissions,
  workflow,
  workflowDeploymentVersion,
  workflowExecutionLogs,
} from '@sim/db/schema'
import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('LogsAPI')

export const revalidate = 0

const QueryParamsSchema = z.object({
  details: z.enum(['basic', 'full']).optional().default('basic'),
  limit: z.coerce.number().optional().default(100),
  offset: z.coerce.number().optional().default(0),
  level: z.string().optional(),
  workflowIds: z.string().optional(),
  folderIds: z.string().optional(),
  triggers: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional(),
  workflowName: z.string().optional(),
  folderName: z.string().optional(),
  executionId: z.string().optional(),
  costOperator: z.enum(['=', '>', '<', '>=', '<=', '!=']).optional(),
  costValue: z.coerce.number().optional(),
  durationOperator: z.enum(['=', '>', '<', '>=', '<=', '!=']).optional(),
  durationValue: z.coerce.number().optional(),
  workspaceId: z.string(),
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
        .innerJoin(
          workflow,
          and(
            eq(workflowExecutionLogs.workflowId, workflow.id),
            eq(workflow.workspaceId, params.workspaceId)
          )
        )
        .innerJoin(
          permissions,
          and(
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workflow.workspaceId),
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

      if (params.workflowIds) {
        const workflowIds = params.workflowIds.split(',').filter(Boolean)
        if (workflowIds.length > 0) {
          conditions = and(conditions, inArray(workflow.id, workflowIds))
        }
      }

      if (params.folderIds) {
        const folderIds = params.folderIds.split(',').filter(Boolean)
        if (folderIds.length > 0) {
          conditions = and(conditions, inArray(workflow.folderId, folderIds))
        }
      }

      if (params.triggers) {
        const triggers = params.triggers.split(',').filter(Boolean)
        if (triggers.length > 0 && !triggers.includes('all')) {
          conditions = and(conditions, inArray(workflowExecutionLogs.trigger, triggers))
        }
      }

      if (params.startDate) {
        conditions = and(
          conditions,
          gte(workflowExecutionLogs.startedAt, new Date(params.startDate))
        )
      }
      if (params.endDate) {
        conditions = and(conditions, lte(workflowExecutionLogs.startedAt, new Date(params.endDate)))
      }

      if (params.search) {
        const searchTerm = `%${params.search}%`
        conditions = and(conditions, sql`${workflowExecutionLogs.executionId} ILIKE ${searchTerm}`)
      }

      if (params.workflowName) {
        const nameTerm = `%${params.workflowName}%`
        conditions = and(conditions, sql`${workflow.name} ILIKE ${nameTerm}`)
      }

      if (params.folderName) {
        const folderTerm = `%${params.folderName}%`
        conditions = and(conditions, sql`${workflow.name} ILIKE ${folderTerm}`)
      }

      if (params.executionId) {
        conditions = and(conditions, eq(workflowExecutionLogs.executionId, params.executionId))
      }

      if (params.costOperator && params.costValue !== undefined) {
        const costField = sql`(${workflowExecutionLogs.cost}->>'total')::numeric`
        switch (params.costOperator) {
          case '=':
            conditions = and(conditions, sql`${costField} = ${params.costValue}`)
            break
          case '>':
            conditions = and(conditions, sql`${costField} > ${params.costValue}`)
            break
          case '<':
            conditions = and(conditions, sql`${costField} < ${params.costValue}`)
            break
          case '>=':
            conditions = and(conditions, sql`${costField} >= ${params.costValue}`)
            break
          case '<=':
            conditions = and(conditions, sql`${costField} <= ${params.costValue}`)
            break
          case '!=':
            conditions = and(conditions, sql`${costField} != ${params.costValue}`)
            break
        }
      }

      if (params.durationOperator && params.durationValue !== undefined) {
        const durationField = workflowExecutionLogs.totalDurationMs
        switch (params.durationOperator) {
          case '=':
            conditions = and(conditions, eq(durationField, params.durationValue))
            break
          case '>':
            conditions = and(conditions, gt(durationField, params.durationValue))
            break
          case '<':
            conditions = and(conditions, lt(durationField, params.durationValue))
            break
          case '>=':
            conditions = and(conditions, gte(durationField, params.durationValue))
            break
          case '<=':
            conditions = and(conditions, lte(durationField, params.durationValue))
            break
          case '!=':
            conditions = and(conditions, ne(durationField, params.durationValue))
            break
        }
      }

      const logs = await baseQuery
        .where(conditions)
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
        .innerJoin(
          workflow,
          and(
            eq(workflowExecutionLogs.workflowId, workflow.id),
            eq(workflow.workspaceId, params.workspaceId)
          )
        )
        .innerJoin(
          permissions,
          and(
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workflow.workspaceId),
            eq(permissions.userId, userId)
          )
        )
        .where(conditions)

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
                  tokens: { prompt: 0, completion: 0, total: 0 },
                })
              }
              const modelCost = models.get(block.cost.model)
              modelCost.input += Number(block.cost.input) || 0
              modelCost.output += Number(block.cost.output) || 0
              modelCost.total += Number(block.cost.total) || 0
              modelCost.tokens.prompt += block.cost.tokens?.prompt || 0
              modelCost.tokens.completion += block.cost.tokens?.completion || 0
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
            prompt: totalPromptTokens,
            completion: totalCompletionTokens,
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

        const workflowSummary = {
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

        return {
          id: log.id,
          workflowId: log.workflowId,
          executionId: log.executionId,
          deploymentVersionId: log.deploymentVersionId,
          deploymentVersion: log.deploymentVersion ?? null,
          deploymentVersionName: log.deploymentVersionName ?? null,
          level: log.level,
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
