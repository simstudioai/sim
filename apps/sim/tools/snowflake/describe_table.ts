import { createLogger } from '@/lib/logs/console/logger'
import type {
  SnowflakeDescribeTableParams,
  SnowflakeDescribeTableResponse,
} from '@/tools/snowflake/types'
import { extractResponseData, parseAccountUrl } from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SnowflakeDescribeTableTool')

export const snowflakeDescribeTableTool: ToolConfig<
  SnowflakeDescribeTableParams,
  SnowflakeDescribeTableResponse
> = {
  id: 'snowflake_describe_table',
  name: 'Snowflake Describe Table',
  description: 'Get the schema and structure of a Snowflake table',
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
      description: 'Your Snowflake account URL (e.g., xy12345.us-east-1.snowflakecomputing.com)',
    },
    database: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Database name',
    },
    schema: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Schema name',
    },
    table: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Table name to describe',
    },
    warehouse: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Warehouse to use (optional)',
    },
    role: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Role to use (optional)',
    },
  },

  request: {
    url: (params: SnowflakeDescribeTableParams) => {
      const cleanUrl = parseAccountUrl(params.accountUrl)
      return `https://${cleanUrl}/api/v2/statements`
    },
    method: 'POST',
    headers: (params: SnowflakeDescribeTableParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
      'X-Snowflake-Authorization-Token-Type': 'OAUTH',
    }),
    body: (params: SnowflakeDescribeTableParams) => {
      const requestBody: any = {
        statement: `DESCRIBE TABLE ${params.database}.${params.schema}.${params.table}`,
        timeout: 60,
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

  transformResponse: async (response: Response, params?: SnowflakeDescribeTableParams) => {
    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to describe Snowflake table', {
        status: response.status,
        errorText,
      })
      throw new Error(`Failed to describe table: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const extractedData = extractResponseData(data)

    return {
      success: true,
      output: {
        columns: extractedData,
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
      description: 'Table column definitions and metadata',
    },
  },
}
