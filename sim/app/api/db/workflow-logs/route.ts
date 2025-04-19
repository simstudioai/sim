import { NextRequest, NextResponse } from 'next/server'
import { and, eq, gte, lte, or, SQL, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { workflow, workflowLogs } from '@/db/schema'

// Create a logger for this module
const logger = createLogger('WorkflowLogsAPI')

// No cache
export const dynamic = 'force-dynamic'
export const revalidate = 0

// Schema for query parameters
const QueryParamsSchema = z.object({
  includeWorkflow: z.enum(['true', 'false']).optional().default('false'),
  limit: z.coerce.number().optional().default(100),
  offset: z.coerce.number().optional().default(0),
  // Add more filters as needed (e.g., by level, date range, etc.)
  level: z.string().optional(),
  workflowId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
})

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    // Get the session directly in the API route
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized workflow logs access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    try {
      // Parse query parameters
      const { searchParams } = new URL(request.url)
      const params = QueryParamsSchema.parse(Object.fromEntries(searchParams.entries()))

      // Start building the query to get all workflows for the user
      const userWorkflows = await db
        .select({ id: workflow.id })
        .from(workflow)
        .where(eq(workflow.userId, userId))

      const workflowIds = userWorkflows.map((w) => w.id)

      if (workflowIds.length === 0) {
        return NextResponse.json({ data: [], total: 0 }, { status: 200 })
      }

      // Build the conditions for the query
      let conditions: SQL<unknown> | undefined

      // Start with the first workflowId
      conditions = eq(workflowLogs.workflowId, workflowIds[0])

      // Add additional workflowIds if there are more than one
      if (workflowIds.length > 1) {
        const workflowConditions = workflowIds.map((id) => eq(workflowLogs.workflowId, id))
        conditions = or(...workflowConditions)
      }

      // Apply additional filters if provided
      if (params.level) {
        conditions = and(conditions, eq(workflowLogs.level, params.level))
      }

      if (params.workflowId) {
        // Ensure the requested workflow belongs to the user
        if (workflowIds.includes(params.workflowId)) {
          conditions = and(conditions, eq(workflowLogs.workflowId, params.workflowId))
        } else {
          logger.warn(`[${requestId}] Unauthorized access to workflow logs`, {
            requestedWorkflowId: params.workflowId,
          })
          return NextResponse.json({ error: 'Unauthorized access to workflow' }, { status: 403 })
        }
      }

      if (params.startDate) {
        const startDate = new Date(params.startDate)
        conditions = and(conditions, gte(workflowLogs.createdAt, startDate))
      }

      if (params.endDate) {
        const endDate = new Date(params.endDate)
        conditions = and(conditions, lte(workflowLogs.createdAt, endDate))
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
