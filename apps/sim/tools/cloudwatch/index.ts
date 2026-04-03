import { describeAlarmsTool } from './describe_alarms'
import { describeLogGroupsTool } from './describe_log_groups'
import { describeLogStreamsTool } from './describe_log_streams'
import { getLogEventsTool } from './get_log_events'
import { getMetricStatisticsTool } from './get_metric_statistics'
import { listMetricsTool } from './list_metrics'
import { queryLogsTool } from './query_logs'

export const cloudwatchDescribeAlarmsTool = describeAlarmsTool
export const cloudwatchDescribeLogGroupsTool = describeLogGroupsTool
export const cloudwatchDescribeLogStreamsTool = describeLogStreamsTool
export const cloudwatchGetLogEventsTool = getLogEventsTool
export const cloudwatchGetMetricStatisticsTool = getMetricStatisticsTool
export const cloudwatchListMetricsTool = listMetricsTool
export const cloudwatchQueryLogsTool = queryLogsTool
