import type { RdsDeleteParams, RdsDeleteResponse } from '@/tools/rds/types'
import type { ToolConfig } from '@/tools/types'

export const deleteTool: ToolConfig<RdsDeleteParams, RdsDeleteResponse> = {
  id: 'rds_delete',
  name: 'RDS Delete',
  description: 'Delete data from an Amazon RDS table using the Data API',
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
      visibility: 'user-or-llm',
      description:
        'ARN of the Aurora DB cluster (e.g., arn:aws:rds:us-east-1:123456789012:cluster:my-cluster)',
    },
    secretArn: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ARN of the Secrets Manager secret containing DB credentials',
    },
    database: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Database name to connect to (e.g., mydb, production_db)',
    },
    table: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Table name to delete from',
    },
    conditions: {
      type: 'object',
      required: true,
      visibility: 'user-or-llm',
      description: 'Conditions for the delete (e.g., {"id": 1})',
    },
  },

  request: {
    url: '/api/tools/rds/delete',
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
      ...(params.database && { database: params.database }),
      table: params.table,
      conditions: params.conditions,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'RDS delete failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Delete executed successfully',
        rows: data.rows || [],
        rowCount: data.rowCount || 0,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    rows: { type: 'array', description: 'Array of deleted rows' },
    rowCount: { type: 'number', description: 'Number of rows deleted' },
  },
}
