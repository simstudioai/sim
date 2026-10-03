import type {
  CloudTrailGetQueryResultsParams,
  CloudTrailGetQueryResultsResponse,
} from '@/tools/cloudtrail/types'
import type { InternalToolConfig } from '@/tools/types'

export const getQueryResultsTool: InternalToolConfig<
  CloudTrailGetQueryResultsParams,
  CloudTrailGetQueryResultsResponse
> = {
  id: 'cloudtrail_get_query_results',
  name: 'CloudTrail Get Query Results',
  description: 'Fetch a page of result rows from a finished CloudTrail Lake query',
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
    maxQueryResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum rows to return on a single page, 1 to 1000',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous results request',
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
      ...(params.maxQueryResults !== undefined && { maxQueryResults: params.maxQueryResults }),
      ...(params.nextToken && { nextToken: params.nextToken }),
      ...(params.eventDataStoreOwnerAccountId && {
        eventDataStoreOwnerAccountId: params.eventDataStoreOwnerAccountId,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to get CloudTrail Lake query results')
    }
    return {
      success: true,
      output: {
        queryStatus: data.output.queryStatus ?? null,
        rows: data.output.rows ?? [],
        resultsCount: data.output.resultsCount ?? null,
        totalResultsCount: data.output.totalResultsCount ?? null,
        bytesScanned: data.output.bytesScanned ?? null,
        errorMessage: data.output.errorMessage ?? null,
        nextToken: data.output.nextToken ?? null,
      },
    }
  },

  outputs: {
    queryStatus: {
      type: 'string',
      description: 'QUEUED, RUNNING, FINISHED, FAILED, CANCELLED, or TIMED_OUT',
      optional: true,
    },
    rows: {
      type: 'array',
      description:
        'Result rows, each flattened into a single object keyed by the query column names',
      items: { type: 'object' },
    },
    resultsCount: {
      type: 'number',
      description: 'Number of rows on this page',
      optional: true,
    },
    totalResultsCount: {
      type: 'number',
      description: 'Total number of rows the query produced',
      optional: true,
    },
    bytesScanned: {
      type: 'number',
      description: 'Bytes scanned by the query',
      optional: true,
    },
    errorMessage: {
      type: 'string',
      description: 'Error message returned if the query failed',
      optional: true,
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of rows',
      optional: true,
    },
  },
}
