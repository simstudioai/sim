import {
  type AlarmType,
  CloudWatchClient,
  DescribeAlarmsCommand,
  type StateValue,
} from '@aws-sdk/client-cloudwatch'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateAwsRegion } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudWatchDescribeAlarms')

const DescribeAlarmsSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  alarmNamePrefix: z.string().optional(),
  stateValue: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['OK', 'ALARM', 'INSUFFICIENT_DATA']).optional()
  ),
  alarmType: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['MetricAlarm', 'CompositeAlarm']).optional()
  ),
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
    const validatedData = DescribeAlarmsSchema.parse(body)

    logger.info('Describing CloudWatch alarms')

    const client = new CloudWatchClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    try {
      const command = new DescribeAlarmsCommand({
        ...(validatedData.alarmNamePrefix && { AlarmNamePrefix: validatedData.alarmNamePrefix }),
        ...(validatedData.stateValue && { StateValue: validatedData.stateValue as StateValue }),
        AlarmTypes: validatedData.alarmType
          ? [validatedData.alarmType as AlarmType]
          : (['MetricAlarm', 'CompositeAlarm'] as AlarmType[]),
        ...(validatedData.limit !== undefined && { MaxRecords: validatedData.limit }),
      })

      const response = await client.send(command)

      const metricAlarms = (response.MetricAlarms ?? []).map((a) => ({
        alarmName: a.AlarmName ?? '',
        alarmArn: a.AlarmArn ?? '',
        stateValue: a.StateValue ?? 'UNKNOWN',
        stateReason: a.StateReason ?? '',
        metricName: a.MetricName,
        namespace: a.Namespace,
        comparisonOperator: a.ComparisonOperator,
        threshold: a.Threshold,
        evaluationPeriods: a.EvaluationPeriods,
        stateUpdatedTimestamp: a.StateUpdatedTimestamp?.getTime(),
      }))

      const compositeAlarms = (response.CompositeAlarms ?? []).map((a) => ({
        alarmName: a.AlarmName ?? '',
        alarmArn: a.AlarmArn ?? '',
        stateValue: a.StateValue ?? 'UNKNOWN',
        stateReason: a.StateReason ?? '',
        metricName: undefined,
        namespace: undefined,
        comparisonOperator: undefined,
        threshold: undefined,
        evaluationPeriods: undefined,
        stateUpdatedTimestamp: a.StateUpdatedTimestamp?.getTime(),
      }))

      const alarms = [...metricAlarms, ...compositeAlarms]

      logger.info(`Successfully described ${alarms.length} alarms`)

      return NextResponse.json({
        success: true,
        output: { alarms },
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
    logger.error('DescribeAlarms failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to describe CloudWatch alarms: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
