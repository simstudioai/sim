import type { RdsExecuteParams, RdsExecuteResponse } from '@/tools/rds/types'
import type { ToolConfig } from '@/tools/types'

export const executeTool: ToolConfig<RdsExecuteParams, RdsExecuteResponse> = {
  id: 'rds_execute',
  name: 'RDS Execute',
  description: 'Execute raw SQL on Amazon RDS using the Data API',
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
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Raw SQL query to execute (e.g., CREATE TABLE users (id SERIAL PRIMARY KEY, name VARCHAR(255)))',
    },
  },

  request: {
    url: '/api/tools/rds/execute',
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
      query: params.query,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'RDS execute failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Query executed successfully',
        rows: data.rows || [],
        rowCount: data.rowCount || 0,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    rows: { type: 'array', description: 'Array of rows returned or affected' },
    rowCount: { type: 'number', description: 'Number of rows affected' },
  },
}
