import { createLogger } from '@/lib/logs/console/logger'
import type {
  SnowflakeListSchemasParams,
  SnowflakeListSchemasResponse,
} from '@/tools/snowflake/types'
import { extractResponseData, parseAccountUrl } from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SnowflakeListSchemasTool')

export const snowflakeListSchemasTool: ToolConfig<
  SnowflakeListSchemasParams,
  SnowflakeListSchemasResponse
> = {
  id: 'snowflake_list_schemas',
  name: 'Snowflake List Schemas',
  description: 'List all schemas in a Snowflake database',
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
      description: 'Database name to list schemas from',
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
    url: (params: SnowflakeListSchemasParams) => {
      const cleanUrl = parseAccountUrl(params.accountUrl)
      return `https://${cleanUrl}/api/v2/statements`
    },
    method: 'POST',
    headers: (params: SnowflakeListSchemasParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
      'X-Snowflake-Authorization-Token-Type': 'OAUTH',
    }),
    body: (params: SnowflakeListSchemasParams) => {
      const requestBody: any = {
        statement: `SHOW SCHEMAS IN DATABASE ${params.database}`,
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

  transformResponse: async (response: Response, params?: SnowflakeListSchemasParams) => {
    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to list Snowflake schemas', {
        status: response.status,
        errorText,
      })
      throw new Error(`Failed to list schemas: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const extractedData = extractResponseData(data)

    return {
      success: true,
      output: {
        schemas: extractedData,
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
      description: 'List of schemas and metadata',
    },
  },
}
