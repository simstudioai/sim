import type {
  AthenaListPreparedStatementsParams,
  AthenaListPreparedStatementsResponse,
} from '@/tools/athena/types'
import type { InternalToolConfig } from '@/tools/types'

export const listPreparedStatementsTool: InternalToolConfig<
  AthenaListPreparedStatementsParams,
  AthenaListPreparedStatementsResponse
> = {
  id: 'athena_list_prepared_statements',
  name: 'Athena List Prepared Statements',
  description: 'List the prepared statements saved in an Athena workgroup',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'Workgroup to list prepared statements for',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (1-50)',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous request',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      workGroup: params.workGroup,
      ...(params.maxResults !== undefined && { maxResults: params.maxResults }),
      ...(params.nextToken && { nextToken: params.nextToken }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to list Athena prepared statements')
    }
    return {
      success: true,
      output: {
        preparedStatements: data.output.preparedStatements ?? [],
        nextToken: data.output.nextToken ?? null,
      },
    }
  },

  outputs: {
    preparedStatements: {
      type: 'array',
      description: 'Prepared statement summaries',
      items: {
        type: 'object',
        properties: {
          statementName: { type: 'string', description: 'Prepared statement name' },
          lastModifiedTime: {
            type: 'number',
            description: 'Last modified time (Unix epoch ms)',
            optional: true,
          },
        },
      },
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for next page',
      optional: true,
    },
  },
}
