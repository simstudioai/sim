import {
  type AlarmType,
  CloudWatchClient,
  DescribeAlarmsCommand,
  type StateValue,
} from '@aws-sdk/client-cloudwatch'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudWatchDescribeAlarms')

const DescribeAlarmsSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
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

    const client = new CloudWatchClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

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

    return NextResponse.json({
      success: true,
      output: { alarms: [...metricAlarms, ...compositeAlarms] },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to describe CloudWatch alarms'
    logger.error('DescribeAlarms failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
