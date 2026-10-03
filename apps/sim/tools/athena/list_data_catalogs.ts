import type {
  AthenaListDataCatalogsParams,
  AthenaListDataCatalogsResponse,
} from '@/tools/athena/types'
import type { InternalToolConfig } from '@/tools/types'

export const listDataCatalogsTool: InternalToolConfig<
  AthenaListDataCatalogsParams,
  AthenaListDataCatalogsResponse
> = {
  id: 'athena_list_data_catalogs',
  name: 'Athena List Data Catalogs',
  description: 'List the data catalogs (data sources) registered in the AWS account',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Workgroup name (required for IAM Identity Center requests)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (2-50)',
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
      ...(params.workGroup && { workGroup: params.workGroup }),
      ...(params.maxResults !== undefined && { maxResults: params.maxResults }),
      ...(params.nextToken && { nextToken: params.nextToken }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to list Athena data catalogs')
    }
    return {
      success: true,
      output: {
        dataCatalogs: data.output.dataCatalogs ?? [],
        nextToken: data.output.nextToken ?? null,
      },
    }
  },

  outputs: {
    dataCatalogs: {
      type: 'array',
      description: 'Data catalog summaries',
      items: {
        type: 'object',
        properties: {
          catalogName: { type: 'string', description: 'Catalog name' },
          type: {
            type: 'string',
            description: 'Catalog type (LAMBDA, GLUE, HIVE, FEDERATED)',
            optional: true,
          },
          status: {
            type: 'string',
            description: 'Creation or deletion status (e.g., CREATE_COMPLETE)',
            optional: true,
          },
          connectionType: {
            type: 'string',
            description: 'Connector type for FEDERATED catalogs (e.g., MYSQL, REDSHIFT)',
            optional: true,
          },
          error: {
            type: 'string',
            description: 'Error text from catalog creation or deletion',
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
