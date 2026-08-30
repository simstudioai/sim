import { validateAwsRegion } from '@/lib/core/security/input-validation'
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
    throw new Error('Invalid CloudWatch connection context')
  }
  return {
    accessKeyId: context.awsAccessKeyId,
    secretAccessKey: context.awsSecretAccessKey,
    region: context.awsRegion,
  }
}

export const cloudWatchSelectorAttachments = {
  'cloudwatch.logGroups': {
    destination: 'fixed',
    async execute(args) {
      if (args.request.kind === 'detail') {
        return detailSelectorResult({ id: args.request.id, label: args.request.id })
      }
      const groups = await listCloudWatchLogGroups({
        credentials: credentials(args.context),
        prefix: args.request.search,
        signal: args.signal,
        suppressTruncationLog: true,
      })
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
      const streams = await listCloudWatchLogStreams({
        credentials: credentials(args.context),
        logGroupName: args.context.logGroupName!,
        prefix: args.request.search,
        signal: args.signal,
        suppressTruncationLog: true,
      })
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
