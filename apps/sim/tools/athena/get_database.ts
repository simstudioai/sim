import type { AthenaGetDatabaseParams, AthenaGetDatabaseResponse } from '@/tools/athena/types'
import type { InternalToolConfig } from '@/tools/types'

export const getDatabaseTool: InternalToolConfig<
  AthenaGetDatabaseParams,
  AthenaGetDatabaseResponse
> = {
  id: 'athena_get_database',
  name: 'Athena Get Database',
  description:
    'Get a single database (name, description, and parameters) from an Athena data catalog',
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
    catalogName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Data catalog name (e.g., AwsDataCatalog)',
    },
    databaseName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Database name',
    },
    workGroup: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Workgroup name (required for IAM Identity Center enabled catalogs)',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      catalogName: params.catalogName,
      databaseName: params.databaseName,
      ...(params.workGroup && { workGroup: params.workGroup }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to get Athena database')
    }
    return {
      success: true,
      output: {
        name: data.output.name,
        description: data.output.description ?? null,
        parameters: data.output.parameters ?? {},
      },
    }
  },

  outputs: {
    name: {
      type: 'string',
      description: 'Database name',
    },
    description: {
      type: 'string',
      description: 'Database description',
      optional: true,
    },
    parameters: {
      type: 'json',
      description: 'Key/value properties set on the database',
    },
  },
}
