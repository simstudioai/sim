import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudWatchGetMetricStatistics')

const GetMetricStatisticsSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  namespace: z.string().min(1, 'Namespace is required'),
  metricName: z.string().min(1, 'Metric name is required'),
  startTime: z.number({ coerce: true }).int(),
  endTime: z.number({ coerce: true }).int(),
  period: z.number({ coerce: true }).int().min(1),
  statistics: z.array(z.enum(['Average', 'Sum', 'Minimum', 'Maximum', 'SampleCount'])).min(1),
  dimensions: z.string().optional(),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = GetMetricStatisticsSchema.parse(body)

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
    if (error instanceof z.ZodError) {
      logger.warn('Invalid request data', { errors: error.errors })
      return NextResponse.json(
        { error: error.errors[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }
    logger.error('GetMetricStatistics failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to get CloudWatch metric statistics: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
