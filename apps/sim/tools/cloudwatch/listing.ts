import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  DescribeLogStreamsCommand,
} from '@aws-sdk/client-cloudwatch-logs'

const PAGE_SIZE = 50
const MAX_PAGES = 20

export interface CloudWatchListingCredentials {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export interface DescribedLogGroup {
  logGroupName: string
  arn: string
  storedBytes: number
  retentionInDays: number | undefined
  creationTime: number | undefined
}

export interface DescribedLogStream {
  logStreamName: string
  lastEventTimestamp: number | undefined
  firstEventTimestamp: number | undefined
  creationTime: number | undefined
  storedBytes: number
}

function createClient(credentials: CloudWatchListingCredentials): CloudWatchLogsClient {
  return new CloudWatchLogsClient({
    region: credentials.region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
  })
}

export async function listCloudWatchLogGroups(input: {
  credentials: CloudWatchListingCredentials
  prefix?: string
  limit?: number
  signal?: AbortSignal
}): Promise<DescribedLogGroup[]> {
  const client = createClient(input.credentials)
  try {
    const groups: DescribedLogGroup[] = []
    let nextToken: string | undefined
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const remaining = input.limit === undefined ? PAGE_SIZE : input.limit - groups.length
      if (remaining <= 0) break
      const response = await client.send(
        new DescribeLogGroupsCommand({
          ...(input.prefix ? { logGroupNamePrefix: input.prefix } : {}),
          limit: Math.min(PAGE_SIZE, remaining),
          ...(nextToken ? { nextToken } : {}),
        }),
        input.signal ? { abortSignal: input.signal } : undefined
      )
      groups.push(
        ...(response.logGroups ?? []).map((group) => ({
          logGroupName: group.logGroupName ?? '',
          arn: group.arn ?? '',
          storedBytes: group.storedBytes ?? 0,
          retentionInDays: group.retentionInDays,
          creationTime: group.creationTime,
        }))
      )
      nextToken = response.nextToken
      if (!nextToken) break
    }
    return input.limit === undefined ? groups : groups.slice(0, input.limit)
  } finally {
    client.destroy()
  }
}

export async function listCloudWatchLogStreams(input: {
  credentials: CloudWatchListingCredentials
  logGroupName: string
  prefix?: string
  limit?: number
  signal?: AbortSignal
}): Promise<DescribedLogStream[]> {
  const client = createClient(input.credentials)
  try {
    const streams: DescribedLogStream[] = []
    let nextToken: string | undefined
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const remaining = input.limit === undefined ? PAGE_SIZE : input.limit - streams.length
      if (remaining <= 0) break
      const response = await client.send(
        new DescribeLogStreamsCommand({
          logGroupName: input.logGroupName,
          ...(input.prefix
            ? { orderBy: 'LogStreamName', logStreamNamePrefix: input.prefix }
            : { orderBy: 'LastEventTime', descending: true }),
          limit: Math.min(PAGE_SIZE, remaining),
          ...(nextToken ? { nextToken } : {}),
        }),
        input.signal ? { abortSignal: input.signal } : undefined
      )
      streams.push(
        ...(response.logStreams ?? []).map((stream) => ({
          logStreamName: stream.logStreamName ?? '',
          lastEventTimestamp: stream.lastEventTimestamp,
          firstEventTimestamp: stream.firstEventTimestamp,
          creationTime: stream.creationTime,
          storedBytes: stream.storedBytes ?? 0,
        }))
      )
      nextToken = response.nextToken
      if (!nextToken) break
    }
    return input.limit === undefined ? streams : streams.slice(0, input.limit)
  } finally {
    client.destroy()
  }
}
