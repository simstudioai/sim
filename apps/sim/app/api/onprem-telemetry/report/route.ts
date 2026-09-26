import { db } from '@sim/db'
import { onpremDeployment, onpremUsageReport } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type OnPremUsageBucket,
  onPremUsageReportContract,
} from '@/lib/api/contracts/onprem-telemetry'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OnPremTelemetryReportAPI')

/** Buckets are small; 90 days of per-model lines fits comfortably. */
const MAX_BODY_BYTES = 2 * 1024 * 1024

function readBearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token.length > 0 ? token : null
}

/** Last bucket wins for a repeated day, so one INSERT never touches a row twice. */
function dedupeByPeriodStart(buckets: OnPremUsageBucket[]): OnPremUsageBucket[] {
  const byStart = new Map<string, OnPremUsageBucket>()
  for (const bucket of buckets) byStart.set(new Date(bucket.periodStart).toISOString(), bucket)
  return [...byStart.values()]
}

/**
 * POST /api/onprem-telemetry/report
 *
 * Receives a self-hosted deployment's daily usage buckets. Authenticated by
 * the deployment API key issued through the admin API; the body's
 * `deploymentId` must be the key's own deployment. Each day is upserted on
 * `(deployment_id, period_start)`, so a re-sent day replaces the earlier copy.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const token = readBearerToken(request)
  if (!token) {
    return NextResponse.json({ error: 'Deployment API key required' }, { status: 401 })
  }

  const [deployment] = await db
    .select({ id: onpremDeployment.id })
    .from(onpremDeployment)
    .where(eq(onpremDeployment.apiKeyHash, sha256Hex(token)))
    .limit(1)
  if (!deployment) {
    return NextResponse.json({ error: 'Invalid deployment API key' }, { status: 401 })
  }

  const parsed = await parseRequest(
    onPremUsageReportContract,
    request,
    {},
    {
      maxBodyBytes: MAX_BODY_BYTES,
    }
  )
  if (!parsed.success) return parsed.response

  const { body } = parsed.data
  if (body.deploymentId !== deployment.id) {
    return NextResponse.json(
      { error: 'deploymentId does not match the authenticated deployment' },
      { status: 403 }
    )
  }

  const buckets = dedupeByPeriodStart(body.buckets)
  if (buckets.length === 0) {
    return NextResponse.json({ accepted: 0 })
  }

  const reportedAt = new Date(body.reportedAt)
  const rows = buckets.map((bucket) => ({
    id: generateId(),
    deploymentId: deployment.id,
    periodStart: new Date(bucket.periodStart),
    periodEnd: new Date(bucket.periodEnd),
    workflowExecutions: bucket.workflowExecutions,
    workflowExecutionsFailed: bucket.workflowExecutionsFailed,
    workflowDurationMs: bucket.workflowDurationMs,
    credits: bucket.credits.toString(),
    inputTokens: bucket.inputTokens,
    outputTokens: bucket.outputTokens,
    breakdown: { sources: bucket.sources, models: bucket.models },
    schemaVersion: body.schemaVersion,
    reportedAt,
  }))

  await db
    .insert(onpremUsageReport)
    .values(rows)
    .onConflictDoUpdate({
      target: [onpremUsageReport.deploymentId, onpremUsageReport.periodStart],
      set: {
        periodEnd: sql`excluded.period_end`,
        workflowExecutions: sql`excluded.workflow_executions`,
        workflowExecutionsFailed: sql`excluded.workflow_executions_failed`,
        workflowDurationMs: sql`excluded.workflow_duration_ms`,
        credits: sql`excluded.credits`,
        inputTokens: sql`excluded.input_tokens`,
        outputTokens: sql`excluded.output_tokens`,
        breakdown: sql`excluded.breakdown`,
        schemaVersion: sql`excluded.schema_version`,
        reportedAt: sql`excluded.reported_at`,
        receivedAt: sql`now()`,
      },
    })

  logger.info('Accepted on-prem usage report', {
    deploymentId: deployment.id,
    buckets: rows.length,
  })
  return NextResponse.json({ accepted: rows.length })
})
