import { describeAlarmsTool } from '@/tools/cloudwatch/describe_alarms'
import { describeLogGroupsTool } from '@/tools/cloudwatch/describe_log_groups'
import { describeLogStreamsTool } from '@/tools/cloudwatch/describe_log_streams'
import { getLogEventsTool } from '@/tools/cloudwatch/get_log_events'
import { getMetricStatisticsTool } from '@/tools/cloudwatch/get_metric_statistics'
import { listMetricsTool } from '@/tools/cloudwatch/list_metrics'
import { queryLogsTool } from '@/tools/cloudwatch/query_logs'

export const cloudwatchDescribeAlarmsTool = describeAlarmsTool
export const cloudwatchDescribeLogGroupsTool = describeLogGroupsTool
export const cloudwatchDescribeLogStreamsTool = describeLogStreamsTool
export const cloudwatchGetLogEventsTool = getLogEventsTool
export const cloudwatchGetMetricStatisticsTool = getMetricStatisticsTool
export const cloudwatchListMetricsTool = listMetricsTool
export const cloudwatchQueryLogsTool = queryLogsTool
