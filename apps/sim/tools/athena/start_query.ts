import type { AthenaStartQueryParams, AthenaStartQueryResponse } from '@/tools/athena/types'
import type { ToolConfig } from '@/tools/types'

export const startQueryTool: ToolConfig<AthenaStartQueryParams, AthenaStartQueryResponse> = {
  id: 'athena_start_query',
  name: 'Athena Start Query',
  description: 'Start an SQL query execution in AWS Athena',
  version: '1.0',

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
    queryString: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'SQL query string to execute',
    },
    database: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Database name within the catalog',
    },
    catalog: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Data catalog name (default: AwsDataCatalog)',
    },
    outputLocation: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'S3 output location for query results (e.g., s3://bucket/path/)',
    },
    workGroup: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Workgroup to execute the query in (default: primary)',
    },
  },

  request: {
    url: '/api/tools/athena/start-query',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      queryString: params.queryString,
      ...(params.database && { database: params.database }),
      ...(params.catalog && { catalog: params.catalog }),
      ...(params.outputLocation && { outputLocation: params.outputLocation }),
      ...(params.workGroup && { workGroup: params.workGroup }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to start Athena query')
    }
    return {
      success: true,
      output: {
        queryExecutionId: data.output.queryExecutionId,
      },
    }
  },

  outputs: {
    queryExecutionId: {
      type: 'string',
      description: 'Unique ID of the started query execution',
    },
  },
}
