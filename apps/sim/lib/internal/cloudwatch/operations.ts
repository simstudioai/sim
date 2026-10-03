import {
  type AlarmType,
  DeleteAlarmMuteRuleCommand,
  DescribeAlarmHistoryCommand,
  DescribeAlarmsCommand,
  GetMetricStatisticsCommand,
  ListMetricsCommand,
  PutAlarmMuteRuleCommand,
  PutMetricDataCommand,
  type StandardUnit,
  type StateValue,
} from '@aws-sdk/client-cloudwatch'
import {
  DeleteRetentionPolicyCommand,
  PutRetentionPolicyCommand,
  StartQueryCommand,
} from '@aws-sdk/client-cloudwatch-logs'
import { createLogger } from '@sim/logger'
import type { AwsCloudwatchDescribeAlarmHistoryBody } from '@/lib/api/contracts/tools/aws/cloudwatch-describe-alarm-history'
import type { AwsCloudwatchDescribeAlarmsBody } from '@/lib/api/contracts/tools/aws/cloudwatch-describe-alarms'
import type { AwsCloudwatchFilterLogEventsBody } from '@/lib/api/contracts/tools/aws/cloudwatch-filter-log-events'
import type { AwsCloudwatchGetLogEventsBody } from '@/lib/api/contracts/tools/aws/cloudwatch-get-log-events'
import type { AwsCloudwatchGetMetricStatisticsBody } from '@/lib/api/contracts/tools/aws/cloudwatch-get-metric-statistics'
import type { AwsCloudwatchListMetricsBody } from '@/lib/api/contracts/tools/aws/cloudwatch-list-metrics'
import type { AwsCloudwatchMuteAlarmBody } from '@/lib/api/contracts/tools/aws/cloudwatch-mute-alarm'
import type { AwsCloudwatchPutLogGroupRetentionBody } from '@/lib/api/contracts/tools/aws/cloudwatch-put-log-group-retention'
import type { AwsCloudwatchPutMetricDataBody } from '@/lib/api/contracts/tools/aws/cloudwatch-put-metric-data'
import type { AwsCloudwatchQueryLogsBody } from '@/lib/api/contracts/tools/aws/cloudwatch-query-logs'
import type { AwsCloudwatchUnmuteAlarmBody } from '@/lib/api/contracts/tools/aws/cloudwatch-unmute-alarm'
import type {
  CloudwatchLogGroupsBody,
  CloudwatchLogStreamsBody,
} from '@/lib/api/contracts/tools/cloudwatch'
import {
  createCloudWatchClient,
  createCloudWatchLogsClient,
  filterLogEvents,
  getLogEvents,
  pollQueryResults,
} from '@/lib/internal/cloudwatch/client'
import { listCloudWatchLogGroups, listCloudWatchLogStreams } from '@/tools/cloudwatch/listing'

const logger = createLogger('CloudWatchOperations')
const ALARM_HISTORY_PAGE_SIZE = 100
const MAX_ALARM_HISTORY_PAGES = 20
const METRICS_PAGE_SIZE = 500
const MAX_METRICS_PAGES = 20
const NON_IDEMPOTENT_MAX_ATTEMPTS = 1

export class CloudWatchInputError extends Error {
  readonly status = 400
}

export async function executeCloudwatchDescribeAlarmHistory(
  input: AwsCloudwatchDescribeAlarmHistoryBody,
  signal?: AbortSignal
) {
  const client = createCloudWatchClient(input)
  try {
    const items: {
      alarmName: string | undefined
      alarmType: string | undefined
      timestamp: number | undefined
      historyItemType: string | undefined
      historySummary: string | undefined
    }[] = []
    let nextToken: string | undefined

    for (let page = 0; page < MAX_ALARM_HISTORY_PAGES; page++) {
      const pageLimit =
        input.limit !== undefined
          ? Math.min(ALARM_HISTORY_PAGE_SIZE, input.limit - items.length)
          : ALARM_HISTORY_PAGE_SIZE
      const response = await client.send(
        new DescribeAlarmHistoryCommand({
          ...(input.alarmName && { AlarmName: input.alarmName }),
          AlarmTypes: ['MetricAlarm', 'CompositeAlarm'] as AlarmType[],
          ...(input.historyItemType && { HistoryItemType: input.historyItemType }),
          ...(input.startDate !== undefined && { StartDate: new Date(input.startDate * 1000) }),
          ...(input.endDate !== undefined && { EndDate: new Date(input.endDate * 1000) }),
          ScanBy: input.scanBy ?? 'TimestampDescending',
          MaxRecords: pageLimit,
          ...(nextToken && { NextToken: nextToken }),
        }),
        { abortSignal: signal }
      )

      for (const item of response.AlarmHistoryItems ?? []) {
        items.push({
          alarmName: item.AlarmName,
          alarmType: item.AlarmType,
          timestamp: item.Timestamp?.getTime(),
          historyItemType: item.HistoryItemType,
          historySummary: item.HistorySummary,
        })
      }
      nextToken = response.NextToken
      if (!nextToken || (input.limit !== undefined && items.length >= input.limit)) break
      if (page === MAX_ALARM_HISTORY_PAGES - 1) {
        logger.warn(
          `DescribeAlarmHistory hit pagination cap of ${MAX_ALARM_HISTORY_PAGES} pages; history may be incomplete`
        )
      }
    }

    return {
      success: true,
      output: {
        alarmHistoryItems: input.limit !== undefined ? items.slice(0, input.limit) : items,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeCloudwatchDescribeAlarms(
  input: AwsCloudwatchDescribeAlarmsBody,
  signal?: AbortSignal
) {
  const client = createCloudWatchClient(input)
  try {
    const response = await client.send(
      new DescribeAlarmsCommand({
        ...(input.alarmNamePrefix && { AlarmNamePrefix: input.alarmNamePrefix }),
        ...(input.stateValue && { StateValue: input.stateValue as StateValue }),
        AlarmTypes: input.alarmType
          ? [input.alarmType as AlarmType]
          : (['MetricAlarm', 'CompositeAlarm'] as AlarmType[]),
        ...(input.limit !== undefined && { MaxRecords: input.limit }),
      }),
      { abortSignal: signal }
    )
    const metricAlarms = (response.MetricAlarms ?? []).map((alarm) => ({
      alarmName: alarm.AlarmName ?? '',
      alarmArn: alarm.AlarmArn ?? '',
      stateValue: alarm.StateValue ?? 'UNKNOWN',
      stateReason: alarm.StateReason ?? '',
      metricName: alarm.MetricName,
      namespace: alarm.Namespace,
      comparisonOperator: alarm.ComparisonOperator,
      threshold: alarm.Threshold,
      evaluationPeriods: alarm.EvaluationPeriods,
      stateUpdatedTimestamp: alarm.StateUpdatedTimestamp?.getTime(),
    }))
    const compositeAlarms = (response.CompositeAlarms ?? []).map((alarm) => ({
      alarmName: alarm.AlarmName ?? '',
      alarmArn: alarm.AlarmArn ?? '',
      stateValue: alarm.StateValue ?? 'UNKNOWN',
      stateReason: alarm.StateReason ?? '',
      metricName: undefined,
      namespace: undefined,
      comparisonOperator: undefined,
      threshold: undefined,
      evaluationPeriods: undefined,
      stateUpdatedTimestamp: alarm.StateUpdatedTimestamp?.getTime(),
    }))
    return { success: true, output: { alarms: [...metricAlarms, ...compositeAlarms] } }
  } finally {
    client.destroy()
  }
}

export async function executeCloudwatchDescribeLogGroups(
  input: CloudwatchLogGroupsBody,
  signal?: AbortSignal
) {
  const { items: logGroups } = await listCloudWatchLogGroups({
    credentials: input,
    prefix: input.prefix,
    limit: input.limit,
    signal,
  })
  return { success: true, output: { logGroups } }
}

export async function executeCloudwatchDescribeLogStreams(
  input: CloudwatchLogStreamsBody,
  signal?: AbortSignal
) {
  const { items: logStreams } = await listCloudWatchLogStreams({
    credentials: input,
    logGroupName: input.logGroupName,
    prefix: input.prefix,
    limit: input.limit,
    signal,
  })
  return { success: true, output: { logStreams } }
}

export async function executeCloudwatchFilterLogEvents(
  input: AwsCloudwatchFilterLogEventsBody,
  signal?: AbortSignal
) {
  const client = createCloudWatchLogsClient(input)
  try {
    const result = await filterLogEvents(
      client,
      input.logGroupName,
      {
        filterPattern: input.filterPattern,
        logStreamNamePrefix: input.logStreamNamePrefix,
        startTime: input.startTime !== undefined ? input.startTime * 1000 : undefined,
        endTime: input.endTime !== undefined ? input.endTime * 1000 : undefined,
        startFromHead: input.startFromHead,
        limit: input.limit,
      },
      signal
    )
    return { success: true, output: { events: result.events } }
  } finally {
    client.destroy()
  }
}

export async function executeCloudwatchGetLogEvents(
  input: AwsCloudwatchGetLogEventsBody,
  signal?: AbortSignal
) {
  const client = createCloudWatchLogsClient(input)
  try {
    const result = await getLogEvents(
      client,
      input.logGroupName,
      input.logStreamName,
      { startTime: input.startTime, endTime: input.endTime, limit: input.limit },
      signal
    )
    return { success: true, output: { events: result.events } }
  } finally {
    client.destroy()
  }
}

export async function executeCloudwatchGetMetricStatistics(
  input: AwsCloudwatchGetMetricStatisticsBody,
  signal?: AbortSignal
) {
  let dimensions: { Name: string; Value: string }[] | undefined
  if (input.dimensions) {
    try {
      const parsed: unknown = JSON.parse(input.dimensions)
      if (Array.isArray(parsed)) {
        dimensions = parsed.map((dimension: Record<string, string>) => ({
          Name: dimension.name,
          Value: dimension.value,
        }))
      } else if (typeof parsed === 'object' && parsed !== null) {
        dimensions = Object.entries(parsed).map(([name, value]) => ({
          Name: name,
          Value: String(value),
        }))
      }
    } catch {
      throw new CloudWatchInputError('Invalid dimensions JSON format')
    }
  }

  const client = createCloudWatchClient(input)
  try {
    const response = await client.send(
      new GetMetricStatisticsCommand({
        Namespace: input.namespace,
        MetricName: input.metricName,
        StartTime: new Date(input.startTime * 1000),
        EndTime: new Date(input.endTime * 1000),
        Period: input.period,
        Statistics: input.statistics,
        ...(dimensions && { Dimensions: dimensions }),
      }),
      { abortSignal: signal }
    )
    const datapoints = (response.Datapoints ?? [])
      .sort((a, b) => (a.Timestamp?.getTime() ?? 0) - (b.Timestamp?.getTime() ?? 0))
      .map((datapoint) => ({
        timestamp: datapoint.Timestamp?.getTime() ?? 0,
        average: datapoint.Average,
        sum: datapoint.Sum,
        minimum: datapoint.Minimum,
        maximum: datapoint.Maximum,
        sampleCount: datapoint.SampleCount,
        unit: datapoint.Unit,
      }))
    return {
      success: true,
      output: { label: response.Label ?? input.metricName, datapoints },
    }
  } finally {
    client.destroy()
  }
}

export async function executeCloudwatchListMetrics(
  input: AwsCloudwatchListMetricsBody,
  signal?: AbortSignal
) {
  const client = createCloudWatchClient(input)
  try {
    const totalLimit = input.limit ?? METRICS_PAGE_SIZE
    const metrics: {
      namespace: string
      metricName: string
      dimensions: { name: string; value: string }[]
    }[] = []
    let nextToken: string | undefined
    for (let page = 0; page < MAX_METRICS_PAGES; page++) {
      const response = await client.send(
        new ListMetricsCommand({
          ...(input.namespace && { Namespace: input.namespace }),
          ...(input.metricName && { MetricName: input.metricName }),
          ...(input.recentlyActive && { RecentlyActive: 'PT3H' }),
          ...(nextToken && { NextToken: nextToken }),
        }),
        { abortSignal: signal }
      )
      for (const metric of response.Metrics ?? []) {
        metrics.push({
          namespace: metric.Namespace ?? '',
          metricName: metric.MetricName ?? '',
          dimensions: (metric.Dimensions ?? []).map((dimension) => ({
            name: dimension.Name ?? '',
            value: dimension.Value ?? '',
          })),
        })
      }
      nextToken = response.NextToken
      if (!nextToken || metrics.length >= totalLimit) break
      if (page === MAX_METRICS_PAGES - 1) {
        logger.warn(
          `ListMetrics hit pagination cap of ${MAX_METRICS_PAGES} pages; metric list may be incomplete`
        )
      }
    }
    return { success: true, output: { metrics: metrics.slice(0, totalLimit) } }
  } finally {
    client.destroy()
  }
}

function toAtExpression(date: Date): string {
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const min = String(date.getUTCMinutes()).padStart(2, '0')
  return `at(${yyyy}-${mm}-${dd}T${hh}:${min})`
}

function toIsoDuration(value: number, unit: 'minutes' | 'hours' | 'days'): string {
  if (unit === 'minutes') return `PT${value}M`
  if (unit === 'hours') return `PT${value}H`
  return `P${value}D`
}

export async function executeCloudwatchMuteAlarm(
  input: AwsCloudwatchMuteAlarmBody,
  signal?: AbortSignal
) {
  const startDate = input.startDate !== undefined ? new Date(input.startDate * 1000) : new Date()
  const expression = toAtExpression(startDate)
  const duration = toIsoDuration(input.durationValue, input.durationUnit)
  const client = createCloudWatchClient(input)
  try {
    await client.send(
      new PutAlarmMuteRuleCommand({
        Name: input.muteRuleName,
        ...(input.description && { Description: input.description }),
        Rule: { Schedule: { Expression: expression, Duration: duration } },
        MuteTargets: { AlarmNames: input.alarmNames },
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        success: true,
        muteRuleName: input.muteRuleName,
        alarmNames: input.alarmNames,
        expression,
        duration,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeCloudwatchPutLogGroupRetention(
  input: AwsCloudwatchPutLogGroupRetentionBody,
  signal?: AbortSignal
) {
  const client = createCloudWatchLogsClient(input)
  try {
    if (input.retentionInDays !== undefined) {
      await client.send(
        new PutRetentionPolicyCommand({
          logGroupName: input.logGroupName,
          retentionInDays: input.retentionInDays,
        }),
        { abortSignal: signal }
      )
    } else {
      await client.send(new DeleteRetentionPolicyCommand({ logGroupName: input.logGroupName }), {
        abortSignal: signal,
      })
    }
    return {
      success: true,
      output: {
        success: true,
        logGroupName: input.logGroupName,
        retentionInDays: input.retentionInDays ?? null,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeCloudwatchPutMetricData(
  input: AwsCloudwatchPutMetricDataBody,
  signal?: AbortSignal
) {
  const client = createCloudWatchClient(input, { maxAttempts: NON_IDEMPOTENT_MAX_ATTEMPTS })
  try {
    const timestamp = new Date()
    const dimensions: { Name: string; Value: string }[] = []
    if (input.dimensions) {
      const parsed = JSON.parse(input.dimensions) as Record<string, unknown>
      for (const [name, value] of Object.entries(parsed)) {
        dimensions.push({ Name: name, Value: String(value) })
      }
    }
    await client.send(
      new PutMetricDataCommand({
        Namespace: input.namespace,
        MetricData: [
          {
            MetricName: input.metricName,
            Value: input.value,
            Timestamp: timestamp,
            ...(input.unit && { Unit: input.unit as StandardUnit }),
            ...(dimensions.length > 0 && { Dimensions: dimensions }),
          },
        ],
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        success: true,
        namespace: input.namespace,
        metricName: input.metricName,
        value: input.value,
        unit: input.unit ?? 'None',
        timestamp: timestamp.toISOString(),
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeCloudwatchQueryLogs(
  input: AwsCloudwatchQueryLogsBody,
  signal?: AbortSignal
) {
  const client = createCloudWatchLogsClient(input)
  try {
    const response = await client.send(
      new StartQueryCommand({
        logGroupNames: input.logGroupNames,
        queryString: input.queryString,
        startTime: input.startTime,
        endTime: input.endTime,
        ...(input.limit !== undefined && { limit: input.limit }),
      }),
      { abortSignal: signal }
    )
    if (!response.queryId) {
      throw new Error('Failed to start CloudWatch Log Insights query: no queryId returned')
    }
    const result = await pollQueryResults(client, response.queryId, {}, signal)
    return {
      success: true,
      output: {
        results: result.results,
        statistics: result.statistics,
        status: result.status,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeCloudwatchUnmuteAlarm(
  input: AwsCloudwatchUnmuteAlarmBody,
  signal?: AbortSignal
) {
  const client = createCloudWatchClient(input)
  try {
    await client.send(new DeleteAlarmMuteRuleCommand({ AlarmMuteRuleName: input.muteRuleName }), {
      abortSignal: signal,
    })
    return {
      success: true,
      output: { success: true, muteRuleName: input.muteRuleName },
    }
  } finally {
    client.destroy()
  }
}
