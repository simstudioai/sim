import type {
  AthenaDeletePreparedStatementParams,
  AthenaDeletePreparedStatementResponse,
} from '@/tools/athena/types'
import type { InternalToolConfig } from '@/tools/types'

export const deletePreparedStatementTool: InternalToolConfig<
  AthenaDeletePreparedStatementParams,
  AthenaDeletePreparedStatementResponse
> = {
  id: 'athena_delete_prepared_statement',
  name: 'Athena Delete Prepared Statement',
  description: 'Delete a prepared statement from an Athena workgroup',
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
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      statementName: params.statementName,
      workGroup: params.workGroup,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete Athena prepared statement')
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
