import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import type {
  SnowflakeExecuteQueryParams,
  SnowflakeExecuteQueryResponse,
} from '@/tools/snowflake/types'
import {
  executeSnowflakeStatement,
  extractColumnMetadata,
  extractResponseData,
  parseAccountUrl,
} from '@/tools/snowflake/utils'

const logger = createLogger('SnowflakeExecuteQueryTool')

export const snowflakeExecuteQueryTool: ToolConfig<
  SnowflakeExecuteQueryParams,
  SnowflakeExecuteQueryResponse
> = {
  id: 'snowflake_execute_query',
  name: 'Snowflake Execute Query',
  description: 'Execute a SQL query on your Snowflake data warehouse',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'snowflake',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Snowflake',
    },
    accountUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Your Snowflake account URL (e.g., xy12345.us-east-1.snowflakecomputing.com)',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SQL query to execute (SELECT, INSERT, UPDATE, DELETE, etc.)',
    },
    database: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Database to use for the query (optional)',
    },
    schema: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Schema to use for the query (optional)',
    },
    warehouse: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Warehouse to use for query execution (optional)',
    },
    role: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Role to use for query execution (optional)',
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Query timeout in seconds (default: 60)',
    },
  },

  request: {
    url: (params: SnowflakeExecuteQueryParams) => {
      const cleanUrl = parseAccountUrl(params.accountUrl)
      return `https://${cleanUrl}/api/v2/statements`
    },
    method: 'POST',
    headers: (params: SnowflakeExecuteQueryParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
      'X-Snowflake-Authorization-Token-Type': 'OAUTH',
    }),
    body: (params: SnowflakeExecuteQueryParams) => {
      const requestBody: any = {
        statement: params.query,
        timeout: params.timeout || 60,
      }

      if (params.database) {
        requestBody.database = params.database
      }

      if (params.schema) {
        requestBody.schema = params.schema
      }

      if (params.warehouse) {
        requestBody.warehouse = params.warehouse
      }

      if (params.role) {
        requestBody.role = params.role
      }

      return JSON.stringify(requestBody)
    },
  },

  transformResponse: async (response: Response, params?: SnowflakeExecuteQueryParams) => {
    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to execute Snowflake query', {
        status: response.status,
        errorText,
      })
      throw new Error(`Failed to execute query: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    const extractedData = extractResponseData(data)
    const columns = extractColumnMetadata(data)

    return {
      success: true,
      output: {
        statementHandle: data.statementHandle,
        data: extractedData,
        rowCount: extractedData.length,
        columns,
        message: data.message || 'Query executed successfully',
        ts: new Date().toISOString(),
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Operation success status',
    },
    output: {
      type: 'object',
      description: 'Query execution results and metadata',
    },
  },
}

