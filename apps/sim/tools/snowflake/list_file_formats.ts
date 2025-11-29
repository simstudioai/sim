import { createLogger } from '@/lib/logs/console/logger'
import type {
  SnowflakeListFileFormatsParams,
  SnowflakeListFileFormatsResponse,
} from '@/tools/snowflake/types'
import { extractResponseData, parseAccountUrl } from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SnowflakeListFileFormatsTool')

export const snowflakeListFileFormatsTool: ToolConfig<
  SnowflakeListFileFormatsParams,
  SnowflakeListFileFormatsResponse
> = {
  id: 'snowflake_list_file_formats',
  name: 'Snowflake List File Formats',
  description: 'List all file formats in a Snowflake schema',
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
      description: 'Schema name to list file formats from',
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
    url: (params: SnowflakeListFileFormatsParams) => {
      const cleanUrl = parseAccountUrl(params.accountUrl)
      return `https://${cleanUrl}/api/v2/statements`
    },
    method: 'POST',
    headers: (params: SnowflakeListFileFormatsParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
      'X-Snowflake-Authorization-Token-Type': 'OAUTH',
    }),
    body: (params: SnowflakeListFileFormatsParams) => {
      const requestBody: Record<string, any> = {
        statement: `SHOW FILE FORMATS IN ${params.database}.${params.schema}`,
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

  transformResponse: async (response: Response, params?: SnowflakeListFileFormatsParams) => {
    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to list Snowflake file formats', {
        status: response.status,
        errorText,
      })
      throw new Error(`Failed to list file formats: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const extractedData = extractResponseData(data)

    return {
      success: true,
      output: {
        fileFormats: extractedData,
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
      description: 'List of file formats and metadata',
    },
  },
}
