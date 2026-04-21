import type {
  AthenaListNamedQueriesParams,
  AthenaListNamedQueriesResponse,
} from '@/tools/athena/types'
import type { ToolConfig } from '@/tools/types'

export const listNamedQueriesTool: ToolConfig<
  AthenaListNamedQueriesParams,
  AthenaListNamedQueriesResponse
> = {
  id: 'athena_list_named_queries',
  name: 'Athena List Named Queries',
  description: 'List saved/named query IDs in AWS Athena',
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
      description: 'Workgroup to list named queries for',
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
    url: '/api/tools/athena/list-named-queries',
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
      throw new Error(data.error || 'Failed to list Athena named queries')
    }
    return {
      success: true,
      output: {
        namedQueryIds: data.output.namedQueryIds ?? [],
        nextToken: data.output.nextToken ?? null,
      },
    }
  },

  outputs: {
    namedQueryIds: {
      type: 'array',
      description: 'List of named query IDs',
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for next page',
      optional: true,
    },
  },
}
