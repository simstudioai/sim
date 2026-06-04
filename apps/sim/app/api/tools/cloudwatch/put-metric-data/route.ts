import {
  CloudWatchClient,
  PutMetricDataCommand,
  type StandardUnit,
} from '@aws-sdk/client-cloudwatch'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudwatchPutMetricDataContract } from '@/lib/api/contracts/tools/aws/cloudwatch-put-metric-data'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudWatchPutMetricData')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudwatchPutMetricDataContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

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
    logger.error('PutMetricData failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to publish CloudWatch metric: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
