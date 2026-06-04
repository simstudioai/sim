import type { AthenaGetNamedQueryParams, AthenaGetNamedQueryResponse } from '@/tools/athena/types'
import type { ToolConfig } from '@/tools/types'

export const getNamedQueryTool: ToolConfig<AthenaGetNamedQueryParams, AthenaGetNamedQueryResponse> =
  {
    id: 'athena_get_named_query',
    name: 'Athena Get Named Query',
    description: 'Get details of a saved/named query in AWS Athena',
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
      namedQueryId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Named query ID to retrieve',
      },
    },

    request: {
      url: '/api/tools/athena/get-named-query',
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params) => ({
        region: params.awsRegion,
        accessKeyId: params.awsAccessKeyId,
        secretAccessKey: params.awsSecretAccessKey,
        namedQueryId: params.namedQueryId,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to get Athena named query')
      }
      return {
        success: true,
        output: {
          namedQueryId: data.output.namedQueryId,
          name: data.output.name,
          description: data.output.description ?? null,
          database: data.output.database,
          queryString: data.output.queryString,
          workGroup: data.output.workGroup ?? null,
        },
      }
    },

    outputs: {
      namedQueryId: { type: 'string', description: 'Named query ID' },
      name: { type: 'string', description: 'Name of the saved query' },
      description: { type: 'string', description: 'Query description', optional: true },
      database: { type: 'string', description: 'Database the query runs against' },
      queryString: { type: 'string', description: 'SQL query string' },
      workGroup: { type: 'string', description: 'Workgroup name', optional: true },
    },
  }
