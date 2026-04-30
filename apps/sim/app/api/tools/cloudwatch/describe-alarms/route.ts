import {
  type AlarmType,
  CloudWatchClient,
  DescribeAlarmsCommand,
  type StateValue,
} from '@aws-sdk/client-cloudwatch'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudwatchDescribeAlarmsContract } from '@/lib/api/contracts/tools/aws/cloudwatch-describe-alarms'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudWatchDescribeAlarms')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudwatchDescribeAlarmsContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

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
    logger.error('DescribeAlarms failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to describe CloudWatch alarms: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
