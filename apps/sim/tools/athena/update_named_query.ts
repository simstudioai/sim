import type {
  AthenaUpdateNamedQueryParams,
  AthenaUpdateNamedQueryResponse,
} from '@/tools/athena/types'
import type { InternalToolConfig } from '@/tools/types'

export const updateNamedQueryTool: InternalToolConfig<
  AthenaUpdateNamedQueryParams,
  AthenaUpdateNamedQueryResponse
> = {
  id: 'athena_update_named_query',
  name: 'Athena Update Named Query',
  description:
    'Update the name, description, or SQL of an existing Athena named query (database and workgroup cannot change)',
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
      description: 'Named query ID to update',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New name for the query (1-128 characters)',
    },
    queryString: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New SQL query text',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'New description; omit to keep the current one, or pass an empty string to clear it',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      namedQueryId: params.namedQueryId,
      name: params.name,
      queryString: params.queryString,
      ...(params.description !== undefined && { description: params.description }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to update Athena named query')
    }
    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
  },
}
