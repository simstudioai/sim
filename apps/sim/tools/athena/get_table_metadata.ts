import type {
  AthenaGetTableMetadataParams,
  AthenaGetTableMetadataResponse,
} from '@/tools/athena/types'
import type { InternalToolConfig } from '@/tools/types'

export const getTableMetadataTool: InternalToolConfig<
  AthenaGetTableMetadataParams,
  AthenaGetTableMetadataResponse
> = {
  id: 'athena_get_table_metadata',
  name: 'Athena Get Table Metadata',
  description:
    'Get the columns, partition keys, and properties of a single table in an Athena data catalog database',
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
    tableName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Table name',
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
      tableName: params.tableName,
      ...(params.workGroup && { workGroup: params.workGroup }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to get Athena table metadata')
    }
    return {
      success: true,
      output: {
        name: data.output.name,
        tableType: data.output.tableType ?? null,
        createTime: data.output.createTime ?? null,
        lastAccessTime: data.output.lastAccessTime ?? null,
        columns: data.output.columns ?? [],
        partitionKeys: data.output.partitionKeys ?? [],
        parameters: data.output.parameters ?? {},
      },
    }
  },

  outputs: {
    name: {
      type: 'string',
      description: 'Table name',
    },
    tableType: {
      type: 'string',
      description: 'Table type (e.g., EXTERNAL_TABLE, VIRTUAL_VIEW)',
      optional: true,
    },
    createTime: {
      type: 'number',
      description: 'Table creation time (Unix epoch ms)',
      optional: true,
    },
    lastAccessTime: {
      type: 'number',
      description: 'Last access time (Unix epoch ms)',
      optional: true,
    },
    columns: {
      type: 'array',
      description: 'Table columns',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Column name' },
          type: { type: 'string', description: 'Column data type', optional: true },
          comment: { type: 'string', description: 'Column comment', optional: true },
        },
      },
    },
    partitionKeys: {
      type: 'array',
      description: 'Partition key columns',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Column name' },
          type: { type: 'string', description: 'Column data type', optional: true },
          comment: { type: 'string', description: 'Column comment', optional: true },
        },
      },
    },
    parameters: {
      type: 'json',
      description: 'Key/value table properties (e.g., classification, location)',
    },
  },
}
