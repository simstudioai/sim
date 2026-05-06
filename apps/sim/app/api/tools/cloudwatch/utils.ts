import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  GetLogEventsCommand,
  GetQueryResultsCommand,
  type ResultField,
} from '@aws-sdk/client-cloudwatch-logs'
import { sleep } from '@sim/utils/helpers'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/core/execution-limits'

interface AwsCredentials {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export function createCloudWatchLogsClient(config: AwsCredentials): CloudWatchLogsClient {
  return new CloudWatchLogsClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

interface PollOptions {
  maxWaitMs?: number
  pollIntervalMs?: number
}

interface PollResult {
  results: Record<string, string>[]
  statistics: {
    bytesScanned: number
    recordsMatched: number
    recordsScanned: number
  }
  status: string
}

function parseResultFields(fields: ResultField[] | undefined): Record<string, string> {
  const record: Record<string, string> = {}
  if (!fields) return record
  for (const field of fields) {
    if (field.field && field.value !== undefined) {
      record[field.field] = field.value ?? ''
    }
  }
  return record
}

export async function pollQueryResults(
  client: CloudWatchLogsClient,
  queryId: string,
  options: PollOptions = {}
): Promise<PollResult> {
  const { maxWaitMs = DEFAULT_EXECUTION_TIMEOUT_MS, pollIntervalMs = 1_000 } = options
  const startTime = Date.now()

  while (Date.now() - startTime < maxWaitMs) {
    const command = new GetQueryResultsCommand({ queryId })
    const response = await client.send(command)

    const status = response.status ?? 'Unknown'

    if (status === 'Complete') {
      return {
        results: (response.results ?? []).map(parseResultFields),
        statistics: {
          bytesScanned: response.statistics?.bytesScanned ?? 0,
          recordsMatched: response.statistics?.recordsMatched ?? 0,
          recordsScanned: response.statistics?.recordsScanned ?? 0,
        },
        status,
      }
    }

    if (status === 'Failed' || status === 'Cancelled') {
      throw new Error(`CloudWatch Log Insights query ${status.toLowerCase()}`)
    }

    await sleep(pollIntervalMs)
  }

  // Timeout -- fetch one last time for partial results
  const finalResponse = await client.send(new GetQueryResultsCommand({ queryId }))
  return {
    results: (finalResponse.results ?? []).map(parseResultFields),
    statistics: {
      bytesScanned: finalResponse.statistics?.bytesScanned ?? 0,
      recordsMatched: finalResponse.statistics?.recordsMatched ?? 0,
      recordsScanned: finalResponse.statistics?.recordsScanned ?? 0,
    },
    status: `Timeout (last status: ${finalResponse.status ?? 'Unknown'})`,
  }
}

export async function describeLogStreams(
  client: CloudWatchLogsClient,
  logGroupName: string,
  options?: { prefix?: string; limit?: number }
): Promise<{
  logStreams: {
    logStreamName: string
    lastEventTimestamp: number | undefined
    firstEventTimestamp: number | undefined
    creationTime: number | undefined
    storedBytes: number
  }[]
}> {
  const hasPrefix = Boolean(options?.prefix)
  const command = new DescribeLogStreamsCommand({
    logGroupName,
    ...(hasPrefix
      ? { orderBy: 'LogStreamName', logStreamNamePrefix: options!.prefix }
      : { orderBy: 'LastEventTime', descending: true }),
    ...(options?.limit !== undefined && { limit: options.limit }),
  })

  const response = await client.send(command)
  return {
    logStreams: (response.logStreams ?? []).map((ls) => ({
      logStreamName: ls.logStreamName ?? '',
      lastEventTimestamp: ls.lastEventTimestamp,
      firstEventTimestamp: ls.firstEventTimestamp,
      creationTime: ls.creationTime,
      storedBytes: ls.storedBytes ?? 0,
    })),
  }
}

export async function getLogEvents(
  client: CloudWatchLogsClient,
  logGroupName: string,
  logStreamName: string,
  options?: { startTime?: number; endTime?: number; limit?: number }
): Promise<{
  events: {
    timestamp: number | undefined
    message: string | undefined
    ingestionTime: number | undefined
  }[]
}> {
  const command = new GetLogEventsCommand({
    logGroupName,
    logStreamName,
    ...(options?.startTime !== undefined && { startTime: options.startTime * 1000 }),
    ...(options?.endTime !== undefined && { endTime: options.endTime * 1000 }),
    ...(options?.limit !== undefined && { limit: options.limit }),
    startFromHead: true,
  })

  const response = await client.send(command)
  return {
    events: (response.events ?? []).map((e) => ({
      timestamp: e.timestamp,
      message: e.message,
      ingestionTime: e.ingestionTime,
    })),
  }
}
