import type { RdsUpdateParams, RdsUpdateResponse } from '@/tools/rds/types'
import type { ToolConfig } from '@/tools/types'

export const updateTool: ToolConfig<RdsUpdateParams, RdsUpdateResponse> = {
  id: 'rds_update',
  name: 'RDS Update',
  description: 'Update data in an Amazon RDS table using the Data API',
  version: '1.0',

  params: {
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    accessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    resourceArn: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ARN of the Aurora DB cluster',
    },
    secretArn: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ARN of the Secrets Manager secret containing DB credentials',
    },
    database: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Database name to connect to',
    },
    table: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Table name to update',
    },
    data: {
      type: 'object',
      required: true,
      visibility: 'user-or-llm',
      description: 'Data to update as key-value pairs',
    },
    where: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'WHERE condition for the update',
    },
  },

  request: {
    url: '/api/tools/rds/update',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      resourceArn: params.resourceArn,
      secretArn: params.secretArn,
      database: params.database,
      table: params.table,
      data: params.data,
      where: params.where,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'RDS update failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Update executed successfully',
        rows: data.rows || [],
        rowCount: data.rowCount || 0,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    rows: { type: 'array', description: 'Array of updated rows' },
    rowCount: { type: 'number', description: 'Number of rows updated' },
  },
}
