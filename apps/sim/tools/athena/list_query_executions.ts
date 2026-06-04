import type {
  AthenaListQueryExecutionsParams,
  AthenaListQueryExecutionsResponse,
} from '@/tools/athena/types'
import type { ToolConfig } from '@/tools/types'

export const listQueryExecutionsTool: ToolConfig<
  AthenaListQueryExecutionsParams,
  AthenaListQueryExecutionsResponse
> = {
  id: 'athena_list_query_executions',
  name: 'Athena List Query Executions',
  description: 'List recent Athena query execution IDs',
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
    workGroup: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Workgroup to list executions for (default: primary)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (0-50)',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous request',
    },
  },

  request: {
    url: '/api/tools/athena/list-query-executions',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      ...(params.workGroup && { workGroup: params.workGroup }),
      ...(params.maxResults !== undefined && { maxResults: params.maxResults }),
      ...(params.nextToken && { nextToken: params.nextToken }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to list Athena query executions')
    }
    return {
      success: true,
      output: {
        queryExecutionIds: data.output.queryExecutionIds ?? [],
        nextToken: data.output.nextToken ?? null,
      },
    }
  },

  outputs: {
    queryExecutionIds: {
      type: 'array',
      description: 'List of query execution IDs',
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for next page',
      optional: true,
    },
  },
}
