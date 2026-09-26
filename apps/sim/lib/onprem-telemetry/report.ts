import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  ONPREM_TELEMETRY_SCHEMA_VERSION,
  type OnPremUsageBucket,
  type OnPremUsageReportBody,
  onPremUsageReportResponseSchema,
} from '@/lib/api/contracts/onprem-telemetry'
import { collectUsageBuckets, reportWindow } from '@/lib/onprem-telemetry/collect'
import { getOnPremTelemetryConfig } from '@/lib/onprem-telemetry/config'

const logger = createLogger('OnPremUsageReport')

export const ONPREM_TELEMETRY_REPORT_PATH = '/api/onprem-telemetry/report'
const DELIVERY_TIMEOUT_MS = 15_000

export type OnPremUsageReportRun =
  | { status: 'disabled'; reason: string }
  | { status: 'delivered'; buckets: number; accepted: number }
  | { status: 'failed'; buckets: number; error: string }

/**
 * One reporting pass: aggregate the trailing window and POST it.
 *
 * Nothing on the workflow execution path calls this; it runs only from the
 * cron endpoint. The configuration check is the first statement so a disabled
 * deployment performs no query and no network request at all. Delivery
 * failure is returned, never thrown — the next tick re-sends the same window.
 */
export async function runOnPremUsageReport(now: Date = new Date()): Promise<OnPremUsageReportRun> {
  const config = getOnPremTelemetryConfig()
  if (!config.enabled) return { status: 'disabled', reason: config.reason }

  const window = reportWindow(now, config.lookbackDays)
  let buckets: OnPremUsageBucket[]
  try {
    buckets = await collectUsageBuckets(window)
  } catch (error) {
    const message = getErrorMessage(error)
    logger.warn('On-prem usage aggregation failed', { error: message })
    return { status: 'failed', buckets: 0, error: message }
  }

  const body: OnPremUsageReportBody = {
    schemaVersion: ONPREM_TELEMETRY_SCHEMA_VERSION,
    deploymentId: config.deploymentId,
    reportedAt: now.toISOString(),
    buckets,
  }

  try {
    const response = await fetch(`${config.endpoint}${ONPREM_TELEMETRY_REPORT_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`Receiver returned HTTP ${response.status}`)
    }
    const { accepted } = onPremUsageReportResponseSchema.parse(await response.json())
    logger.info('On-prem usage report delivered', { buckets: buckets.length, accepted })
    return { status: 'delivered', buckets: buckets.length, accepted }
  } catch (error) {
    const message = getErrorMessage(error)
    logger.warn('On-prem usage report not delivered; it will be re-sent next run', {
      error: message,
    })
    return { status: 'failed', buckets: buckets.length, error: message }
  }
}
