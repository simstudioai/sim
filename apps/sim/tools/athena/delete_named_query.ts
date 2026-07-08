import type {
  AthenaDeleteNamedQueryParams,
  AthenaDeleteNamedQueryResponse,
} from '@/tools/athena/types'
import type { ToolConfig } from '@/tools/types'

export const deleteNamedQueryTool: ToolConfig<
  AthenaDeleteNamedQueryParams,
  AthenaDeleteNamedQueryResponse
> = {
  id: 'athena_delete_named_query',
  name: 'Athena Delete Named Query',
  description: 'Delete a saved/named query in AWS Athena',
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
      description: 'Named query ID to delete',
    },
  },

  request: {
    url: '/api/tools/athena/delete-named-query',
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
      throw new Error(data.error || 'Failed to delete Athena named query')
    }
    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the named query was successfully deleted',
    },
  },
}
