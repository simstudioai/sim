import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import type {
  SnowflakeListTablesParams,
  SnowflakeListTablesResponse,
} from '@/tools/snowflake/types'
import { extractResponseData, parseAccountUrl } from '@/tools/snowflake/utils'

const logger = createLogger('SnowflakeListTablesTool')

export const snowflakeListTablesTool: ToolConfig<
  SnowflakeListTablesParams,
  SnowflakeListTablesResponse
> = {
  id: 'snowflake_list_tables',
  name: 'Snowflake List Tables',
  description: 'List all tables in a Snowflake schema',
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
      description: 'Schema name to list tables from',
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
    url: (params: SnowflakeListTablesParams) => {
      const cleanUrl = parseAccountUrl(params.accountUrl)
      return `https://${cleanUrl}/api/v2/statements`
    },
    method: 'POST',
    headers: (params: SnowflakeListTablesParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
      'X-Snowflake-Authorization-Token-Type': 'OAUTH',
    }),
    body: (params: SnowflakeListTablesParams) => {
      const requestBody: any = {
        statement: `SHOW TABLES IN ${params.database}.${params.schema}`,
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

  transformResponse: async (response: Response, params?: SnowflakeListTablesParams) => {
    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to list Snowflake tables', {
        status: response.status,
        errorText,
      })
      throw new Error(`Failed to list tables: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const extractedData = extractResponseData(data)

    return {
      success: true,
      output: {
        tables: extractedData,
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
      description: 'List of tables and metadata',
    },
  },
}

