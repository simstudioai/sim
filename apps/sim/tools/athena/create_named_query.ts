import type {
  AthenaCreateNamedQueryParams,
  AthenaCreateNamedQueryResponse,
} from '@/tools/athena/types'
import type { ToolConfig } from '@/tools/types'

export const createNamedQueryTool: ToolConfig<
  AthenaCreateNamedQueryParams,
  AthenaCreateNamedQueryResponse
> = {
  id: 'athena_create_named_query',
  name: 'Athena Create Named Query',
  description: 'Create a saved/named query in AWS Athena',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name for the saved query',
    },
    database: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Database the query runs against',
    },
    queryString: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'SQL query string to save',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the named query',
    },
    workGroup: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Workgroup to create the named query in',
    },
  },

  request: {
    url: '/api/tools/athena/create-named-query',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      name: params.name,
      database: params.database,
      queryString: params.queryString,
      ...(params.description && { description: params.description }),
      ...(params.workGroup && { workGroup: params.workGroup }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to create Athena named query')
    }
    return {
      success: true,
      output: {
        namedQueryId: data.output.namedQueryId,
      },
    }
  },

  outputs: {
    namedQueryId: {
      type: 'string',
      description: 'ID of the created named query',
    },
  },
}
