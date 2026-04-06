import type { ToolResponse } from '@/tools/types'

export interface CloudWatchConnectionConfig {
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
  statistics: string[]
  dimensions?: string
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
    }[]
  }
}

export interface CloudWatchDescribeAlarmsParams extends CloudWatchConnectionConfig {
  alarmNamePrefix?: string
  stateValue?: string
  alarmType?: string
  limit?: number
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
    }[]
  }
}
