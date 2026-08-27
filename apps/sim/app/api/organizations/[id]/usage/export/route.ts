import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { exportOrganizationUsageContract } from '@/lib/api/contracts/organization-usage'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import {
  exportOrganizationUsageEvents,
  type OrganizationUsageExportRow,
} from '@/lib/billing/application/organization-usage/export-organization-usage-events'
import { formatCreditsLabel } from '@/lib/billing/credits/conversion'
import type { InternalUsageLogSource } from '@/lib/billing/usage-sources'
import { ForbiddenOperationError } from '@/lib/core/application'
import { formatCsvValue, toCsvRow } from '@/lib/core/utils/csv'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OrganizationUsageExportAPI')

const CSV_HEADER = toCsvRow(['Date', 'Source', 'Description', 'Workflow', 'Credits'])

/** `formatCsvValue` neutralizes formula injection — model and workflow names are user-controlled. */
function toCsvLine(row: OrganizationUsageExportRow): string {
  return toCsvRow([
    formatCsvValue(row.createdAt),
    formatCsvValue(row.source),
    formatCsvValue(row.description),
    formatCsvValue(row.workflowName ?? ''),
    formatCsvValue(formatCreditsLabel(row.credits)),
  ])
}

/**
 * A raw handler rather than a JSON builder: the body is `text/csv`, and the response
 * carries `X-Export-Truncated` so the client can tell the user their range was capped
 * rather than silently handing them a partial file.
 */
export const GET = withRouteHandler(async (request: NextRequest, context) => {
  try {
    const session = await getSession()
    const sessionId = session?.session?.id
    if (!session?.user?.id || !sessionId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(exportOrganizationUsageContract, request, context, {
      validationErrorResponse: (error) =>
        NextResponse.json(
          { error: getValidationErrorMessage(error, 'Invalid query parameters') },
          { status: 400 }
        ),
    })
    if (!parsed.success) return parsed.response

    const { query, params } = parsed.data
    const result = await exportOrganizationUsageEvents.execute({
      principal: { kind: 'session', userId: session.user.id, sessionId },
      input: {
        organizationId: params.id,
        preset: query.preset,
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
        source: query.source as InternalUsageLogSource[] | undefined,
      },
    })

    const csv = [CSV_HEADER, ...result.rows.map(toCsvLine)].join('\n')
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="organization-usage-${params.id}.csv"`,
        ...(result.truncated ? { 'X-Export-Truncated': '1' } : {}),
      },
    })
  } catch (error) {
    if (error instanceof ForbiddenOperationError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    logger.error('Failed to export organization usage', { error: getErrorMessage(error) })
    return NextResponse.json({ error: 'Failed to export usage' }, { status: 500 })
  }
})
