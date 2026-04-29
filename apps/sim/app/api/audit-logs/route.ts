import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { auditLogsQuerySchema } from '@/lib/api/contracts/audit-logs'
import { getValidationErrorMessage, validateSchema } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { validateEnterpriseAuditAccess } from '@/app/api/v1/audit-logs/auth'
import { formatAuditLogEntry } from '@/app/api/v1/audit-logs/format'
import {
  buildFilterConditions,
  buildOrgScopeCondition,
  queryAuditLogs,
} from '@/app/api/v1/audit-logs/query'

const logger = createLogger('AuditLogsAPI')

export const dynamic = 'force-dynamic'

export const GET = withRouteHandler(async (request: Request) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const authResult = await validateEnterpriseAuditAccess(session.user.id)
    if (!authResult.success) {
      return authResult.response
    }

    const { orgMemberIds } = authResult.context

    const { searchParams } = new URL(request.url)
    const parsedQuery = validateSchema(
      auditLogsQuerySchema,
      Object.fromEntries(searchParams.entries())
    )
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(parsedQuery.error, 'Invalid query parameters') },
        { status: 400 }
      )
    }

    const {
      search,
      action,
      resourceType,
      actorId,
      startDate,
      endDate,
      includeDeparted,
      limit,
      cursor,
    } = parsedQuery.data

    const scopeCondition = await buildOrgScopeCondition(orgMemberIds, includeDeparted)
    const filterConditions = buildFilterConditions({
      action,
      resourceType,
      actorId,
      search,
      startDate,
      endDate,
    })

    const { data, nextCursor } = await queryAuditLogs(
      [scopeCondition, ...filterConditions],
      limit,
      cursor
    )

    return NextResponse.json({
      success: true,
      data: data.map(formatAuditLogEntry),
      nextCursor,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Audit logs fetch error', { error: message })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
