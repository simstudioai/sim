import { CloudWatchClient, ListMetricsCommand } from '@aws-sdk/client-cloudwatch'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudWatchListMetrics')

const ListMetricsSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  namespace: z.string().optional(),
  metricName: z.string().optional(),
  recentlyActive: z.boolean().optional(),
  limit: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.number({ coerce: true }).int().positive().optional()
  ),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = ListMetricsSchema.parse(body)

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
    if (error instanceof z.ZodError) {
      logger.warn('Invalid request data', { errors: error.errors })
      return NextResponse.json(
        { error: error.errors[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }
    logger.error('ListMetrics failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to list CloudWatch metrics: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
