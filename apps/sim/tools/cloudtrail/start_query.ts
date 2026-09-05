import type {
  CloudTrailStartQueryParams,
  CloudTrailStartQueryResponse,
} from '@/tools/cloudtrail/types'
import type { InternalToolConfig } from '@/tools/types'

export const startQueryTool: InternalToolConfig<
  CloudTrailStartQueryParams,
  CloudTrailStartQueryResponse
> = {
  id: 'cloudtrail_start_query',
  name: 'CloudTrail Start Query',
  description: 'Start a CloudTrail Lake SQL query over an event data store',
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
    queryStatement: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'SQL query to run, up to 10,000 characters. The event data store ID is named in the FROM clause. Supply this or queryAlias, not both',
    },
    queryAlias: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Alias of a query template used by CloudTrail Lake dashboards. Supply this or queryStatement, not both',
    },
    queryParameters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated parameter values for the query alias, up to 10 values',
    },
    deliveryS3Uri: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'S3 URI where CloudTrail delivers the query results (e.g., s3://my-bucket/results)',
    },
    eventDataStoreOwnerAccountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account ID of the event data store owner, for a shared event data store',
    },
  },

  operation: {
    /**
     * `QueryParameters` is positional: CloudTrail substitutes each entry into the query
     * template by index. Empty slots are preserved rather than dropped, so a malformed
     * list such as `a,,c` fails the contract's per-entry minimum length instead of
     * silently shifting `c` into the second position.
     */
    input: (params) => {
      const rawQueryParameters = (params.queryParameters ?? '').trim()
      const queryParameters = rawQueryParameters
        ? rawQueryParameters.split(',').map((value) => value.trim())
        : []
      return {
        region: params.awsRegion,
        accessKeyId: params.awsAccessKeyId,
        secretAccessKey: params.awsSecretAccessKey,
        ...(params.queryStatement && { queryStatement: params.queryStatement }),
        ...(params.queryAlias && { queryAlias: params.queryAlias }),
        ...(queryParameters.length > 0 && { queryParameters }),
        ...(params.deliveryS3Uri && { deliveryS3Uri: params.deliveryS3Uri }),
        ...(params.eventDataStoreOwnerAccountId && {
          eventDataStoreOwnerAccountId: params.eventDataStoreOwnerAccountId,
        }),
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to start CloudTrail Lake query')
    }
    return {
      success: true,
      output: {
        queryId: data.output.queryId,
        eventDataStoreOwnerAccountId: data.output.eventDataStoreOwnerAccountId ?? null,
      },
    }
  },

  outputs: {
    queryId: {
      type: 'string',
      description:
        'ID of the started query. Pass it to Describe Query to poll status, or to Get Query Results to page through rows',
    },
    eventDataStoreOwnerAccountId: {
      type: 'string',
      description: 'Account ID of the event data store owner',
      optional: true,
    },
  },
}
