import { CloudWatchIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type {
  CloudWatchDescribeAlarmsResponse,
  CloudWatchDescribeLogGroupsResponse,
  CloudWatchDescribeLogStreamsResponse,
  CloudWatchGetLogEventsResponse,
  CloudWatchGetMetricStatisticsResponse,
  CloudWatchListMetricsResponse,
  CloudWatchQueryLogsResponse,
} from '@/tools/cloudwatch/types'

export const CloudWatchBlock: BlockConfig<
  | CloudWatchQueryLogsResponse
  | CloudWatchDescribeLogGroupsResponse
  | CloudWatchDescribeLogStreamsResponse
  | CloudWatchGetLogEventsResponse
  | CloudWatchDescribeAlarmsResponse
  | CloudWatchListMetricsResponse
  | CloudWatchGetMetricStatisticsResponse
> = {
  type: 'cloudwatch',
  name: 'CloudWatch',
  description: 'Query and monitor AWS CloudWatch logs, metrics, and alarms',
  longDescription:
    'Integrate AWS CloudWatch into workflows. Run Log Insights queries, list log groups, retrieve log events, list and get metrics, and monitor alarms. Requires AWS access key and secret access key.',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  tags: ['cloud', 'monitoring'],
  bgColor: 'linear-gradient(45deg, #B0084D 0%, #FF4F8B 100%)',
  icon: CloudWatchIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Query Logs (Insights)', id: 'query_logs' },
        { label: 'Describe Log Groups', id: 'describe_log_groups' },
        { label: 'Get Log Events', id: 'get_log_events' },
        { label: 'Describe Log Streams', id: 'describe_log_streams' },
        { label: 'List Metrics', id: 'list_metrics' },
        { label: 'Get Metric Statistics', id: 'get_metric_statistics' },
        { label: 'Describe Alarms', id: 'describe_alarms' },
      ],
      value: () => 'query_logs',
    },
    {
      id: 'awsRegion',
      title: 'AWS Region',
      type: 'short-input',
      placeholder: 'us-east-1',
      required: true,
    },
    {
      id: 'awsAccessKeyId',
      title: 'AWS Access Key ID',
      type: 'short-input',
      placeholder: 'AKIA...',
      password: true,
      required: true,
    },
    {
      id: 'awsSecretAccessKey',
      title: 'AWS Secret Access Key',
      type: 'short-input',
      placeholder: 'Your secret access key',
      password: true,
      required: true,
    },
    // Query Logs fields
    {
      id: 'logGroupSelector',
      title: 'Log Group',
      type: 'file-selector',
      canonicalParamId: 'logGroupNames',
      selectorKey: 'cloudwatch.logGroups',
      dependsOn: ['awsAccessKeyId', 'awsSecretAccessKey', 'awsRegion'],
      placeholder: 'Select a log group',
      condition: { field: 'operation', value: 'query_logs' },
      required: { field: 'operation', value: 'query_logs' },
      mode: 'basic',
    },
    {
      id: 'logGroupNamesInput',
      title: 'Log Group Names',
      type: 'short-input',
      canonicalParamId: 'logGroupNames',
      placeholder: '/aws/lambda/my-func, /aws/ecs/my-service',
      condition: { field: 'operation', value: 'query_logs' },
      required: { field: 'operation', value: 'query_logs' },
      mode: 'advanced',
    },
    {
      id: 'queryString',
      title: 'Query',
      type: 'code',
      placeholder: 'fields @timestamp, @message\n| sort @timestamp desc\n| limit 20',
      condition: { field: 'operation', value: 'query_logs' },
      required: { field: 'operation', value: 'query_logs' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a CloudWatch Log Insights query based on the user's description.
The query language supports: fields, filter, stats, sort, limit, parse, display.
Common patterns:
- fields @timestamp, @message | sort @timestamp desc | limit 20
- filter @message like /ERROR/ | stats count(*) by bin(1h)
- stats avg(duration) as avgDuration by functionName | sort avgDuration desc
- filter @message like /Exception/ | parse @message "* Exception: *" as prefix, errorMsg
- stats count(*) as requestCount by status | sort requestCount desc

Return ONLY the query — no explanations, no markdown code blocks.`,
        placeholder: 'Describe what you want to find in the logs...',
      },
    },
    {
      id: 'startTime',
      title: 'Start Time (Unix epoch seconds)',
      type: 'short-input',
      placeholder: 'e.g., 1711900800',
      condition: {
        field: 'operation',
        value: ['query_logs', 'get_log_events', 'get_metric_statistics'],
      },
      required: { field: 'operation', value: ['query_logs', 'get_metric_statistics'] },
    },
    {
      id: 'endTime',
      title: 'End Time (Unix epoch seconds)',
      type: 'short-input',
      placeholder: 'e.g., 1711987200',
      condition: {
        field: 'operation',
        value: ['query_logs', 'get_log_events', 'get_metric_statistics'],
      },
      required: { field: 'operation', value: ['query_logs', 'get_metric_statistics'] },
    },
    // Describe Log Groups fields
    {
      id: 'prefix',
      title: 'Log Group Name Prefix',
      type: 'short-input',
      placeholder: '/aws/lambda/',
      condition: { field: 'operation', value: 'describe_log_groups' },
    },
    // Get Log Events / Describe Log Streams — shared log group selector
    {
      id: 'logGroupNameSelector',
      title: 'Log Group',
      type: 'file-selector',
      canonicalParamId: 'logGroupName',
      selectorKey: 'cloudwatch.logGroups',
      dependsOn: ['awsAccessKeyId', 'awsSecretAccessKey', 'awsRegion'],
      placeholder: 'Select a log group',
      condition: { field: 'operation', value: ['get_log_events', 'describe_log_streams'] },
      required: { field: 'operation', value: ['get_log_events', 'describe_log_streams'] },
      mode: 'basic',
    },
    {
      id: 'logGroupNameInput',
      title: 'Log Group Name',
      type: 'short-input',
      canonicalParamId: 'logGroupName',
      placeholder: '/aws/lambda/my-func',
      condition: { field: 'operation', value: ['get_log_events', 'describe_log_streams'] },
      required: { field: 'operation', value: ['get_log_events', 'describe_log_streams'] },
      mode: 'advanced',
    },
    // Describe Log Streams — stream prefix filter
    {
      id: 'streamPrefix',
      title: 'Stream Name Prefix',
      type: 'short-input',
      placeholder: '2024/03/31/',
      condition: { field: 'operation', value: 'describe_log_streams' },
    },
    // Get Log Events — log stream selector (cascading: depends on log group)
    {
      id: 'logStreamNameSelector',
      title: 'Log Stream',
      type: 'file-selector',
      canonicalParamId: 'logStreamName',
      selectorKey: 'cloudwatch.logStreams',
      dependsOn: ['awsAccessKeyId', 'awsSecretAccessKey', 'awsRegion', 'logGroupNameSelector'],
      placeholder: 'Select a log stream',
      condition: { field: 'operation', value: 'get_log_events' },
      required: { field: 'operation', value: 'get_log_events' },
      mode: 'basic',
    },
    {
      id: 'logStreamNameInput',
      title: 'Log Stream Name',
      type: 'short-input',
      canonicalParamId: 'logStreamName',
      placeholder: '2024/03/31/[$LATEST]abc123',
      condition: { field: 'operation', value: 'get_log_events' },
      required: { field: 'operation', value: 'get_log_events' },
      mode: 'advanced',
    },
    // List Metrics fields
    {
      id: 'metricNamespace',
      title: 'Namespace',
      type: 'short-input',
      placeholder: 'e.g., AWS/EC2, AWS/Lambda, AWS/RDS',
      condition: { field: 'operation', value: ['list_metrics', 'get_metric_statistics'] },
      required: { field: 'operation', value: 'get_metric_statistics' },
    },
    {
      id: 'metricName',
      title: 'Metric Name',
      type: 'short-input',
      placeholder: 'e.g., CPUUtilization, Invocations',
      condition: { field: 'operation', value: ['list_metrics', 'get_metric_statistics'] },
      required: { field: 'operation', value: 'get_metric_statistics' },
    },
    {
      id: 'recentlyActive',
      title: 'Recently Active Only',
      type: 'switch',
      condition: { field: 'operation', value: 'list_metrics' },
    },
    // Get Metric Statistics fields
    {
      id: 'metricPeriod',
      title: 'Period (seconds)',
      type: 'short-input',
      placeholder: 'e.g., 60, 300, 3600',
      condition: { field: 'operation', value: 'get_metric_statistics' },
      required: { field: 'operation', value: 'get_metric_statistics' },
    },
    {
      id: 'metricStatistics',
      title: 'Statistics',
      type: 'dropdown',
      options: [
        { label: 'Average', id: 'Average' },
        { label: 'Sum', id: 'Sum' },
        { label: 'Minimum', id: 'Minimum' },
        { label: 'Maximum', id: 'Maximum' },
        { label: 'Sample Count', id: 'SampleCount' },
      ],
      condition: { field: 'operation', value: 'get_metric_statistics' },
      required: { field: 'operation', value: 'get_metric_statistics' },
    },
    {
      id: 'metricDimensions',
      title: 'Dimensions',
      type: 'table',
      columns: ['name', 'value'],
      condition: { field: 'operation', value: 'get_metric_statistics' },
    },
    // Describe Alarms fields
    {
      id: 'alarmNamePrefix',
      title: 'Alarm Name Prefix',
      type: 'short-input',
      placeholder: 'my-service-',
      condition: { field: 'operation', value: 'describe_alarms' },
    },
    {
      id: 'stateValue',
      title: 'State',
      type: 'dropdown',
      options: [
        { label: 'All States', id: '' },
        { label: 'OK', id: 'OK' },
        { label: 'ALARM', id: 'ALARM' },
        { label: 'INSUFFICIENT_DATA', id: 'INSUFFICIENT_DATA' },
      ],
      condition: { field: 'operation', value: 'describe_alarms' },
    },
    {
      id: 'alarmType',
      title: 'Alarm Type',
      type: 'dropdown',
      options: [
        { label: 'All Types', id: '' },
        { label: 'Metric Alarm', id: 'MetricAlarm' },
        { label: 'Composite Alarm', id: 'CompositeAlarm' },
      ],
      condition: { field: 'operation', value: 'describe_alarms' },
    },
    // Shared limit field
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: [
          'query_logs',
          'describe_log_groups',
          'get_log_events',
          'describe_log_streams',
          'list_metrics',
          'describe_alarms',
        ],
      },
    },
  ],
  tools: {
    access: [
      'cloudwatch_query_logs',
      'cloudwatch_describe_log_groups',
      'cloudwatch_get_log_events',
      'cloudwatch_describe_log_streams',
      'cloudwatch_list_metrics',
      'cloudwatch_get_metric_statistics',
      'cloudwatch_describe_alarms',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'query_logs':
            return 'cloudwatch_query_logs'
          case 'describe_log_groups':
            return 'cloudwatch_describe_log_groups'
          case 'get_log_events':
            return 'cloudwatch_get_log_events'
          case 'describe_log_streams':
            return 'cloudwatch_describe_log_streams'
          case 'list_metrics':
            return 'cloudwatch_list_metrics'
          case 'get_metric_statistics':
            return 'cloudwatch_get_metric_statistics'
          case 'describe_alarms':
            return 'cloudwatch_describe_alarms'
          default:
            throw new Error(`Invalid CloudWatch operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, startTime, endTime, limit, ...rest } = params

        const awsRegion = rest.awsRegion
        const awsAccessKeyId = rest.awsAccessKeyId
        const awsSecretAccessKey = rest.awsSecretAccessKey
        const parsedLimit = limit ? Number.parseInt(String(limit), 10) : undefined

        switch (operation) {
          case 'query_logs': {
            const logGroupNames = rest.logGroupNames
            if (!logGroupNames) {
              throw new Error('Log group names are required')
            }
            if (!startTime) {
              throw new Error('Start time is required')
            }
            if (!endTime) {
              throw new Error('End time is required')
            }

            const groupNames =
              typeof logGroupNames === 'string'
                ? logGroupNames
                    .split(',')
                    .map((n: string) => n.trim())
                    .filter(Boolean)
                : logGroupNames

            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              logGroupNames: groupNames,
              queryString: rest.queryString,
              startTime: Number(startTime),
              endTime: Number(endTime),
              ...(parsedLimit !== undefined && { limit: parsedLimit }),
            }
          }

          case 'describe_log_groups':
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              ...(rest.prefix && { prefix: rest.prefix }),
              ...(parsedLimit !== undefined && { limit: parsedLimit }),
            }

          case 'get_log_events': {
            if (!rest.logGroupName) {
              throw new Error('Log group name is required')
            }
            if (!rest.logStreamName) {
              throw new Error('Log stream name is required')
            }

            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              logGroupName: rest.logGroupName,
              logStreamName: rest.logStreamName,
              ...(startTime && { startTime: Number(startTime) }),
              ...(endTime && { endTime: Number(endTime) }),
              ...(parsedLimit !== undefined && { limit: parsedLimit }),
            }
          }

          case 'describe_log_streams': {
            if (!rest.logGroupName) {
              throw new Error('Log group name is required')
            }

            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              logGroupName: rest.logGroupName,
              ...(rest.streamPrefix && { prefix: rest.streamPrefix }),
              ...(parsedLimit !== undefined && { limit: parsedLimit }),
            }
          }

          case 'list_metrics':
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              ...(rest.metricNamespace && { namespace: rest.metricNamespace }),
              ...(rest.metricName && { metricName: rest.metricName }),
              ...(rest.recentlyActive && { recentlyActive: true }),
              ...(parsedLimit !== undefined && { limit: parsedLimit }),
            }

          case 'get_metric_statistics': {
            if (!rest.metricNamespace) {
              throw new Error('Namespace is required')
            }
            if (!rest.metricName) {
              throw new Error('Metric name is required')
            }
            if (!startTime) {
              throw new Error('Start time is required')
            }
            if (!endTime) {
              throw new Error('End time is required')
            }
            if (!rest.metricPeriod) {
              throw new Error('Period is required')
            }

            const stat = rest.metricStatistics
            if (!stat) {
              throw new Error('Statistics is required')
            }

            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              namespace: rest.metricNamespace,
              metricName: rest.metricName,
              startTime: Number(startTime),
              endTime: Number(endTime),
              period: Number(rest.metricPeriod),
              statistics: Array.isArray(stat) ? stat : [stat],
              ...(rest.metricDimensions && {
                dimensions: (() => {
                  const dims = rest.metricDimensions
                  if (typeof dims === 'string') return dims
                  if (Array.isArray(dims)) {
                    const obj: Record<string, string> = {}
                    for (const row of dims) {
                      const name = row.cells?.name
                      const value = row.cells?.value
                      if (name && value !== undefined) obj[name] = String(value)
                    }
                    return JSON.stringify(obj)
                  }
                  return JSON.stringify(dims)
                })(),
              }),
            }
          }

          case 'describe_alarms':
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              ...(rest.alarmNamePrefix && { alarmNamePrefix: rest.alarmNamePrefix }),
              ...(rest.stateValue && { stateValue: rest.stateValue }),
              ...(rest.alarmType && { alarmType: rest.alarmType }),
              ...(parsedLimit !== undefined && { limit: parsedLimit }),
            }

          default:
            throw new Error(`Invalid CloudWatch operation: ${operation}`)
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'CloudWatch operation to perform' },
    awsRegion: { type: 'string', description: 'AWS region' },
    awsAccessKeyId: { type: 'string', description: 'AWS access key ID' },
    awsSecretAccessKey: { type: 'string', description: 'AWS secret access key' },
    logGroupNames: { type: 'string', description: 'Log group name(s) for query' },
    queryString: { type: 'string', description: 'CloudWatch Log Insights query string' },
    startTime: { type: 'string', description: 'Start time as Unix epoch seconds' },
    endTime: { type: 'string', description: 'End time as Unix epoch seconds' },
    prefix: { type: 'string', description: 'Log group name prefix filter' },
    logGroupName: {
      type: 'string',
      description: 'Log group name for get events / describe streams',
    },
    logStreamName: { type: 'string', description: 'Log stream name for get events' },
    streamPrefix: { type: 'string', description: 'Log stream name prefix filter' },
    metricNamespace: { type: 'string', description: 'Metric namespace (e.g., AWS/EC2)' },
    metricName: { type: 'string', description: 'Metric name (e.g., CPUUtilization)' },
    recentlyActive: { type: 'boolean', description: 'Only show recently active metrics' },
    metricPeriod: { type: 'number', description: 'Granularity in seconds' },
    metricStatistics: { type: 'string', description: 'Statistic type (Average, Sum, etc.)' },
    metricDimensions: { type: 'json', description: 'Metric dimensions (Name/Value pairs)' },
    alarmNamePrefix: { type: 'string', description: 'Alarm name prefix filter' },
    stateValue: {
      type: 'string',
      description: 'Alarm state filter (OK, ALARM, INSUFFICIENT_DATA)',
    },
    alarmType: { type: 'string', description: 'Alarm type filter (MetricAlarm, CompositeAlarm)' },
    limit: { type: 'number', description: 'Maximum number of results' },
  },
  outputs: {
    results: {
      type: 'array',
      description: 'Log Insights query result rows',
    },
    statistics: {
      type: 'json',
      description: 'Query statistics (bytesScanned, recordsMatched, recordsScanned)',
    },
    status: {
      type: 'string',
      description: 'Query completion status',
    },
    logGroups: {
      type: 'array',
      description: 'List of CloudWatch log groups',
    },
    events: {
      type: 'array',
      description: 'Log events with timestamp and message',
    },
    logStreams: {
      type: 'array',
      description: 'Log streams with metadata',
    },
    metrics: {
      type: 'array',
      description: 'List of available metrics',
    },
    label: {
      type: 'string',
      description: 'Metric label',
    },
    datapoints: {
      type: 'array',
      description: 'Metric datapoints with timestamps and values',
    },
    alarms: {
      type: 'array',
      description: 'CloudWatch alarms with state and configuration',
    },
  },
}
