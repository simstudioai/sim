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
import type { DeliveryDeclaration } from '@/lib/core/http/classes'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudWatchPutMetricData')

/**
 * PutMetricData is additive, not last-write-wins: CloudWatch folds every
 * datapoint it receives for a (namespace, metric, dimensions, timestamp) tuple
 * into the same statistic set. Two deliveries of one user call therefore
 * publish `SampleCount=2, Sum=2 x value` instead of `SampleCount=1, Sum=value`,
 * silently doubling the customer's series and any alarm threshold read off it.
 * Nothing on the wire distinguishes this from a correct write, and the datapoint
 * cannot be retracted -- CloudWatch has no delete-datapoint API.
 */
const PUT_METRIC_DATA_DELIVERY = {
  deliveryClass: 'once',
  why: "the customer's metric series would double-count this datapoint, skewing every statistic and alarm derived from it",
  userVisibleEffect:
    'a datapoint with SampleCount=2 and Sum=2x the reported value, permanently, with no way to retract it',
} satisfies DeliveryDeclaration

/**
 * The AWS SDK's own retry layer replays a request whenever the transport fails
 * ambiguously (ECONNRESET, socket hangup, 500/502/503/504) -- exactly the cases
 * where the peer may already have committed. `@smithy/util-retry` defaults to
 * `DEFAULT_MAX_ATTEMPTS = 3`, so an unpinned client turns one severed socket
 * into three aggregated datapoints. Pinning to 1 trades a lost datapoint for a
 * correct series, which is the right trade for an additive metric: a gap is
 * visible and self-healing, a doubled value is neither.
 */
const NON_IDEMPOTENT_MAX_ATTEMPTS = 1

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
      maxAttempts: NON_IDEMPOTENT_MAX_ATTEMPTS,
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
    logger.error('PutMetricData failed', {
      error: toError(error).message,
      deliveryClass: PUT_METRIC_DATA_DELIVERY.deliveryClass,
      outcome: 'indeterminate',
      duplicateEffect: PUT_METRIC_DATA_DELIVERY.userVisibleEffect,
    })
    return NextResponse.json(
      { error: `Failed to publish CloudWatch metric: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
