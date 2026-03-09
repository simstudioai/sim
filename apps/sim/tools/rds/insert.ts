import type { RdsInsertParams, RdsInsertResponse } from '@/tools/rds/types'
import type { ToolConfig } from '@/tools/types'

export const insertTool: ToolConfig<RdsInsertParams, RdsInsertResponse> = {
  id: 'rds_insert',
  name: 'RDS Insert',
  description: 'Insert data into an Amazon RDS table using the Data API',
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
      description: 'Table name to insert into',
    },
    data: {
      type: 'object',
      required: true,
      visibility: 'user-or-llm',
      description: 'Data to insert as key-value pairs',
    },
  },

  request: {
    url: '/api/tools/rds/insert',
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
      data: params.data,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'RDS insert failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Insert executed successfully',
        rows: data.rows || [],
        rowCount: data.rowCount || 0,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    rows: { type: 'array', description: 'Array of inserted rows' },
    rowCount: { type: 'number', description: 'Number of rows inserted' },
  },
}
