import type {
  AthenaBatchGetPreparedStatementParams,
  AthenaBatchGetPreparedStatementResponse,
} from '@/tools/athena/types'
import type { InternalToolConfig } from '@/tools/types'

export const batchGetPreparedStatementTool: InternalToolConfig<
  AthenaBatchGetPreparedStatementParams,
  AthenaBatchGetPreparedStatementResponse
> = {
  id: 'athena_batch_get_prepared_statement',
  name: 'Athena Batch Get Prepared Statements',
  description:
    'Get the details of up to 256 prepared statements in an Athena workgroup by name in a single call',
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
    preparedStatementNames: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated prepared statement names (up to 256)',
    },
    workGroup: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workgroup the prepared statement belongs to',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      preparedStatementNames: params.preparedStatementNames
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean),
      workGroup: params.workGroup,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to batch get Athena prepared statements')
    }
    return {
      success: true,
      output: {
        preparedStatements: data.output.preparedStatements ?? [],
        unprocessedPreparedStatementNames: data.output.unprocessedPreparedStatementNames ?? [],
      },
    }
  },

  outputs: {
    preparedStatements: {
      type: 'array',
      description: 'Details for each prepared statement that was found',
      items: {
        type: 'object',
        properties: {
          statementName: { type: 'string', description: 'Prepared statement name' },
          queryStatement: { type: 'string', description: 'SQL text of the prepared statement' },
          workGroupName: {
            type: 'string',
            description: 'Workgroup the statement belongs to',
            optional: true,
          },
          description: {
            type: 'string',
            description: 'Prepared statement description',
            optional: true,
          },
          lastModifiedTime: {
            type: 'number',
            description: 'Last modified time (Unix epoch ms)',
            optional: true,
          },
        },
      },
    },
    unprocessedPreparedStatementNames: {
      type: 'array',
      description: 'Statement names that could not be retrieved, with error details',
      items: {
        type: 'object',
        properties: {
          statementName: { type: 'string', description: 'Prepared statement name', optional: true },
          errorCode: { type: 'string', description: 'Error code', optional: true },
          errorMessage: { type: 'string', description: 'Error message', optional: true },
        },
      },
    },
  },
}
