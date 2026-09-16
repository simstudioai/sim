import type {
  AthenaGetPreparedStatementParams,
  AthenaGetPreparedStatementResponse,
} from '@/tools/athena/types'
import type { InternalToolConfig } from '@/tools/types'

export const getPreparedStatementTool: InternalToolConfig<
  AthenaGetPreparedStatementParams,
  AthenaGetPreparedStatementResponse
> = {
  id: 'athena_get_prepared_statement',
  name: 'Athena Get Prepared Statement',
  description: 'Get the SQL and metadata of a prepared statement in an Athena workgroup',
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
      throw new Error(data.error || 'Failed to get Athena prepared statement')
    }
    return {
      success: true,
      output: {
        statementName: data.output.statementName,
        queryStatement: data.output.queryStatement,
        workGroupName: data.output.workGroupName ?? null,
        description: data.output.description ?? null,
        lastModifiedTime: data.output.lastModifiedTime ?? null,
      },
    }
  },

  outputs: {
    statementName: {
      type: 'string',
      description: 'Prepared statement name',
    },
    queryStatement: {
      type: 'string',
      description: 'SQL text of the prepared statement',
    },
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
}
