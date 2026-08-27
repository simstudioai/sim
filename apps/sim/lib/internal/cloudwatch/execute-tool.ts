import { toError } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import {
  cloudwatchLogGroupsSelectorContract,
  cloudwatchLogStreamsSelectorContract,
} from '@/lib/api/contracts/selectors/cloudwatch'
import { awsCloudwatchDescribeAlarmHistoryContract } from '@/lib/api/contracts/tools/aws/cloudwatch-describe-alarm-history'
import { awsCloudwatchDescribeAlarmsContract } from '@/lib/api/contracts/tools/aws/cloudwatch-describe-alarms'
import { awsCloudwatchFilterLogEventsContract } from '@/lib/api/contracts/tools/aws/cloudwatch-filter-log-events'
import { awsCloudwatchGetLogEventsContract } from '@/lib/api/contracts/tools/aws/cloudwatch-get-log-events'
import { awsCloudwatchGetMetricStatisticsContract } from '@/lib/api/contracts/tools/aws/cloudwatch-get-metric-statistics'
import { awsCloudwatchListMetricsContract } from '@/lib/api/contracts/tools/aws/cloudwatch-list-metrics'
import { awsCloudwatchMuteAlarmContract } from '@/lib/api/contracts/tools/aws/cloudwatch-mute-alarm'
import { awsCloudwatchPutLogGroupRetentionContract } from '@/lib/api/contracts/tools/aws/cloudwatch-put-log-group-retention'
import { awsCloudwatchPutMetricDataContract } from '@/lib/api/contracts/tools/aws/cloudwatch-put-metric-data'
import { awsCloudwatchQueryLogsContract } from '@/lib/api/contracts/tools/aws/cloudwatch-query-logs'
import { awsCloudwatchUnmuteAlarmContract } from '@/lib/api/contracts/tools/aws/cloudwatch-unmute-alarm'
import {
  CloudWatchInputError,
  executeCloudwatchDescribeAlarmHistory,
  executeCloudwatchDescribeAlarms,
  executeCloudwatchDescribeLogGroups,
  executeCloudwatchDescribeLogStreams,
  executeCloudwatchFilterLogEvents,
  executeCloudwatchGetLogEvents,
  executeCloudwatchGetMetricStatistics,
  executeCloudwatchListMetrics,
  executeCloudwatchMuteAlarm,
  executeCloudwatchPutLogGroupRetention,
  executeCloudwatchPutMetricData,
  executeCloudwatchQueryLogs,
  executeCloudwatchUnmuteAlarm,
} from '@/lib/internal/cloudwatch/operations'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown,
  execute: (input: ContractBody<C>, signal?: AbortSignal) => Promise<unknown>,
  errorMessage: string,
  signal?: AbortSignal
): Promise<Response> {
  const parsed = parseInternalToolInput(contract, input)
  if (!parsed.success) return parsed.response
  try {
    const result = await execute(parsed.data, signal)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof CloudWatchInputError) {
      return Response.json({ error: error.message }, { status: error.status })
    }
    return Response.json({ error: `${errorMessage}: ${toError(error).message}` }, { status: 500 })
  }
}

export const executeCloudwatchTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  signal,
}) => {
  signal?.throwIfAborted()
  switch (toolId) {
    case 'cloudwatch_describe_alarm_history':
      return executeOperation(
        awsCloudwatchDescribeAlarmHistoryContract,
        input,
        executeCloudwatchDescribeAlarmHistory,
        'Failed to describe CloudWatch alarm history',
        signal
      )
    case 'cloudwatch_describe_alarms':
      return executeOperation(
        awsCloudwatchDescribeAlarmsContract,
        input,
        executeCloudwatchDescribeAlarms,
        'Failed to describe CloudWatch alarms',
        signal
      )
    case 'cloudwatch_describe_log_groups':
      return executeOperation(
        cloudwatchLogGroupsSelectorContract,
        input,
        executeCloudwatchDescribeLogGroups,
        'Failed to describe CloudWatch log groups',
        signal
      )
    case 'cloudwatch_describe_log_streams':
      return executeOperation(
        cloudwatchLogStreamsSelectorContract,
        input,
        executeCloudwatchDescribeLogStreams,
        'Failed to describe CloudWatch log streams',
        signal
      )
    case 'cloudwatch_filter_log_events':
      return executeOperation(
        awsCloudwatchFilterLogEventsContract,
        input,
        executeCloudwatchFilterLogEvents,
        'Failed to filter CloudWatch log events',
        signal
      )
    case 'cloudwatch_get_log_events':
      return executeOperation(
        awsCloudwatchGetLogEventsContract,
        input,
        executeCloudwatchGetLogEvents,
        'Failed to get CloudWatch log events',
        signal
      )
    case 'cloudwatch_get_metric_statistics':
      return executeOperation(
        awsCloudwatchGetMetricStatisticsContract,
        input,
        executeCloudwatchGetMetricStatistics,
        'Failed to get CloudWatch metric statistics',
        signal
      )
    case 'cloudwatch_list_metrics':
      return executeOperation(
        awsCloudwatchListMetricsContract,
        input,
        executeCloudwatchListMetrics,
        'Failed to list CloudWatch metrics',
        signal
      )
    case 'cloudwatch_mute_alarm':
      return executeOperation(
        awsCloudwatchMuteAlarmContract,
        input,
        executeCloudwatchMuteAlarm,
        'Failed to create CloudWatch alarm mute rule',
        signal
      )
    case 'cloudwatch_put_log_group_retention':
      return executeOperation(
        awsCloudwatchPutLogGroupRetentionContract,
        input,
        executeCloudwatchPutLogGroupRetention,
        'Failed to set CloudWatch log group retention',
        signal
      )
    case 'cloudwatch_put_metric_data':
      return executeOperation(
        awsCloudwatchPutMetricDataContract,
        input,
        executeCloudwatchPutMetricData,
        'Failed to publish CloudWatch metric',
        signal
      )
    case 'cloudwatch_query_logs':
      return executeOperation(
        awsCloudwatchQueryLogsContract,
        input,
        executeCloudwatchQueryLogs,
        'CloudWatch Log Insights query failed',
        signal
      )
    case 'cloudwatch_unmute_alarm':
      return executeOperation(
        awsCloudwatchUnmuteAlarmContract,
        input,
        executeCloudwatchUnmuteAlarm,
        'Failed to delete CloudWatch alarm mute rule',
        signal
      )
    default:
      return Response.json({ error: `Unsupported CloudWatch tool: ${toolId}` }, { status: 500 })
  }
}
