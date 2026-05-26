import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { listAuditLogsContract } from '@/lib/api/contracts/audit-logs'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
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

export const GET = withRouteHandler(async (request: NextRequest) => {
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

    const parsed = await parseRequest(
      listAuditLogsContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          NextResponse.json(
            { error: getValidationErrorMessage(error, 'Invalid query parameters') },
            { status: 400 }
          ),
      }
    )
    if (!parsed.success) return parsed.response

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
    } = parsed.data.query

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
    const message = getErrorMessage(error, 'Unknown error')
    logger.error('Audit logs fetch error', { error: message })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
