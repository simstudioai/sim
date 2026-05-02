import { CloudWatchClient, ListMetricsCommand } from '@aws-sdk/client-cloudwatch'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudwatchListMetricsContract } from '@/lib/api/contracts/tools/aws/cloudwatch-list-metrics'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudWatchListMetrics')

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
      const limit = validatedData.limit ?? 500

      const command = new ListMetricsCommand({
        ...(validatedData.namespace && { Namespace: validatedData.namespace }),
        ...(validatedData.metricName && { MetricName: validatedData.metricName }),
        ...(validatedData.recentlyActive && { RecentlyActive: 'PT3H' }),
      })

      const response = await client.send(command)

      const metrics = (response.Metrics ?? []).slice(0, limit).map((m) => ({
        namespace: m.Namespace ?? '',
        metricName: m.MetricName ?? '',
        dimensions: (m.Dimensions ?? []).map((d) => ({
          name: d.Name ?? '',
          value: d.Value ?? '',
        })),
      }))

      logger.info(`Successfully listed ${metrics.length} metrics`)

      return NextResponse.json({
        success: true,
        output: { metrics },
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
