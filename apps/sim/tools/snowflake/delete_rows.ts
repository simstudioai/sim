import { createLogger } from '@/lib/logs/console/logger'
import type {
  SnowflakeDeleteRowsParams,
  SnowflakeDeleteRowsResponse,
} from '@/tools/snowflake/types'
import { parseAccountUrl } from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SnowflakeDeleteRowsTool')

/**
 * Build DELETE SQL statement from parameters
 */
function buildDeleteSQL(
  database: string,
  schema: string,
  table: string,
  whereClause?: string
): string {
  const fullTableName = `${database}.${schema}.${table}`

  let sql = `DELETE FROM ${fullTableName}`

  // Add WHERE clause if provided
  if (whereClause?.trim()) {
    sql += ` WHERE ${whereClause}`
  }

  return sql
}

export const snowflakeDeleteRowsTool: ToolConfig<
  SnowflakeDeleteRowsParams,
  SnowflakeDeleteRowsResponse
> = {
  id: 'snowflake_delete_rows',
  name: 'Snowflake Delete Rows',
  description: 'Delete rows from a Snowflake table',
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
      description: 'Table name',
    },
    whereClause: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'WHERE clause to filter rows to delete (e.g., "id = 123" or "status = \'inactive\' AND created_at < \'2024-01-01\'"). WARNING: If not provided, ALL rows will be deleted.',
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
    timeout: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Query timeout in seconds (default: 60)',
    },
  },

  request: {
    url: (params: SnowflakeDeleteRowsParams) => {
      const cleanUrl = parseAccountUrl(params.accountUrl)
      return `https://${cleanUrl}/api/v2/statements`
    },
    method: 'POST',
    headers: (params: SnowflakeDeleteRowsParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
      'X-Snowflake-Authorization-Token-Type': 'OAUTH',
    }),
    body: (params: SnowflakeDeleteRowsParams) => {
      // Build DELETE SQL
      const deleteSQL = buildDeleteSQL(
        params.database,
        params.schema,
        params.table,
        params.whereClause
      )

      logger.info('Building DELETE statement', {
        database: params.database,
        schema: params.schema,
        table: params.table,
        hasWhereClause: !!params.whereClause,
      })

      // Log warning if no WHERE clause provided
      if (!params.whereClause) {
        logger.warn('DELETE statement has no WHERE clause - ALL rows will be deleted', {
          table: `${params.database}.${params.schema}.${params.table}`,
        })
      }

      const requestBody: Record<string, any> = {
        statement: deleteSQL,
        timeout: params.timeout || 60,
        database: params.database,
        schema: params.schema,
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

  transformResponse: async (response: Response, params?: SnowflakeDeleteRowsParams) => {
    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to delete rows from Snowflake table', {
        status: response.status,
        errorText,
        table: params ? `${params.database}.${params.schema}.${params.table}` : 'unknown',
      })
      throw new Error(`Failed to delete rows: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    // Extract number of rows deleted from response
    const rowsDeleted = data.statementStatusUrl ? 'unknown' : 0

    return {
      success: true,
      output: {
        statementHandle: data.statementHandle,
        rowsDeleted,
        message: `Successfully deleted rows from ${params?.database}.${params?.schema}.${params?.table}`,
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
      description: 'Delete operation result',
    },
  },
}
