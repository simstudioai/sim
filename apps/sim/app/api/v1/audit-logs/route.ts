/**
 * GET /api/v1/audit-logs
 *
 * List audit logs scoped to the authenticated user's organization.
 * Requires enterprise subscription and org admin/owner role.
 *
 * Query Parameters:
 *   - action: string (optional) - Filter by action (e.g., "workflow.created")
 *   - resourceType: string (optional) - Filter by resource type (e.g., "workflow")
 *   - resourceId: string (optional) - Filter by resource ID
 *   - workspaceId: string (optional) - Filter by workspace ID
 *   - actorId: string (optional) - Filter by actor user ID (must be an org member)
 *   - startDate: string (optional) - ISO 8601 date, filter createdAt >= startDate
 *   - endDate: string (optional) - ISO 8601 date, filter createdAt <= endDate
 *   - includeDeparted: boolean (optional, default: false) - Include logs from departed members
 *   - limit: number (optional, default: 50, max: 100)
 *   - cursor: string (optional) - Opaque cursor for pagination
 *
 * Response: { data: AuditLogEntry[], nextCursor?: string, limits: UserLimits }
 */

import { db } from '@sim/db'
import { auditLog, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, gte, inArray, lt, lte, or, type SQL } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { validateEnterpriseAuditAccess } from '@/app/api/v1/audit-logs/auth'
import { formatAuditLogEntry } from '@/app/api/v1/audit-logs/format'
import { createApiResponse, getUserLimits } from '@/app/api/v1/logs/meta'
import { checkRateLimit, createRateLimitResponse } from '@/app/api/v1/middleware'

const logger = createLogger('V1AuditLogsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

const isoDateString = z.string().refine((val) => !Number.isNaN(Date.parse(val)), {
  message: 'Invalid date format. Use ISO 8601.',
})

const QueryParamsSchema = z.object({
  action: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  workspaceId: z.string().optional(),
  actorId: z.string().optional(),
  startDate: isoDateString.optional(),
  endDate: isoDateString.optional(),
  includeDeparted: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .optional()
    .default('false'),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  cursor: z.string().optional(),
})

interface CursorData {
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
    const rateLimit = await checkRateLimit(request, 'audit-logs')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!

    const authResult = await validateEnterpriseAuditAccess(userId)
    if (!authResult.success) {
      return authResult.response
    }

    const { orgMemberIds } = authResult.context

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

    if (params.actorId && !orgMemberIds.includes(params.actorId)) {
      return NextResponse.json(
        { error: 'actorId is not a member of your organization' },
        { status: 400 }
      )
    }

    let scopeCondition: SQL<unknown>

    if (params.includeDeparted) {
      const orgWorkspaces = await db
        .select({ id: workspace.id })
        .from(workspace)
        .where(inArray(workspace.ownerId, orgMemberIds))

      const orgWorkspaceIds = orgWorkspaces.map((w) => w.id)

      if (orgWorkspaceIds.length > 0) {
        scopeCondition = or(
          inArray(auditLog.actorId, orgMemberIds),
          inArray(auditLog.workspaceId, orgWorkspaceIds)
        )!
      } else {
        scopeCondition = inArray(auditLog.actorId, orgMemberIds)
      }
    } else {
      scopeCondition = inArray(auditLog.actorId, orgMemberIds)
    }

    const conditions: SQL<unknown>[] = [scopeCondition]

    if (params.action) conditions.push(eq(auditLog.action, params.action))
    if (params.resourceType) conditions.push(eq(auditLog.resourceType, params.resourceType))
    if (params.resourceId) conditions.push(eq(auditLog.resourceId, params.resourceId))
    if (params.workspaceId) conditions.push(eq(auditLog.workspaceId, params.workspaceId))
    if (params.actorId) conditions.push(eq(auditLog.actorId, params.actorId))
    if (params.startDate) conditions.push(gte(auditLog.createdAt, new Date(params.startDate)))
    if (params.endDate) conditions.push(lte(auditLog.createdAt, new Date(params.endDate)))

    if (params.cursor) {
      const cursorData = decodeCursor(params.cursor)
      if (cursorData?.createdAt && cursorData.id) {
        const cursorDate = new Date(cursorData.createdAt)
        if (!Number.isNaN(cursorDate.getTime())) {
          conditions.push(
            or(
              lt(auditLog.createdAt, cursorDate),
              and(eq(auditLog.createdAt, cursorDate), lt(auditLog.id, cursorData.id))
            )!
          )
        }
      }
    }

    const rows = await db
      .select()
      .from(auditLog)
      .where(and(...conditions))
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(params.limit + 1)

    const hasMore = rows.length > params.limit
    const data = rows.slice(0, params.limit)

    let nextCursor: string | undefined
    if (hasMore && data.length > 0) {
      const last = data[data.length - 1]
      nextCursor = encodeCursor({
        createdAt: last.createdAt.toISOString(),
        id: last.id,
      })
    }

    const formattedLogs = data.map(formatAuditLogEntry)

    const limits = await getUserLimits(userId)
    const response = createApiResponse({ data: formattedLogs, nextCursor }, limits, rateLimit)

    return NextResponse.json(response.body, { headers: response.headers })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Audit logs fetch error`, { error: message })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
