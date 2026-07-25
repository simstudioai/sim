import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { exportAuditLogsContract } from '@/lib/api/contracts/audit-logs'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { formatCsvValue, toCsvRow } from '@/lib/table/export-format'
import { validateEnterpriseAuditAccess } from '@/app/api/v1/audit-logs/auth'
import { formatAuditLogEntry } from '@/app/api/v1/audit-logs/format'
import {
  buildFilterConditions,
  buildOrgScopeCondition,
  getOrgWorkspaceIds,
  queryAuditLogs,
} from '@/app/api/v1/audit-logs/query'

const logger = createLogger('AuditLogsExportAPI')

/**
 * Circuit breaker, not a UX boundary — an organization's audit trail can
 * genuinely grow large over time, unlike a single user's credit ledger, so
 * this is sized for "a reasonable audit review window" rather than "should
 * never happen." Hitting it truncates (signaled via X-Export-Truncated), it
 * doesn't error.
 */
const EXPORT_SAFETY_CAP = 10000
const EXPORT_PAGE_SIZE = 1000

const CSV_HEADER = toCsvRow([
  'Date',
  'Action',
  'Resource Type',
  'Resource Name',
  'Actor',
  'Description',
])

export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(
      exportAuditLogsContract,
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

    const authResult = await validateEnterpriseAuditAccess(
      session.user.id,
      parsed.data.query.organizationId
    )
    if (!authResult.success) {
      return authResult.response
    }

    const { organizationId, orgMemberIds } = authResult.context
    const { search, action, resourceType, actorId, startDate, endDate, includeDeparted } =
      parsed.data.query

    if (actorId && !orgMemberIds.includes(actorId)) {
      return NextResponse.json(
        { error: 'actorId is not a member of your organization' },
        { status: 400 }
      )
    }

    const orgWorkspaceIds = await getOrgWorkspaceIds(organizationId)
    const scopeCondition = buildOrgScopeCondition({
      organizationId,
      orgWorkspaceIds,
      orgMemberIds,
      includeDeparted,
    })
    const filterConditions = buildFilterConditions({
      action,
      resourceType,
      actorId,
      search,
      startDate,
      endDate,
    })
    const conditions = [scopeCondition, ...filterConditions]

    const rows: ReturnType<typeof formatAuditLogEntry>[] = []
    let cursor: string | undefined
    let truncated = false
    while (rows.length < EXPORT_SAFETY_CAP) {
      const page = await queryAuditLogs(
        conditions,
        Math.min(EXPORT_PAGE_SIZE, EXPORT_SAFETY_CAP - rows.length),
        cursor
      )
      rows.push(...page.data.map(formatAuditLogEntry))
      if (!page.nextCursor) break
      truncated = rows.length >= EXPORT_SAFETY_CAP
      cursor = page.nextCursor
    }

    if (truncated) {
      logger.warn('Audit log export truncated at safety cap', {
        userId: session.user.id,
        organizationId,
        cap: EXPORT_SAFETY_CAP,
      })
    }

    const csvLines = rows.map((log) =>
      toCsvRow([
        formatCsvValue(log.createdAt),
        formatCsvValue(log.action),
        formatCsvValue(log.resourceType),
        formatCsvValue(log.resourceName),
        formatCsvValue(log.actorEmail || log.actorName || 'System'),
        formatCsvValue(log.description),
      ])
    )

    const csv = [CSV_HEADER, ...csvLines].join('\n')
    const filename = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`

    logger.info('Exported audit logs', {
      userId: session.user.id,
      organizationId,
      rowCount: rows.length,
    })

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
        'X-Export-Truncated': truncated ? '1' : '0',
      },
    })
  } catch (error: unknown) {
    const message = getErrorMessage(error, 'Unknown error')
    logger.error('Audit logs export error', { error: message })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
