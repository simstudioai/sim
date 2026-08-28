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
import {
  UsageWindowRangeInvertedError,
  UsageWindowRangeTooLargeError,
} from '@/lib/billing/core/usage-analytics'
import { ForbiddenOperationError } from '@/lib/core/application'
import { formatCsvValue, toCsvRow } from '@/lib/core/utils/csv'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OrganizationUsageExportAPI')

const CSV_HEADER = toCsvRow(['Date', 'Source', 'Description', 'Workflow', 'Credits'])

/**
 * A bare number, to four decimals, with trailing zeros trimmed.
 *
 * Not `formatCreditsLabel`: that renders `"0 credits"` for any charge under half a
 * credit, so a real cost vanished from the export, and the `"N credits"` text made
 * the column unsummable in a spreadsheet — which is most of what a CSV is for.
 */
function formatExportCredits(credits: number): string {
  return String(Number(credits.toFixed(4)))
}

/** `formatCsvValue` neutralizes formula injection — model and workflow names are user-controlled. */
function toCsvLine(row: OrganizationUsageExportRow): string {
  return toCsvRow([
    formatCsvValue(row.createdAt),
    formatCsvValue(row.source),
    formatCsvValue(row.description),
    formatCsvValue(row.workflowName ?? ''),
    formatCsvValue(formatExportCredits(row.credits)),
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
        timezone: query.timezone,
        source: query.source,
      },
    })

    const csv = [CSV_HEADER, ...result.rows.map(toCsvLine)].join('\n')
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        // Every member's spend for one organization, behind session auth. Without
        // this a browser or shared intermediary may serve it again after the
        // viewer's access to that organization has been revoked.
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="organization-usage-${params.id}.csv"`,
        ...(result.truncated ? { 'X-Export-Truncated': '1' } : {}),
      },
    })
  } catch (error) {
    if (error instanceof ForbiddenOperationError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    // A range over the cap, or inverted, is the caller's input — the same
    // classification the three JSON routes make through `organizationUsageErrorPolicy`.
    if (
      error instanceof UsageWindowRangeTooLargeError ||
      error instanceof UsageWindowRangeInvertedError
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logger.error('Failed to export organization usage', { error: getErrorMessage(error) })
    return NextResponse.json({ error: 'Failed to export usage' }, { status: 500 })
  }
})
