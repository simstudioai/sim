import type {
  CloudTrailCancelQueryParams,
  CloudTrailCancelQueryResponse,
} from '@/tools/cloudtrail/types'
import type { InternalToolConfig } from '@/tools/types'

export const cancelQueryTool: InternalToolConfig<
  CloudTrailCancelQueryParams,
  CloudTrailCancelQueryResponse
> = {
  id: 'cloudtrail_cancel_query',
  name: 'CloudTrail Cancel Query',
  description: 'Cancel a running CloudTrail Lake query',
  version: '1.0.0',

  params: {
    awsRegion: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    awsAccessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    awsSecretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    queryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the query returned by Start Query',
    },
    eventDataStoreOwnerAccountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account ID of the event data store owner, for a shared event data store',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      queryId: params.queryId,
      ...(params.eventDataStoreOwnerAccountId && {
        eventDataStoreOwnerAccountId: params.eventDataStoreOwnerAccountId,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to cancel CloudTrail Lake query')
    }
    return {
      success: true,
      output: {
        queryId: data.output.queryId,
        queryStatus: data.output.queryStatus ?? null,
        eventDataStoreOwnerAccountId: data.output.eventDataStoreOwnerAccountId ?? null,
      },
    }
  },

  outputs: {
    queryId: {
      type: 'string',
      description: 'ID of the cancelled query',
    },
    queryStatus: {
      type: 'string',
      description:
        'Status AWS reported for the query after the cancellation request. Cancellation is asynchronous, so this is typically RUNNING or CANCELLED — poll Describe Lake Query for the terminal status',
      optional: true,
    },
    eventDataStoreOwnerAccountId: {
      type: 'string',
      description: 'Account ID of the event data store owner, when the query was cross-account',
      optional: true,
    },
  },
}
