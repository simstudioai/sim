import {
  CloudWatchClient,
  PutMetricDataCommand,
  type StandardUnit,
} from '@aws-sdk/client-cloudwatch'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudWatchPutMetricData')

const VALID_UNITS = [
  'Seconds',
  'Microseconds',
  'Milliseconds',
  'Bytes',
  'Kilobytes',
  'Megabytes',
  'Gigabytes',
  'Terabytes',
  'Bits',
  'Kilobits',
  'Megabits',
  'Gigabits',
  'Terabits',
  'Percent',
  'Count',
  'Bytes/Second',
  'Kilobytes/Second',
  'Megabytes/Second',
  'Gigabytes/Second',
  'Terabytes/Second',
  'Bits/Second',
  'Kilobits/Second',
  'Megabits/Second',
  'Gigabits/Second',
  'Terabits/Second',
  'Count/Second',
  'None',
] as const

const PutMetricDataSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  namespace: z.string().min(1, 'Namespace is required'),
  metricName: z.string().min(1, 'Metric name is required'),
  value: z.number({ coerce: true }).refine((v) => Number.isFinite(v), {
    message: 'Metric value must be a finite number',
  }),
  unit: z.enum(VALID_UNITS).optional(),
  dimensions: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val) return true
        try {
          const parsed = JSON.parse(val)
          return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        } catch {
          return false
        }
      },
      { message: 'dimensions must be a valid JSON object string' }
    ),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = PutMetricDataSchema.parse(body)

    logger.info(`Publishing metric ${validatedData.namespace}/${validatedData.metricName}`)

    const client = new CloudWatchClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    try {
      const timestamp = new Date()

      const dimensions: { Name: string; Value: string }[] = []
      if (validatedData.dimensions) {
        const parsed = JSON.parse(validatedData.dimensions)
        for (const [name, value] of Object.entries(parsed)) {
          dimensions.push({ Name: name, Value: String(value) })
        }
      }

      const command = new PutMetricDataCommand({
        Namespace: validatedData.namespace,
        MetricData: [
          {
            MetricName: validatedData.metricName,
            Value: validatedData.value,
            Timestamp: timestamp,
            ...(validatedData.unit && { Unit: validatedData.unit as StandardUnit }),
            ...(dimensions.length > 0 && { Dimensions: dimensions }),
          },
        ],
      })

      await client.send(command)

      logger.info('Successfully published metric')

      return NextResponse.json({
        success: true,
        output: {
          success: true,
          namespace: validatedData.namespace,
          metricName: validatedData.metricName,
          value: validatedData.value,
          unit: validatedData.unit ?? 'None',
          timestamp: timestamp.toISOString(),
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
    logger.error('PutMetricData failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to publish CloudWatch metric: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
