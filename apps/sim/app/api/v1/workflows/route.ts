import { db } from '@sim/db'
import { permissions, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, gt, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createApiResponse, getUserLimits } from '@/app/api/v1/logs/meta'
import { checkRateLimit, createRateLimitResponse } from '@/app/api/v1/middleware'

const logger = createLogger('V1WorkflowsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

const QueryParamsSchema = z.object({
  workspaceId: z.string(),
  folderId: z.string().optional(),
  deployedOnly: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  cursor: z.string().optional(),
})

interface CursorData {
  sortOrder: number
  createdAt: string
  id: string
}

function encodeCursor(data: CursorData): string {
  return Buffer.from(JSON.stringify(data)).toString('base64')
}

function decodeCursor(cursor: string): CursorData | null {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64').toString())
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const rateLimit = await checkRateLimit(request, 'workflows')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const { searchParams } = new URL(request.url)
    const rawParams = Object.fromEntries(searchParams.entries())

    const validationResult = QueryParamsSchema.safeParse(rawParams)
    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: validationResult.error.errors },
        { status: 400 }
      )
    }

    const params = validationResult.data

    logger.info(`[${requestId}] Fetching workflows for workspace ${params.workspaceId}`, {
      userId,
      filters: {
        folderId: params.folderId,
        deployedOnly: params.deployedOnly,
      },
    })

    const conditions = [
      eq(workflow.workspaceId, params.workspaceId),
      eq(permissions.entityType, 'workspace'),
      eq(permissions.entityId, params.workspaceId),
      eq(permissions.userId, userId),
    ]

    if (params.folderId) {
      conditions.push(eq(workflow.folderId, params.folderId))
    }

    if (params.deployedOnly) {
      conditions.push(eq(workflow.isDeployed, true))
    }

    if (params.cursor) {
      const cursorData = decodeCursor(params.cursor)
      if (cursorData) {
        const cursorCondition = or(
          gt(workflow.sortOrder, cursorData.sortOrder),
          and(
            eq(workflow.sortOrder, cursorData.sortOrder),
            gt(workflow.createdAt, new Date(cursorData.createdAt))
          ),
          and(
            eq(workflow.sortOrder, cursorData.sortOrder),
            eq(workflow.createdAt, new Date(cursorData.createdAt)),
            gt(workflow.id, cursorData.id)
          )
        )
        if (cursorCondition) {
          conditions.push(cursorCondition)
        }
      }
    }

    const orderByClause = [asc(workflow.sortOrder), asc(workflow.createdAt), asc(workflow.id)]

    const rows = await db
      .select({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        color: workflow.color,
        folderId: workflow.folderId,
        workspaceId: workflow.workspaceId,
        isDeployed: workflow.isDeployed,
        deployedAt: workflow.deployedAt,
        runCount: workflow.runCount,
        lastRunAt: workflow.lastRunAt,
        sortOrder: workflow.sortOrder,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
      })
      .from(workflow)
      .innerJoin(
        permissions,
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, params.workspaceId),
          eq(permissions.userId, userId)
        )
      )
      .where(and(...conditions))
      .orderBy(...orderByClause)
      .limit(params.limit + 1)

    const hasMore = rows.length > params.limit
    const data = rows.slice(0, params.limit)

    let nextCursor: string | undefined
    if (hasMore && data.length > 0) {
      const lastWorkflow = data[data.length - 1]
      nextCursor = encodeCursor({
        sortOrder: lastWorkflow.sortOrder,
        createdAt: lastWorkflow.createdAt.toISOString(),
        id: lastWorkflow.id,
      })
    }

    const formattedWorkflows = data.map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      color: w.color,
      folderId: w.folderId,
      workspaceId: w.workspaceId,
      isDeployed: w.isDeployed,
      deployedAt: w.deployedAt?.toISOString() || null,
      runCount: w.runCount,
      lastRunAt: w.lastRunAt?.toISOString() || null,
      createdAt: w.createdAt.toISOString(),
      updatedAt: w.updatedAt.toISOString(),
    }))

    const limits = await getUserLimits(userId)

    const response = createApiResponse(
      {
        data: formattedWorkflows,
        nextCursor,
      },
      limits,
      rateLimit
    )

    return NextResponse.json(response.body, { headers: response.headers })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Workflows fetch error`, { error: message })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
