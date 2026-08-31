import { CloudWatchLogsServiceException } from '@aws-sdk/client-cloudwatch-logs'
import { validateAwsRegion } from '@/lib/core/security/input-validation'
import {
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { selectorProviderStatusError } from '@/lib/selectors/server/providers/provider-http'
import type { ServerSelectorAttachmentMap } from '@/lib/selectors/server/types'
import { detailSelectorResult, listSelectorResult } from '@/lib/selectors/server/types'
import {
  type CloudWatchListingCredentials,
  listCloudWatchLogGroups,
  listCloudWatchLogStreams,
} from '@/tools/cloudwatch/listing'

type CloudWatchSelectorKey = 'cloudwatch.logGroups' | 'cloudwatch.logStreams'

function credentials(context: {
  awsAccessKeyId?: string
  awsSecretAccessKey?: string
  awsRegion?: string
}): CloudWatchListingCredentials {
  if (
    !context.awsAccessKeyId ||
    !context.awsSecretAccessKey ||
    !context.awsRegion ||
    !validateAwsRegion(context.awsRegion).isValid
  ) {
    throw new SelectorContextUnavailableError()
  }
  return {
    accessKeyId: context.awsAccessKeyId,
    secretAccessKey: context.awsSecretAccessKey,
    region: context.awsRegion,
  }
}

async function executeCloudWatchListing<T>(
  signal: AbortSignal | undefined,
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (signal?.aborted) throw error
    if (
      error instanceof CloudWatchLogsServiceException &&
      typeof error.$metadata.httpStatusCode === 'number'
    ) {
      throw selectorProviderStatusError(error.$metadata.httpStatusCode)
    }
    throw new SelectorOptionsUnavailableError()
  }
}

export const cloudWatchSelectorAttachments = {
  'cloudwatch.logGroups': {
    destination: 'fixed',
    async execute(args) {
      if (args.request.kind === 'detail') {
        return detailSelectorResult({ id: args.request.id, label: args.request.id })
      }
      const search = args.request.search
      const listingCredentials = credentials(args.context)
      const groups = await executeCloudWatchListing(args.signal, () =>
        listCloudWatchLogGroups({
          credentials: listingCredentials,
          prefix: search,
          signal: args.signal,
          suppressTruncationLog: true,
        })
      )
      return listSelectorResult(
        groups.items
          .filter((group) => group.logGroupName)
          .map((group) => ({ id: group.logGroupName, label: group.logGroupName })),
        undefined,
        groups.truncated
          ? { truncated: { reason: 'provider-cap', pages: groups.pages } }
          : undefined
      )
    },
  },
  'cloudwatch.logStreams': {
    destination: 'fixed',
    async execute(args) {
      if (args.request.kind === 'detail') {
        return detailSelectorResult({ id: args.request.id, label: args.request.id })
      }
      const search = args.request.search
      const listingCredentials = credentials(args.context)
      const streams = await executeCloudWatchListing(args.signal, () =>
        listCloudWatchLogStreams({
          credentials: listingCredentials,
          logGroupName: args.context.logGroupName!,
          prefix: search,
          signal: args.signal,
          suppressTruncationLog: true,
        })
      )
      return listSelectorResult(
        streams.items
          .filter((stream) => stream.logStreamName)
          .map((stream) => ({ id: stream.logStreamName, label: stream.logStreamName })),
        undefined,
        streams.truncated
          ? { truncated: { reason: 'provider-cap', pages: streams.pages } }
          : undefined
      )
    },
  },
} satisfies ServerSelectorAttachmentMap<CloudWatchSelectorKey>
