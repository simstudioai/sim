/**
 * GET /api/v1/admin/onprem-telemetry/deployments/[id]/usage
 *
 * Daily usage a deployment has reported, each day valued at the rate in
 * effect at its `periodStart`. Every row carries the rate it was valued with
 * and the resulting dollars, so a figure is never shown without the rate
 * behind it.
 *
 * Query:
 *   - from?: ISO date (inclusive; default 30 days before `to`)
 *   - to?: ISO date (exclusive; default start of tomorrow UTC)
 *
 * Response: AdminSingleResponse<AdminV1OnPremUsageResult>
 */

import { db } from '@sim/db'
import { onpremUsageReport } from '@sim/db/schema'
import { and, asc, eq, gte, lt } from 'drizzle-orm'
import { adminV1GetOnPremUsageContract } from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { utcDayStart } from '@/lib/onprem-telemetry/collect'
import {
  findDeployment,
  loadRates,
  presentDeployments,
  presentRate,
} from '@/lib/onprem-telemetry/presenters'
import { valueUsage } from '@/lib/onprem-telemetry/rates'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminValidationErrorResponse,
  badRequestResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

interface RouteParams {
  id: string
}

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_RANGE_DAYS = 30

interface StoredBreakdown {
  sources?: unknown[]
  models?: unknown[]
}

export const GET = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1GetOnPremUsageContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const deployment = await findDeployment(id)
    if (!deployment) return notFoundResponse('Deployment')

    const now = new Date()
    const to = parsed.data.query.to
      ? new Date(parsed.data.query.to)
      : new Date(utcDayStart(now).getTime() + DAY_MS)
    const from = parsed.data.query.from
      ? new Date(parsed.data.query.from)
      : new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS)
    if (from.getTime() >= to.getTime()) return badRequestResponse('from must be before to')

    const [reports, rates, [presented]] = await Promise.all([
      db
        .select()
        .from(onpremUsageReport)
        .where(
          and(
            eq(onpremUsageReport.deploymentId, id),
            gte(onpremUsageReport.periodStart, from),
            lt(onpremUsageReport.periodStart, to)
          )
        )
        .orderBy(asc(onpremUsageReport.periodStart)),
      loadRates([id]).then((byId) => byId.get(id) ?? []),
      presentDeployments([deployment], now),
    ])

    const valued = valueUsage(
      reports.map((report) => ({ ...report, credits: Number(report.credits) })),
      rates
    )

    const totals = {
      workflowExecutions: 0,
      workflowExecutionsFailed: 0,
      workflowDurationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      credits: 0,
      usd: 0,
      unvaluedCredits: 0,
    }
    const rows = valued.map(({ row, rate, usd }) => {
      const breakdown = (row.breakdown ?? {}) as StoredBreakdown
      totals.workflowExecutions += row.workflowExecutions
      totals.workflowExecutionsFailed += row.workflowExecutionsFailed
      totals.workflowDurationMs += row.workflowDurationMs
      totals.inputTokens += row.inputTokens
      totals.outputTokens += row.outputTokens
      totals.credits += row.credits
      if (usd === null) totals.unvaluedCredits += row.credits
      else totals.usd += usd
      return {
        periodStart: row.periodStart.toISOString(),
        periodEnd: row.periodEnd.toISOString(),
        workflowExecutions: row.workflowExecutions,
        workflowExecutionsFailed: row.workflowExecutionsFailed,
        workflowDurationMs: row.workflowDurationMs,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        credits: row.credits,
        rate: rate ? presentRate(rate) : null,
        usd,
        sources: Array.isArray(breakdown.sources) ? breakdown.sources : [],
        models: Array.isArray(breakdown.models) ? breakdown.models : [],
        reportedAt: row.reportedAt.toISOString(),
        receivedAt: row.receivedAt.toISOString(),
      }
    })
    totals.credits = Math.round(totals.credits * 1e6) / 1e6
    totals.usd = Math.round(totals.usd * 1e6) / 1e6
    totals.unvaluedCredits = Math.round(totals.unvaluedCredits * 1e6) / 1e6

    return singleResponse({
      deployment: presented,
      from: from.toISOString(),
      to: to.toISOString(),
      rows,
      totals,
    })
  })
)
