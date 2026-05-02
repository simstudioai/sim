import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudwatchGetMetricStatisticsContract } from '@/lib/api/contracts/tools/aws/cloudwatch-get-metric-statistics'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudWatchGetMetricStatistics')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudwatchGetMetricStatisticsContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(
      `Getting metric statistics for ${validatedData.namespace}/${validatedData.metricName}`
    )

    const client = new CloudWatchClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    try {
      let parsedDimensions: { Name: string; Value: string }[] | undefined
      if (validatedData.dimensions) {
        try {
          const dims = JSON.parse(validatedData.dimensions)
          if (Array.isArray(dims)) {
            parsedDimensions = dims.map((d: Record<string, string>) => ({
              Name: d.name,
              Value: d.value,
            }))
          } else if (typeof dims === 'object') {
            parsedDimensions = Object.entries(dims).map(([name, value]) => ({
              Name: name,
              Value: String(value),
            }))
          }
        } catch {
          return NextResponse.json({ error: 'Invalid dimensions JSON format' }, { status: 400 })
        }
      }

      const command = new GetMetricStatisticsCommand({
        Namespace: validatedData.namespace,
        MetricName: validatedData.metricName,
        StartTime: new Date(validatedData.startTime * 1000),
        EndTime: new Date(validatedData.endTime * 1000),
        Period: validatedData.period,
        Statistics: validatedData.statistics,
        ...(parsedDimensions && { Dimensions: parsedDimensions }),
      })

      const response = await client.send(command)

      const datapoints = (response.Datapoints ?? [])
        .sort((a, b) => (a.Timestamp?.getTime() ?? 0) - (b.Timestamp?.getTime() ?? 0))
        .map((dp) => ({
          timestamp: dp.Timestamp ? dp.Timestamp.getTime() : 0,
          average: dp.Average,
          sum: dp.Sum,
          minimum: dp.Minimum,
          maximum: dp.Maximum,
          sampleCount: dp.SampleCount,
          unit: dp.Unit,
        }))

      logger.info(`Successfully retrieved ${datapoints.length} datapoints`)

      return NextResponse.json({
        success: true,
        output: {
          label: response.Label ?? validatedData.metricName,
          datapoints,
        },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('GetMetricStatistics failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to get CloudWatch metric statistics: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
