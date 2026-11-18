import type { ToolResponse } from '@/tools/types'

interface CloudWatchConnectionConfig {
  awsRegion: string
  awsAccessKeyId: string
  awsSecretAccessKey: string
}

export interface CloudWatchQueryLogsParams extends CloudWatchConnectionConfig {
  logGroupNames: string[]
  queryString: string
  startTime: number
  endTime: number
  limit?: number
}

export interface CloudWatchDescribeLogGroupsParams extends CloudWatchConnectionConfig {
  prefix?: string
  limit?: number
}

export interface CloudWatchGetLogEventsParams extends CloudWatchConnectionConfig {
  logGroupName: string
  logStreamName: string
  startTime?: number
  endTime?: number
  limit?: number
  nextToken?: string
}

export interface CloudWatchQueryLogsResponse extends ToolResponse {
  output: {
    results: Record<string, string>[]
    statistics: {
      bytesScanned: number
      recordsMatched: number
      recordsScanned: number
    }
    status: string
    queryId?: string | null
  }
}

export interface CloudWatchDescribeLogGroupsResponse extends ToolResponse {
  output: {
    logGroups: {
      logGroupName: string
      arn: string
      storedBytes: number
      retentionInDays: number | undefined
      creationTime: number | undefined
    }[]
  }
}

export interface CloudWatchGetLogEventsResponse extends ToolResponse {
  output: {
    events: {
      timestamp: number | undefined
      message: string | undefined
      ingestionTime: number | undefined
    }[]
    nextForwardToken?: string | null
    nextBackwardToken?: string | null
  }
}

export interface CloudWatchDescribeLogStreamsParams extends CloudWatchConnectionConfig {
  logGroupName: string
  prefix?: string
  limit?: number
}

export interface CloudWatchDescribeLogStreamsResponse extends ToolResponse {
  output: {
    logStreams: {
      logStreamName: string
      lastEventTimestamp: number | undefined
      firstEventTimestamp: number | undefined
      creationTime: number | undefined
      storedBytes: number
    }[]
  }
}

export interface CloudWatchListMetricsParams extends CloudWatchConnectionConfig {
  namespace?: string
  metricName?: string
  recentlyActive?: boolean
  limit?: number
}

export interface CloudWatchListMetricsResponse extends ToolResponse {
  output: {
    metrics: {
      namespace: string
      metricName: string
      dimensions: { name: string; value: string }[]
    }[]
  }
}

export interface CloudWatchGetMetricStatisticsParams extends CloudWatchConnectionConfig {
  namespace: string
  metricName: string
  startTime: number
  endTime: number
  period: number
  statistics?: string[]
  dimensions?: string
  extendedStatistics?: string[]
  unit?: string
}

export interface CloudWatchGetMetricStatisticsResponse extends ToolResponse {
  output: {
    label: string
    datapoints: {
      timestamp: number
      average?: number
      sum?: number
      minimum?: number
      maximum?: number
      sampleCount?: number
      unit?: string
      extendedStatistics?: Record<string, number>
    }[]
  }
}

export interface CloudWatchDescribeAlarmsParams extends CloudWatchConnectionConfig {
  alarmNamePrefix?: string
  stateValue?: string
  alarmType?: string
  limit?: number
  nextToken?: string
}

export interface CloudWatchDescribeAlarmsResponse extends ToolResponse {
  output: {
    alarms: {
      alarmName: string
      alarmArn: string
      stateValue: string
      stateReason: string
      metricName: string | undefined
      namespace: string | undefined
      comparisonOperator: string | undefined
      threshold: number | undefined
      evaluationPeriods: number | undefined
      stateUpdatedTimestamp: number | undefined
      alarmType?: string
      alarmDescription?: string
      actionsEnabled?: boolean
      alarmActions?: string[]
      okActions?: string[]
      insufficientDataActions?: string[]
      stateReasonData?: string
      stateTransitionedTimestamp?: number
      alarmConfigurationUpdatedTimestamp?: number
      statistic?: string
      extendedStatistic?: string
      dimensions?: { name: string; value: string }[]
      period?: number
      unit?: string
      datapointsToAlarm?: number
      treatMissingData?: string
      thresholdMetricId?: string
      metrics?: Record<string, unknown>[]
      alarmRule?: string
    }[]
    nextToken?: string | null
  }
}

export interface CloudWatchPutMetricDataParams extends CloudWatchConnectionConfig {
  namespace: string
  metricName: string
  value: number
  unit?: string
  dimensions?: string
}

export interface CloudWatchPutMetricDataResponse extends ToolResponse {
  output: {
    success: boolean
    namespace: string
    metricName: string
    value: number
    unit: string
    timestamp: string
  }
}

type CloudWatchMuteDurationUnit = 'minutes' | 'hours' | 'days'

export interface CloudWatchMuteAlarmParams extends CloudWatchConnectionConfig {
  muteRuleName: string
  alarmNames: string[]
  durationValue: number
  durationUnit: CloudWatchMuteDurationUnit
  description?: string
  startDate?: number
}

export interface CloudWatchMuteAlarmResponse extends ToolResponse {
  output: {
    success: boolean
    muteRuleName: string
    alarmNames: string[]
    expression: string
    duration: string
  }
}

export interface CloudWatchUnmuteAlarmParams extends CloudWatchConnectionConfig {
  muteRuleName: string
}

export interface CloudWatchUnmuteAlarmResponse extends ToolResponse {
  output: {
    success: boolean
    muteRuleName: string
  }
}

type CloudWatchAlarmHistoryItemType =
  | 'ConfigurationUpdate'
  | 'StateUpdate'
  | 'Action'
  | 'AlarmContributorStateUpdate'
  | 'AlarmContributorAction'

type CloudWatchAlarmHistoryScanBy = 'TimestampDescending' | 'TimestampAscending'

export interface CloudWatchDescribeAlarmHistoryParams extends CloudWatchConnectionConfig {
  alarmName?: string
  historyItemType?: CloudWatchAlarmHistoryItemType
  startDate?: number
  endDate?: number
  scanBy?: CloudWatchAlarmHistoryScanBy
  limit?: number
}

export interface CloudWatchDescribeAlarmHistoryResponse extends ToolResponse {
  output: {
    alarmHistoryItems: {
      alarmName: string | undefined
      alarmType: string | undefined
      timestamp: number | undefined
      historyItemType: string | undefined
      historySummary: string | undefined
      historyData?: string
      alarmContributorId?: string
    }[]
  }
}

export interface CloudWatchFilterLogEventsParams extends CloudWatchConnectionConfig {
  logGroupName: string
  filterPattern?: string
  logStreamNamePrefix?: string
  startTime?: number
  endTime?: number
  startFromHead?: boolean
  limit?: number
  nextToken?: string
}

export interface CloudWatchFilterLogEventsResponse extends ToolResponse {
  output: {
    events: {
      logStreamName: string | undefined
      timestamp: number | undefined
      message: string | undefined
      ingestionTime: number | undefined
      eventId?: string
    }[]
    nextToken?: string | null
  }
}

export interface CloudWatchPutLogGroupRetentionParams extends CloudWatchConnectionConfig {
  logGroupName: string
  retentionInDays?: number
}

export interface CloudWatchPutLogGroupRetentionResponse extends ToolResponse {
  output: {
    success: boolean
    logGroupName: string
    retentionInDays: number | null
  }
}
