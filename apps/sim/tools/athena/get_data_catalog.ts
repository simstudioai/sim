import type { AthenaGetDataCatalogParams, AthenaGetDataCatalogResponse } from '@/tools/athena/types'
import type { InternalToolConfig } from '@/tools/types'

export const getDataCatalogTool: InternalToolConfig<
  AthenaGetDataCatalogParams,
  AthenaGetDataCatalogResponse
> = {
  id: 'athena_get_data_catalog',
  name: 'Athena Get Data Catalog',
  description: 'Get the type, status, and connection parameters of an Athena data catalog',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Data catalog name (e.g., AwsDataCatalog)',
    },
    workGroup: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Workgroup name (required for IAM Identity Center requests)',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      name: params.name,
      ...(params.workGroup && { workGroup: params.workGroup }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to get Athena data catalog')
    }
    return {
      success: true,
      output: {
        name: data.output.name,
        type: data.output.type,
        description: data.output.description ?? null,
        status: data.output.status ?? null,
        connectionType: data.output.connectionType ?? null,
        error: data.output.error ?? null,
        parameters: data.output.parameters ?? {},
      },
    }
  },

  outputs: {
    name: {
      type: 'string',
      description: 'Catalog name',
    },
    type: {
      type: 'string',
      description: 'Catalog type (LAMBDA, GLUE, HIVE, FEDERATED)',
    },
    description: {
      type: 'string',
      description: 'Catalog description',
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
    parameters: {
      type: 'json',
      description: 'Catalog connection parameters (e.g., catalog-id, function ARN)',
    },
  },
}
