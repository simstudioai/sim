import { createLogger } from '@/lib/logs/console/logger'
import type {
  SnowflakeListWarehousesParams,
  SnowflakeListWarehousesResponse,
} from '@/tools/snowflake/types'
import { extractResponseData, parseAccountUrl } from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SnowflakeListWarehousesTool')

export const snowflakeListWarehousesTool: ToolConfig<
  SnowflakeListWarehousesParams,
  SnowflakeListWarehousesResponse
> = {
  id: 'snowflake_list_warehouses',
  name: 'Snowflake List Warehouses',
  description: 'List all warehouses in the Snowflake account',
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
    url: (params: SnowflakeListWarehousesParams) => {
      const cleanUrl = parseAccountUrl(params.accountUrl)
      return `https://${cleanUrl}/api/v2/statements`
    },
    method: 'POST',
    headers: (params: SnowflakeListWarehousesParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
      'X-Snowflake-Authorization-Token-Type': 'OAUTH',
    }),
    body: (params: SnowflakeListWarehousesParams) => {
      const requestBody: Record<string, any> = {
        statement: 'SHOW WAREHOUSES',
        timeout: 60,
      }

      if (params.warehouse) {
        requestBody.warehouse = params.warehouse
      }

      if (params.role) {
        requestBody.role = params.role
      }

      return requestBody
    },
  },

  transformResponse: async (response: Response, params?: SnowflakeListWarehousesParams) => {
    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to list Snowflake warehouses', {
        status: response.status,
        errorText,
      })
      throw new Error(`Failed to list warehouses: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const extractedData = extractResponseData(data)

    return {
      success: true,
      output: {
        warehouses: extractedData,
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
      description: 'List of warehouses and metadata',
    },
  },
}
