import type {
  AthenaListTableMetadataParams,
  AthenaListTableMetadataResponse,
} from '@/tools/athena/types'
import type { ToolConfig } from '@/tools/types'

export const listTableMetadataTool: ToolConfig<
  AthenaListTableMetadataParams,
  AthenaListTableMetadataResponse
> = {
  id: 'athena_list_table_metadata',
  name: 'Athena List Table Metadata',
  description: 'List tables and their column/partition metadata for an Athena database',
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
      description: 'Database name to list tables from',
    },
    expression: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Regex filter that pattern-matches table names',
    },
    workGroup: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Workgroup for which the metadata is being fetched (required for IAM Identity Center enabled catalogs)',
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

  request: {
    url: '/api/tools/athena/list-table-metadata',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      catalogName: params.catalogName,
      databaseName: params.databaseName,
      ...(params.expression && { expression: params.expression }),
      ...(params.workGroup && { workGroup: params.workGroup }),
      ...(params.maxResults !== undefined && { maxResults: params.maxResults }),
      ...(params.nextToken && { nextToken: params.nextToken }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to list Athena table metadata')
    }
    return {
      success: true,
      output: {
        tables: data.output.tables ?? [],
        nextToken: data.output.nextToken ?? null,
      },
    }
  },

  outputs: {
    tables: {
      type: 'array',
      description: 'Table metadata (name, type, columns, partition keys)',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Table name' },
          tableType: { type: 'string', description: 'Table type', optional: true },
          createTime: {
            type: 'number',
            description: 'Table creation time (Unix epoch ms)',
            optional: true,
          },
          lastAccessTime: {
            type: 'number',
            description: 'Table last access time (Unix epoch ms)',
            optional: true,
          },
          columns: {
            type: 'array',
            description: 'Column definitions',
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
            description: 'Partition key definitions',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Partition key name' },
                type: { type: 'string', description: 'Partition key data type', optional: true },
                comment: { type: 'string', description: 'Partition key comment', optional: true },
              },
            },
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
