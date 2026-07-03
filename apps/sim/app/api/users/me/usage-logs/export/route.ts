import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { exportUsageLogsContract } from '@/lib/api/contracts/user'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { getUserUsageLogs, type UsageLogSource } from '@/lib/billing/core/usage-log'
import { apportionCredits } from '@/lib/billing/credits/conversion'
import { neutralizeCsvFormula } from '@/lib/core/utils/csv'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveDateRange, resolveWorkflowNames } from '@/app/api/users/me/usage-logs/shared'

const logger = createLogger('UsageLogsExportAPI')

/** Safety cap on export size — a single user's credit ledger; not expected to approach this. */
const MAX_EXPORT_ROWS = 5000
const EXPORT_PAGE_SIZE = 500

const CSV_HEADER = ['Date', 'Type', 'Credits', 'Dollar cost'].join(',')

function escapeCsvField(value: string | number): string {
  const str = typeof value === 'string' ? neutralizeCsvFormula(value) : String(value)
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

/**
 * Humanized labels for `usage_log.source`, mirroring the Credit usage page's
 * row rendering so the export reads identically to what's on screen.
 */
const SOURCE_LABELS: Record<UsageLogSource, string> = {
  workflow: 'Workflow',
  wand: 'Wand',
  copilot: 'Chat',
  'workspace-chat': 'Chat',
  mcp_copilot: 'Chat (MCP)',
  mothership_block: 'Agent block',
  'knowledge-base': 'Knowledge Base',
  'voice-input': 'Voice input',
  enrichment: 'Enrichment',
}

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
  while (rows.length <= MAX_EXPORT_ROWS) {
    const page = await getUserUsageLogs(auth.userId, {
      source: source as UsageLogSource | undefined,
      workspaceId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      limit: EXPORT_PAGE_SIZE,
      cursor,
    })
    rows.push(...page.logs)
    if (!page.pagination.hasMore) break
    cursor = page.pagination.nextCursor
  }

  if (rows.length > MAX_EXPORT_ROWS) {
    logger.warn('Usage log export truncated at safety cap', {
      userId: auth.userId,
      period,
      rowCount: rows.length,
      cap: MAX_EXPORT_ROWS,
    })
  }
  const exportedRows = rows.slice(0, MAX_EXPORT_ROWS)

  const workflowNames = await resolveWorkflowNames(exportedRows)

  // Apportioned across the full export (not per-page) so every row's credits
  // sum exactly to the export's own total — see route.ts's identical rationale.
  const creditsByLogId = apportionCredits(
    exportedRows.map((log) => ({ key: log.id, dollars: log.cost }))
  )

  const csvLines = exportedRows.map((log) => {
    const workflowName = log.workflowId ? workflowNames.get(log.workflowId) : undefined
    const type =
      log.source === 'workflow' && workflowName
        ? `Workflow: ${workflowName}`
        : SOURCE_LABELS[log.source]
    return [
      escapeCsvField(log.createdAt),
      escapeCsvField(type),
      escapeCsvField(creditsByLogId[log.id]),
      escapeCsvField(log.cost),
    ].join(',')
  })

  const csv = [CSV_HEADER, ...csvLines].join('\n')
  const filename = `credit-usage-${period}-${new Date().toISOString().slice(0, 10)}.csv`

  logger.info('Exported usage logs', { userId: auth.userId, period, rowCount: exportedRows.length })

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-cache',
    },
  })
})
