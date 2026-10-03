import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { exportAuditLogsContract } from '@/lib/api/contracts/audit-logs'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import {
  buildFilterConditions,
  buildOrgScopeCondition,
  getOrgWorkspaceIds,
  queryAuditLogs,
} from '@/lib/audit-logs/query'
import { getSession } from '@/lib/auth'
import { formatCsvValue, toCsvRow } from '@/lib/core/utils/csv'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { validateEnterpriseAuditAccess } from '@/app/api/v1/audit-logs/auth'
import { formatAuditLogEntry } from '@/app/api/v1/audit-logs/format'

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
    const { actorId, workspaceId, includeDeparted } = parsed.data.query

    if (actorId && !orgMemberIds.includes(actorId)) {
      return NextResponse.json(
        { error: 'actorId is not a member of your organization' },
        { status: 400 }
      )
    }

    const orgWorkspaceIds = await getOrgWorkspaceIds(organizationId)
    /**
     * The same refusal `listAuditLogs` gives. The scope predicate already makes an
     * out-of-organization id return nothing, but an empty CSV and a 400 that names the
     * problem are very different answers to the same bad request, and the two paths
     * disagreeing about which one you get is what an audit trail cannot afford.
     */
    if (workspaceId && !orgWorkspaceIds.includes(workspaceId)) {
      return NextResponse.json(
        { error: 'workspaceId does not belong to your organization' },
        { status: 400 }
      )
    }
    const scopeCondition = buildOrgScopeCondition({
      organizationId,
      orgWorkspaceIds,
      orgMemberIds,
      includeDeparted,
    })
    /**
     * The whole parsed query, not a hand-listed subset.
     *
     * Every field of `AuditLogFilterParams` is optional, so dropping one type-checks
     * silently — which is how `workspaceId` came to be accepted by the contract,
     * honoured by the list route, and ignored here: an admin looking at one
     * workspace's feed downloaded the entire organization's, under a truncation
     * warning that blamed the date range.
     */
    const filterConditions = buildFilterConditions(parsed.data.query)
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
