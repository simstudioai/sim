import type {
  AthenaGetQueryResultsParams,
  AthenaGetQueryResultsResponse,
} from '@/tools/athena/types'
import type { ToolConfig } from '@/tools/types'

export const getQueryResultsTool: ToolConfig<
  AthenaGetQueryResultsParams,
  AthenaGetQueryResultsResponse
> = {
  id: 'athena_get_query_results',
  name: 'Athena Get Query Results',
  description: 'Retrieve the results of a completed Athena query execution',
  version: '1.0',

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
    queryExecutionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Query execution ID to get results for',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of rows to return (1-999)',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous request',
    },
  },

  request: {
    url: '/api/tools/athena/get-query-results',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      queryExecutionId: params.queryExecutionId,
      ...(params.maxResults !== undefined && { maxResults: params.maxResults }),
      ...(params.nextToken && { nextToken: params.nextToken }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to get Athena query results')
    }
    return {
      success: true,
      output: {
        columns: data.output.columns ?? [],
        rows: data.output.rows ?? [],
        nextToken: data.output.nextToken ?? null,
        updateCount: data.output.updateCount ?? null,
      },
    }
  },

  outputs: {
    columns: {
      type: 'array',
      description: 'Column metadata (name and type)',
    },
    rows: {
      type: 'array',
      description: 'Result rows as key-value objects',
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for next page of results',
      optional: true,
    },
    updateCount: {
      type: 'number',
      description: 'Number of rows affected (for INSERT/UPDATE statements)',
      optional: true,
    },
  },
}
