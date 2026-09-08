import type {
  AthenaBatchGetNamedQueryParams,
  AthenaBatchGetNamedQueryResponse,
} from '@/tools/athena/types'
import type { InternalToolConfig } from '@/tools/types'

export const batchGetNamedQueryTool: InternalToolConfig<
  AthenaBatchGetNamedQueryParams,
  AthenaBatchGetNamedQueryResponse
> = {
  id: 'athena_batch_get_named_query',
  name: 'Athena Batch Get Named Queries',
  description: 'Get the details of up to 50 Athena named queries by ID in a single call',
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
    namedQueryIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated named query IDs (up to 50)',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      namedQueryIds: params.namedQueryIds
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to batch get Athena named queries')
    }
    return {
      success: true,
      output: {
        namedQueries: data.output.namedQueries ?? [],
        unprocessedNamedQueryIds: data.output.unprocessedNamedQueryIds ?? [],
      },
    }
  },

  outputs: {
    namedQueries: {
      type: 'array',
      description: 'Details for each named query that was found',
      items: {
        type: 'object',
        properties: {
          namedQueryId: { type: 'string', description: 'Named query ID' },
          name: { type: 'string', description: 'Named query name' },
          description: { type: 'string', description: 'Named query description', optional: true },
          database: { type: 'string', description: 'Database the query runs against' },
          queryString: { type: 'string', description: 'SQL text of the named query' },
          workGroup: {
            type: 'string',
            description: 'Workgroup the query is saved in',
            optional: true,
          },
        },
      },
    },
    unprocessedNamedQueryIds: {
      type: 'array',
      description: 'Named query IDs that could not be retrieved, with error details',
      items: {
        type: 'object',
        properties: {
          namedQueryId: { type: 'string', description: 'Named query ID', optional: true },
          errorCode: { type: 'string', description: 'Error code', optional: true },
          errorMessage: { type: 'string', description: 'Error message', optional: true },
        },
      },
    },
  },
}
