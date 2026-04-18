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

import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { validateEnterpriseAuditAccess } from '@/app/api/v1/audit-logs/auth'
import { formatAuditLogEntry } from '@/app/api/v1/audit-logs/format'
import {
  buildFilterConditions,
  buildOrgScopeCondition,
  queryAuditLogs,
} from '@/app/api/v1/audit-logs/query'
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

export async function GET(request: NextRequest) {
  const requestId = generateId().slice(0, 8)

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

    const scopeCondition = await buildOrgScopeCondition(orgMemberIds, params.includeDeparted)
    const filterConditions = buildFilterConditions({
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      workspaceId: params.workspaceId,
      actorId: params.actorId,
      startDate: params.startDate,
      endDate: params.endDate,
    })

    const { data, nextCursor } = await queryAuditLogs(
      [scopeCondition, ...filterConditions],
      params.limit,
      params.cursor
    )

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
