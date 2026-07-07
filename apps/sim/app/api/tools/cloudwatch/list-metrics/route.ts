import { CloudWatchClient, ListMetricsCommand } from '@aws-sdk/client-cloudwatch'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudwatchListMetricsContract } from '@/lib/api/contracts/tools/aws/cloudwatch-list-metrics'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudWatchListMetrics')

/** AWS ListMetrics returns up to 500 results per page. */
const METRICS_PAGE_SIZE = 500

/** Upper bound on pages drained to avoid unbounded loops on accounts with many metrics. */
const MAX_METRICS_PAGES = 20

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudwatchListMetricsContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info('Listing CloudWatch metrics')

    const client = new CloudWatchClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    try {
      const totalLimit = validatedData.limit ?? METRICS_PAGE_SIZE
      const metrics: {
        namespace: string
        metricName: string
        dimensions: { name: string; value: string }[]
      }[] = []
      let nextToken: string | undefined

      for (let page = 0; page < MAX_METRICS_PAGES; page++) {
        const command = new ListMetricsCommand({
          ...(validatedData.namespace && { Namespace: validatedData.namespace }),
          ...(validatedData.metricName && { MetricName: validatedData.metricName }),
          ...(validatedData.recentlyActive && { RecentlyActive: 'PT3H' }),
          ...(nextToken && { NextToken: nextToken }),
        })

        const response = await client.send(command)

        for (const m of response.Metrics ?? []) {
          metrics.push({
            namespace: m.Namespace ?? '',
            metricName: m.MetricName ?? '',
            dimensions: (m.Dimensions ?? []).map((d) => ({
              name: d.Name ?? '',
              value: d.Value ?? '',
            })),
          })
        }

        nextToken = response.NextToken
        if (!nextToken) break
        if (metrics.length >= totalLimit) break

        if (page === MAX_METRICS_PAGES - 1) {
          logger.warn(
            `ListMetrics hit pagination cap of ${MAX_METRICS_PAGES} pages; metric list may be incomplete`
          )
        }
      }

      const cappedMetrics = metrics.slice(0, totalLimit)

      logger.info(`Successfully listed ${cappedMetrics.length} metrics`)

      return NextResponse.json({
        success: true,
        output: { metrics: cappedMetrics },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('ListMetrics failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to list CloudWatch metrics: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
