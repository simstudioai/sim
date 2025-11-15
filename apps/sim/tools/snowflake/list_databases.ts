import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import type {
  SnowflakeListDatabasesParams,
  SnowflakeListDatabasesResponse,
} from '@/tools/snowflake/types'
import { extractResponseData, parseAccountUrl } from '@/tools/snowflake/utils'

const logger = createLogger('SnowflakeListDatabasesTool')

export const snowflakeListDatabasesTool: ToolConfig<
  SnowflakeListDatabasesParams,
  SnowflakeListDatabasesResponse
> = {
  id: 'snowflake_list_databases',
  name: 'Snowflake List Databases',
  description: 'List all databases in your Snowflake account',
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
    url: (params: SnowflakeListDatabasesParams) => {
      const cleanUrl = parseAccountUrl(params.accountUrl)
      return `https://${cleanUrl}/api/v2/statements`
    },
    method: 'POST',
    headers: (params: SnowflakeListDatabasesParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
      'X-Snowflake-Authorization-Token-Type': 'OAUTH',
    }),
    body: (params: SnowflakeListDatabasesParams) => {
      const requestBody: any = {
        statement: 'SHOW DATABASES',
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

  transformResponse: async (response: Response, params?: SnowflakeListDatabasesParams) => {
    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to list Snowflake databases', {
        status: response.status,
        errorText,
      })
      throw new Error(`Failed to list databases: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const extractedData = extractResponseData(data)

    return {
      success: true,
      output: {
        databases: extractedData,
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
      description: 'List of databases and metadata',
    },
  },
}

