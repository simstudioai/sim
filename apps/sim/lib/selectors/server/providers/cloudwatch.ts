import { CloudWatchLogsServiceException } from '@aws-sdk/client-cloudwatch-logs'
import { validateAwsRegion } from '@/lib/core/security/input-validation'
import type { AwsSessionCredentials } from '@/lib/credentials/aws-service-account.server'
import { resolveAuthorizedAwsCredential, runWithAwsSession } from '@/lib/internal/aws/credentials'
import { AWS_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import { selectorProviderStatusError } from '@/lib/selectors/server/providers/http'
import type {
  ExecuteServerSelectorArgs,
  ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import { detailSelectorResult, listSelectorResult } from '@/lib/selectors/server/types'
import {
  type CloudWatchListingCredentials,
  listCloudWatchLogGroups,
  listCloudWatchLogStreams,
} from '@/tools/cloudwatch/listing'

type CloudWatchSelectorKey = Extract<ServerSelectorKey, `cloudwatch.${string}`>

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

type CloudWatchListing = <T>(
  list: (credentials: CloudWatchListingCredentials) => Promise<T>
) => Promise<T>

/** Lists with the raw AWS keys a legacy block sends in the selector context. */
function rawKeyListing(args: ExecuteServerSelectorArgs): CloudWatchListing {
  const listingCredentials = credentials(args.context)
  return (list) => executeCloudWatchListing(args.signal, () => list(listingCredentials))
}

/**
 * Lists with an authorized saved AWS credential: resolves its short-lived
 * session for the credential's owner scope and signs inside that session.
 */
async function savedCredentialListing(args: ExecuteServerSelectorArgs): Promise<CloudWatchListing> {
  const region = args.context.awsRegion
  if (!region || !validateAwsRegion(region).isValid) throw new SelectorContextUnavailableError()

  const { accessToken: credentialId } = await resolveSelectorCredentialBundle({
    credential: args.credential,
    protectedValues: args.protectedValues,
    recordCredentialUse: args.recordCredentialUse,
    providerId: AWS_SERVICE_ACCOUNT_PROVIDER_ID,
  })
  let session: AwsSessionCredentials
  try {
    session = await resolveAuthorizedAwsCredential(
      credentialId,
      {
        workspaceId: args.workspaceId,
        organizationId: args.credential?.organization?.organizationId ?? args.organizationId,
      },
      args.signal
    )
  } catch (error) {
    if (args.signal?.aborted) throw error
    throw new SelectorConnectionUnavailableError()
  }
  args.protectedValues.add(session.secretAccessKey)
  args.protectedValues.add(session.sessionToken)

  const listingCredentials = {
    accessKeyId: session.accessKeyId,
    secretAccessKey: session.secretAccessKey,
    region,
  }
  return (list) =>
    executeCloudWatchListing(args.signal, () =>
      runWithAwsSession(session, () => list(listingCredentials))
    )
}

async function listLogGroups(args: ExecuteServerSelectorArgs, listing: CloudWatchListing) {
  if (args.request.kind === 'detail') {
    const detailId = args.request.id
    const groups = await listing((listingCredentials) =>
      listCloudWatchLogGroups({
        credentials: listingCredentials,
        prefix: detailId,
        signal: args.signal,
        suppressTruncationLog: true,
      })
    )
    const match = groups.items.find((group) => group.logGroupName === detailId)
    return detailSelectorResult(
      match?.logGroupName ? { id: match.logGroupName, label: match.logGroupName } : null
    )
  }
  const { search, cursor } = args.request
  const groups = await listing((listingCredentials) =>
    listCloudWatchLogGroups({
      credentials: listingCredentials,
      prefix: search,
      nextToken: cursor,
      signal: args.signal,
      suppressTruncationLog: true,
    })
  )
  return listSelectorResult(
    groups.items
      .filter((group) => group.logGroupName)
      .map((group) => ({ id: group.logGroupName, label: group.logGroupName })),
    groups.nextToken
  )
}

async function listLogStreams(args: ExecuteServerSelectorArgs, listing: CloudWatchListing) {
  const logGroupName = args.context.logGroupName
  if (!logGroupName) throw new SelectorContextUnavailableError()
  if (args.request.kind === 'detail') {
    const detailId = args.request.id
    const streams = await listing((listingCredentials) =>
      listCloudWatchLogStreams({
        credentials: listingCredentials,
        logGroupName,
        prefix: detailId,
        signal: args.signal,
        suppressTruncationLog: true,
      })
    )
    const match = streams.items.find((stream) => stream.logStreamName === detailId)
    return detailSelectorResult(
      match?.logStreamName ? { id: match.logStreamName, label: match.logStreamName } : null
    )
  }
  const { search, cursor } = args.request
  const streams = await listing((listingCredentials) =>
    listCloudWatchLogStreams({
      credentials: listingCredentials,
      logGroupName,
      prefix: search,
      nextToken: cursor,
      signal: args.signal,
      suppressTruncationLog: true,
    })
  )
  return listSelectorResult(
    streams.items
      .filter((stream) => stream.logStreamName)
      .map((stream) => ({ id: stream.logStreamName, label: stream.logStreamName })),
    streams.nextToken
  )
}

/**
 * The integration these selectors reach. Declared rather than derived: the
 * raw-key selectors carry no stored connection, so the OAuth credential
 * catalog can identify nothing to gate them on.
 */
const integrationBlockTypes = ['cloudwatch', 'cloudwatch_v2'] as const

const savedCredential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['aws'],
} as const

export const cloudWatchSelectorAttachments = {
  'cloudwatch.logGroups': {
    integrationBlockTypes,
    destination: 'fixed',
    execute: async (args) => listLogGroups(args, rawKeyListing(args)),
  },
  'cloudwatch.logStreams': {
    integrationBlockTypes,
    destination: 'fixed',
    execute: async (args) => listLogStreams(args, rawKeyListing(args)),
  },
  'cloudwatch.savedLogGroups': {
    credential: savedCredential,
    integrationBlockTypes,
    destination: 'fixed',
    execute: async (args) => listLogGroups(args, await savedCredentialListing(args)),
  },
  'cloudwatch.savedLogStreams': {
    credential: savedCredential,
    integrationBlockTypes,
    destination: 'fixed',
    execute: async (args) => listLogStreams(args, await savedCredentialListing(args)),
  },
} satisfies ServerSelectorAttachmentMap<CloudWatchSelectorKey>
