import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  GetLogEventsCommand,
  GetQueryResultsCommand,
  type ResultField,
} from '@aws-sdk/client-cloudwatch-logs'
import { createLogger } from '@sim/logger'
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

/** AWS DescribeLogStreams caps `limit` at 50 items per page. */
const LOG_STREAMS_PAGE_SIZE = 50

/** Upper bound on pages drained to avoid unbounded loops on log groups with many streams. */
const MAX_LOG_STREAMS_PAGES = 20

const logger = createLogger('CloudWatchUtils')

interface DescribedLogStream {
  logStreamName: string
  lastEventTimestamp: number | undefined
  firstEventTimestamp: number | undefined
  creationTime: number | undefined
  storedBytes: number
}

/**
 * Lists log streams for a log group, following `nextToken` so the complete set
 * is returned rather than just the first page. Bounded by
 * `MAX_LOG_STREAMS_PAGES`; logs a warning rather than silently dropping streams
 * when the cap is hit. Ordering/prefix inputs are preserved across all pages.
 *
 * When `limit` is provided it is treated as a total result cap: draining stops
 * once enough streams have been collected. When omitted, every page is drained.
 */
export async function describeLogStreams(
  client: CloudWatchLogsClient,
  logGroupName: string,
  options?: { prefix?: string; limit?: number }
): Promise<{ logStreams: DescribedLogStream[] }> {
  const hasPrefix = Boolean(options?.prefix)
  const totalLimit = options?.limit
  const logStreams: DescribedLogStream[] = []
  let nextToken: string | undefined

  for (let page = 0; page < MAX_LOG_STREAMS_PAGES; page++) {
    const pageLimit =
      totalLimit !== undefined
        ? Math.min(LOG_STREAMS_PAGE_SIZE, totalLimit - logStreams.length)
        : LOG_STREAMS_PAGE_SIZE

    const command = new DescribeLogStreamsCommand({
      logGroupName,
      ...(hasPrefix
        ? { orderBy: 'LogStreamName', logStreamNamePrefix: options!.prefix }
        : { orderBy: 'LastEventTime', descending: true }),
      limit: pageLimit,
      ...(nextToken && { nextToken }),
    })

    const response = await client.send(command)

    for (const ls of response.logStreams ?? []) {
      logStreams.push({
        logStreamName: ls.logStreamName ?? '',
        lastEventTimestamp: ls.lastEventTimestamp,
        firstEventTimestamp: ls.firstEventTimestamp,
        creationTime: ls.creationTime,
        storedBytes: ls.storedBytes ?? 0,
      })
    }

    nextToken = response.nextToken
    if (!nextToken) break
    if (totalLimit !== undefined && logStreams.length >= totalLimit) break

    if (page === MAX_LOG_STREAMS_PAGES - 1) {
      logger.warn(
        `DescribeLogStreams hit pagination cap of ${MAX_LOG_STREAMS_PAGES} pages; log stream list may be incomplete`,
        { logGroupName }
      )
    }
  }

  return {
    logStreams: totalLimit !== undefined ? logStreams.slice(0, totalLimit) : logStreams,
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
