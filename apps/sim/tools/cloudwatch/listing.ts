import { DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs'
import { createLogger } from '@sim/logger'
import {
  createCloudWatchLogsClient,
  type DescribedLogStream,
  describeLogStreams,
} from '@/lib/internal/cloudwatch/client'

const PAGE_SIZE = 50
const MAX_PAGES = 20
const logger = createLogger('CloudWatchListing')

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

export interface CloudWatchListingResult<T> {
  items: T[]
  truncated: boolean
  pages: number
}

export async function listCloudWatchLogGroups(input: {
  credentials: CloudWatchListingCredentials
  prefix?: string
  limit?: number
  signal?: AbortSignal
  suppressTruncationLog?: boolean
}): Promise<CloudWatchListingResult<DescribedLogGroup>> {
  const client = createCloudWatchLogsClient(input.credentials)
  try {
    const groups: DescribedLogGroup[] = []
    let nextToken: string | undefined
    let pages = 0
    let truncated = false
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
      pages = page + 1
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
      if (input.limit !== undefined && groups.length >= input.limit) break
      if (page === MAX_PAGES - 1) {
        truncated = true
        if (!input.suppressTruncationLog) {
          logger.warn(
            `DescribeLogGroups hit pagination cap of ${MAX_PAGES} pages; log group list may be incomplete`
          )
        }
      }
    }
    return {
      items: input.limit === undefined ? groups : groups.slice(0, input.limit),
      truncated,
      pages,
    }
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
  suppressTruncationLog?: boolean
}): Promise<CloudWatchListingResult<DescribedLogStream>> {
  const client = createCloudWatchLogsClient(input.credentials)
  try {
    const result = await describeLogStreams(
      client,
      input.logGroupName,
      {
        prefix: input.prefix,
        limit: input.limit,
        ...(input.suppressTruncationLog !== undefined
          ? { suppressTruncationLog: input.suppressTruncationLog }
          : {}),
      },
      input.signal
    )
    return {
      items: result.logStreams,
      truncated: result.truncated ?? false,
      pages: result.pages ?? 0,
    }
  } finally {
    client.destroy()
  }
}
