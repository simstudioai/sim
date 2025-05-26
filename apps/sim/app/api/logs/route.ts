import { and, eq, gte, lte, or, type SQL, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { workflow, workflowLogs } from '@/db/schema'

const logger = createLogger('WorkflowLogsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

const QueryParamsSchema = z.object({
  includeWorkflow: z.enum(['true', 'false']).optional().default('false'),
  limit: z.coerce.number().optional().default(100),
  offset: z.coerce.number().optional().default(0),
  level: z.string().optional(),
  workflowIds: z.string().optional(), // Comma-separated list of workflow IDs
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional(),
})

// Used to retrieve and display workflow logs
export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized workflow logs access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    try {
      const { searchParams } = new URL(request.url)
      const params = QueryParamsSchema.parse(Object.fromEntries(searchParams.entries()))

      const userWorkflows = await db
        .select({ id: workflow.id })
        .from(workflow)
        .where(eq(workflow.userId, userId))

      const userWorkflowIds = userWorkflows.map((w) => w.id)

      if (userWorkflowIds.length === 0) {
        return NextResponse.json({ data: [], total: 0 }, { status: 200 })
      }

      // Build the conditions for the query
      let conditions: SQL<unknown> | undefined

      // Apply workflow filtering
      if (params.workflowIds) {
        const requestedWorkflowIds = params.workflowIds.split(',').map((id) => id.trim())
        // Ensure all requested workflows belong to the user
        const unauthorizedIds = requestedWorkflowIds.filter((id) => !userWorkflowIds.includes(id))
        if (unauthorizedIds.length > 0) {
          logger.warn(`[${requestId}] Unauthorized access to workflow logs`, {
            unauthorizedWorkflowIds: unauthorizedIds,
          })
          return NextResponse.json({ error: 'Unauthorized access to workflows' }, { status: 403 })
        }
        conditions = or(...requestedWorkflowIds.map((id) => eq(workflowLogs.workflowId, id)))
      } else {
        // No specific workflows requested, filter by all user workflows
        if (userWorkflowIds.length === 1) {
          conditions = eq(workflowLogs.workflowId, userWorkflowIds[0])
        } else {
          conditions = or(...userWorkflowIds.map((id) => eq(workflowLogs.workflowId, id)))
        }
      }

      // Apply additional filters if provided
      if (params.level) {
        conditions = and(conditions, eq(workflowLogs.level, params.level))
      }

      if (params.startDate) {
        const startDate = new Date(params.startDate)
        conditions = and(conditions, gte(workflowLogs.createdAt, startDate))
      }

      if (params.endDate) {
        const endDate = new Date(params.endDate)
        conditions = and(conditions, lte(workflowLogs.createdAt, endDate))
      }

      if (params.search) {
        const searchTerm = `%${params.search}%`
        conditions = and(
          conditions,
          or(
            sql`${workflowLogs.message} ILIKE ${searchTerm}`,
            sql`${workflowLogs.executionId} ILIKE ${searchTerm}`
          )
        )
      }

      // Execute the query with all conditions
      const logs = await db
        .select()
        .from(workflowLogs)
        .where(conditions)
        .orderBy(sql`${workflowLogs.createdAt} DESC`)
        .limit(params.limit)
        .offset(params.offset)

      // Get total count for pagination
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(workflowLogs)
        .where(conditions)

      const count = countResult[0]?.count || 0

      // If includeWorkflow is true, fetch the associated workflow data
      if (params.includeWorkflow === 'true' && logs.length > 0) {
        // Get unique workflow IDs from logs
        const uniqueWorkflowIds = [...new Set(logs.map((log) => log.workflowId))]

        // Create conditions for workflow query
        let workflowConditions: SQL<unknown> | undefined

        if (uniqueWorkflowIds.length === 1) {
          workflowConditions = eq(workflow.id, uniqueWorkflowIds[0])
        } else {
          workflowConditions = or(...uniqueWorkflowIds.map((id) => eq(workflow.id, id)))
        }

        // Fetch workflows
        const workflowData = await db.select().from(workflow).where(workflowConditions)

        // Create a map of workflow data for easy lookup
        const workflowMap = new Map(workflowData.map((w) => [w.id, w]))

        // Attach workflow data to each log
        const logsWithWorkflow = logs.map((log) => ({
          ...log,
          workflow: workflowMap.get(log.workflowId) || null,
        }))

        return NextResponse.json(
          {
            data: logsWithWorkflow,
            total: Number(count),
            page: Math.floor(params.offset / params.limit) + 1,
            pageSize: params.limit,
            totalPages: Math.ceil(Number(count) / params.limit),
          },
          { status: 200 }
        )
      }

      // Return logs without workflow data
      return NextResponse.json(
        {
          data: logs,
          total: Number(count),
          page: Math.floor(params.offset / params.limit) + 1,
          pageSize: params.limit,
          totalPages: Math.ceil(Number(count) / params.limit),
        },
        { status: 200 }
      )
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid workflow logs request parameters`, {
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
    logger.error(`[${requestId}] Workflow logs fetch error`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
