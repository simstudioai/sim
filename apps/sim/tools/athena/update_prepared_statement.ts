import type {
  AthenaUpdatePreparedStatementParams,
  AthenaUpdatePreparedStatementResponse,
} from '@/tools/athena/types'
import type { InternalToolConfig } from '@/tools/types'

export const updatePreparedStatementTool: InternalToolConfig<
  AthenaUpdatePreparedStatementParams,
  AthenaUpdatePreparedStatementResponse
> = {
  id: 'athena_update_prepared_statement',
  name: 'Athena Update Prepared Statement',
  description:
    'Replace the SQL and description of an existing prepared statement in an Athena workgroup',
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
    statementName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Prepared statement name (letters, digits, _ @ : ; must start with a letter or underscore)',
    },
    workGroup: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workgroup the prepared statement belongs to',
    },
    queryStatement: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New SQL statement with ? placeholders for parameters',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New description of the prepared statement',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      statementName: params.statementName,
      workGroup: params.workGroup,
      queryStatement: params.queryStatement,
      ...(params.description && { description: params.description }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to update Athena prepared statement')
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
