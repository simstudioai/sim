import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { runOnPremUsageReport } from '@/lib/onprem-telemetry/report'

const logger = createLogger('OnPremUsageReportCron')

export const dynamic = 'force-dynamic'

/**
 * Cron endpoint that reports this deployment's usage to the configured Sim
 * instance. Scheduled in helm/sim/values.yaml (`cronjobs.jobs.onpremUsageReport`)
 * and docker/crontab.
 *
 * The whole feature lives behind this endpoint: it is the only caller of the
 * reporter, and nothing on the workflow execution path imports it. When
 * `ONPREM_TELEMETRY_ENABLED` is unset the reporter returns before touching the
 * database or the network. Re-reports are idempotent on the receiver, so no
 * lock is needed to keep overlapping runs or multiple replicas correct.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const authError = verifyCronAuth(request, 'On-prem usage report')
  if (authError) return authError

  const result = await runOnPremUsageReport()

  if (result.status === 'failed') {
    logger.warn('On-prem usage report run failed', result)
    return NextResponse.json({ success: false, ...result }, { status: 502 })
  }

  return NextResponse.json({ success: true, ...result })
})
