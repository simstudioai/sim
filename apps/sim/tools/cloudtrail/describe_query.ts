import type {
  CloudTrailDescribeQueryParams,
  CloudTrailDescribeQueryResponse,
} from '@/tools/cloudtrail/types'
import type { InternalToolConfig } from '@/tools/types'

export const describeQueryTool: InternalToolConfig<
  CloudTrailDescribeQueryParams,
  CloudTrailDescribeQueryResponse
> = {
  id: 'cloudtrail_describe_query',
  name: 'CloudTrail Describe Query',
  description: 'Check the status, run time, and scan statistics of a CloudTrail Lake query',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the query returned by Start Query. Supply this or queryAlias, not both',
    },
    queryAlias: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Query template alias; returns the last run for that alias. Supply this or queryId, not both',
    },
    refreshId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Dashboard refresh ID, used together with queryAlias',
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
      ...(params.queryId && { queryId: params.queryId }),
      ...(params.queryAlias && { queryAlias: params.queryAlias }),
      ...(params.refreshId && { refreshId: params.refreshId }),
      ...(params.eventDataStoreOwnerAccountId && {
        eventDataStoreOwnerAccountId: params.eventDataStoreOwnerAccountId,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to describe CloudTrail Lake query')
    }
    return {
      success: true,
      output: {
        queryId: data.output.queryId ?? null,
        queryString: data.output.queryString ?? null,
        queryStatus: data.output.queryStatus ?? null,
        errorMessage: data.output.errorMessage ?? null,
        deliveryS3Uri: data.output.deliveryS3Uri ?? null,
        deliveryStatus: data.output.deliveryStatus ?? null,
        prompt: data.output.prompt ?? null,
        eventDataStoreOwnerAccountId: data.output.eventDataStoreOwnerAccountId ?? null,
        eventsMatched: data.output.eventsMatched ?? null,
        eventsScanned: data.output.eventsScanned ?? null,
        bytesScanned: data.output.bytesScanned ?? null,
        executionTimeInMillis: data.output.executionTimeInMillis ?? null,
        creationTime: data.output.creationTime ?? null,
      },
    }
  },

  outputs: {
    queryId: {
      type: 'string',
      description: 'ID of the query',
      optional: true,
    },
    queryString: {
      type: 'string',
      description: 'SQL body of the query',
      optional: true,
    },
    queryStatus: {
      type: 'string',
      description: 'QUEUED, RUNNING, FINISHED, FAILED, CANCELLED, or TIMED_OUT',
      optional: true,
    },
    errorMessage: {
      type: 'string',
      description: 'Error message returned if the query failed',
      optional: true,
    },
    deliveryS3Uri: {
      type: 'string',
      description: 'S3 URI the results were delivered to, if configured',
      optional: true,
    },
    deliveryStatus: {
      type: 'string',
      description: 'Delivery status of the S3 results (SUCCESS, FAILED, PENDING, and similar)',
      optional: true,
    },
    prompt: {
      type: 'string',
      description: 'Natural-language prompt used to generate the query, if it was generated',
      optional: true,
    },
    eventDataStoreOwnerAccountId: {
      type: 'string',
      description: 'Account ID of the event data store owner',
      optional: true,
    },
    eventsMatched: {
      type: 'number',
      description: 'Number of events that matched the query',
      optional: true,
    },
    eventsScanned: {
      type: 'number',
      description: 'Number of events scanned by the query',
      optional: true,
    },
    bytesScanned: {
      type: 'number',
      description: 'Bytes scanned by the query',
      optional: true,
    },
    executionTimeInMillis: {
      type: 'number',
      description: 'Query run time in milliseconds',
      optional: true,
    },
    creationTime: {
      type: 'string',
      description: 'When the query was created (ISO 8601)',
      optional: true,
    },
  },
}
