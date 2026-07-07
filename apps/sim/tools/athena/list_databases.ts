import type { AthenaListDatabasesParams, AthenaListDatabasesResponse } from '@/tools/athena/types'
import type { ToolConfig } from '@/tools/types'

export const listDatabasesTool: ToolConfig<AthenaListDatabasesParams, AthenaListDatabasesResponse> =
  {
    id: 'athena_list_databases',
    name: 'Athena List Databases',
    description: 'List the databases available in an Athena data catalog',
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
        description: 'Data catalog name to list databases from (e.g., AwsDataCatalog)',
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
      url: '/api/tools/athena/list-databases',
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params) => ({
        region: params.awsRegion,
        accessKeyId: params.awsAccessKeyId,
        secretAccessKey: params.awsSecretAccessKey,
        catalogName: params.catalogName,
        ...(params.workGroup && { workGroup: params.workGroup }),
        ...(params.maxResults !== undefined && { maxResults: params.maxResults }),
        ...(params.nextToken && { nextToken: params.nextToken }),
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to list Athena databases')
      }
      return {
        success: true,
        output: {
          databases: data.output.databases ?? [],
          nextToken: data.output.nextToken ?? null,
        },
      }
    },

    outputs: {
      databases: {
        type: 'array',
        description: 'List of databases (name, description)',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Database name' },
            description: { type: 'string', description: 'Database description', optional: true },
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
