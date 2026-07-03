import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { exportUsageLogsContract } from '@/lib/api/contracts/user'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { getUserUsageLogs, type UsageLogSource } from '@/lib/billing/core/usage-log'
import { apportionCredits } from '@/lib/billing/credits/conversion'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { formatCsvValue, toCsvRow } from '@/lib/table/export-format'
import { resolveDateRange } from '@/app/api/users/me/usage-logs/shared'
import { USAGE_LOG_SOURCE_LABELS } from '@/app/api/users/me/usage-logs/source-labels'

const logger = createLogger('UsageLogsExportAPI')

/** Safety cap on export size — a single user's credit ledger; not expected to approach this. */
const MAX_EXPORT_ROWS = 5000
const EXPORT_PAGE_SIZE = 500

const CSV_HEADER = toCsvRow(['Date', 'Type', 'Credits', 'Dollar cost'])

/**
 * Downloads every usage log matching the current filter as CSV — unlike the
 * paginated list route, this fetches up to `MAX_EXPORT_ROWS` in one response
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

  const rows: Awaited<ReturnType<typeof getUserUsageLogs>>['logs'] = []
  let cursor: string | undefined
  let truncated = false
  while (rows.length < MAX_EXPORT_ROWS) {
    const page = await getUserUsageLogs(auth.userId, {
      source: source as UsageLogSource | undefined,
      workspaceId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      limit: Math.min(EXPORT_PAGE_SIZE, MAX_EXPORT_ROWS - rows.length),
      cursor,
      includeSummary: false,
    })
    rows.push(...page.logs)
    if (!page.pagination.hasMore) break
    truncated = rows.length >= MAX_EXPORT_ROWS
    cursor = page.pagination.nextCursor
  }

  if (truncated) {
    logger.warn('Usage log export truncated at safety cap', {
      userId: auth.userId,
      period,
      cap: MAX_EXPORT_ROWS,
    })
  }

  // Apportioned across the full export (not per-page) so every row's credits
  // sum exactly to the export's own total — see route.ts's identical rationale.
  const creditsByLogId = apportionCredits(rows.map((log) => ({ key: log.id, dollars: log.cost })))

  const csvLines = rows.map((log) => {
    const type =
      log.source === 'workflow' && log.workflowName
        ? `Workflow: ${log.workflowName}`
        : USAGE_LOG_SOURCE_LABELS[log.source]
    return toCsvRow([
      formatCsvValue(log.createdAt),
      formatCsvValue(type),
      formatCsvValue(creditsByLogId[log.id]),
      formatCsvValue(log.cost),
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
    },
  })
})
