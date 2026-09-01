import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { exportUsageLogsContract } from '@/lib/api/contracts/user'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { getUserUsageLogs } from '@/lib/billing/core/usage-log'
import { apportionCredits } from '@/lib/billing/credits/conversion'
import {
  BILLING_USAGE_LOG_SOURCE_LABELS,
  toBillingUsageLogSource,
  toInternalUsageLogSources,
} from '@/lib/billing/usage-sources'
import { formatCsvValue, toCsvRow } from '@/lib/core/utils/csv'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveDateRange } from '@/app/api/users/me/usage-logs/shared'

const logger = createLogger('UsageLogsExportAPI')

/**
 * Circuit breaker, not a UX boundary — a personal credit ledger is bounded by
 * the user's own usage history and should never realistically approach this.
 * Exists only to keep a pathological account (or a bug upstream) from paging
 * forever; hitting it is worth alerting on, not a normal truncation case.
 */
const EXPORT_SAFETY_CAP = 50000
const EXPORT_PAGE_SIZE = 1000

const CSV_HEADER = toCsvRow(['Date', 'Type', 'Credits'])

/**
 * Downloads every usage log matching the current filter as CSV — unlike the
 * paginated list route, this fetches every matching row in one response
 * rather than a single page, since a user's own credit ledger is bounded
 * (unlike, say, a workspace's full execution history).
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(exportUsageLogsContract, request, {})
  if (!parsed.success) return parsed.response
  const { source, workspaceId, period, startDate, endDate } = parsed.data.query

  const dateRange = resolveDateRange(period, startDate, endDate)
  const filter = {
    source: source ? toInternalUsageLogSources(source) : undefined,
    workspaceId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  }

  const rows: Awaited<ReturnType<typeof getUserUsageLogs>>['logs'] = []
  let cursor: string | undefined
  let cursorCreatedAt: Date | undefined
  let truncated = false
  while (rows.length < EXPORT_SAFETY_CAP) {
    const page = await getUserUsageLogs(auth.userId, {
      ...filter,
      limit: Math.min(EXPORT_PAGE_SIZE, EXPORT_SAFETY_CAP - rows.length),
      cursor,
      cursorCreatedAt,
      includeSummary: false,
    })
    rows.push(...page.logs)
    if (!page.pagination.hasMore) break
    truncated = rows.length >= EXPORT_SAFETY_CAP
    cursor = page.pagination.nextCursor
    const lastRow = page.logs[page.logs.length - 1]
    cursorCreatedAt = lastRow ? new Date(lastRow.createdAt) : undefined
  }

  /**
   * Apportioned over the rows this file actually contains, not over a second
   * unbounded read of the whole filter.
   *
   * `getUsageCreditsByLogId` exists for the paginated list, where a row must show the
   * same value on every page and only the full set can guarantee that. An export has
   * no pages: it already holds every row it will print. Re-reading the filter here
   * made {@link EXPORT_SAFETY_CAP} illusory — the loop stopped at the cap and the very
   * next statement loaded every matching row anyway, which with `period=all` is an
   * unbounded lifetime scan.
   *
   * The values are unchanged in the ordinary case, because an untruncated export's row
   * set *is* the whole filter. When it truncates they are strictly better: the printed
   * rows now reconcile to the printed total instead of to one that includes rows the
   * file does not contain.
   */
  const creditsByLogId = apportionCredits(rows.map((log) => ({ key: log.id, dollars: log.cost })))

  if (truncated) {
    logger.error('Usage log export hit the safety cap — investigate this account', {
      userId: auth.userId,
      period,
      cap: EXPORT_SAFETY_CAP,
    })
  }

  const csvLines = rows.map((log) => {
    const type =
      log.source === 'workflow' && log.workflowName
        ? `Workflow: ${log.workflowName}`
        : BILLING_USAGE_LOG_SOURCE_LABELS[toBillingUsageLogSource(log.source)]
    return toCsvRow([
      formatCsvValue(log.createdAt),
      formatCsvValue(type),
      formatCsvValue(creditsByLogId[log.id]),
    ])
  })

  const csv = [CSV_HEADER, ...csvLines].join('\n')
  const filename = `credit-usage-${period}-${new Date().toISOString().slice(0, 10)}.csv`

  logger.info('Exported usage logs', { userId: auth.userId, period, rowCount: rows.length })

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-cache',
      'X-Export-Truncated': truncated ? '1' : '0',
    },
  })
})
