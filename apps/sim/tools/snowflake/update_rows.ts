import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import type {
  SnowflakeUpdateRowsParams,
  SnowflakeUpdateRowsResponse,
} from '@/tools/snowflake/types'
import { extractResponseData, parseAccountUrl } from '@/tools/snowflake/utils'

const logger = createLogger('SnowflakeUpdateRowsTool')

/**
 * Build UPDATE SQL statement from parameters
 */
function buildUpdateSQL(
  database: string,
  schema: string,
  table: string,
  updates: Record<string, any>,
  whereClause?: string
): string {
  const fullTableName = `${database}.${schema}.${table}`
  
  // Build SET clause
  const setClause = Object.entries(updates)
    .map(([column, value]) => {
      let formattedValue: string
      
      if (value === null || value === undefined) {
        formattedValue = 'NULL'
      } else if (typeof value === 'string') {
        // Escape single quotes by doubling them
        formattedValue = `'${value.replace(/'/g, "''")}'`
      } else if (typeof value === 'boolean') {
        formattedValue = value ? 'TRUE' : 'FALSE'
      } else {
        formattedValue = String(value)
      }
      
      return `${column} = ${formattedValue}`
    })
    .join(', ')

  let sql = `UPDATE ${fullTableName} SET ${setClause}`
  
  // Add WHERE clause if provided
  if (whereClause && whereClause.trim()) {
    sql += ` WHERE ${whereClause}`
  }

  return sql
}

export const snowflakeUpdateRowsTool: ToolConfig<
  SnowflakeUpdateRowsParams,
  SnowflakeUpdateRowsResponse
> = {
  id: 'snowflake_update_rows',
  name: 'Snowflake Update Rows',
  description: 'Update rows in a Snowflake table',
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
      description: 'Schema name',
    },
    table: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Table name',
    },
    updates: {
      type: 'object',
      required: true,
      visibility: 'user-only',
      description:
        'Object containing column-value pairs to update (e.g., {"status": "active", "updated_at": "2024-01-01"})',
    },
    whereClause: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'WHERE clause to filter rows to update (e.g., "id = 123" or "status = \'pending\' AND created_at < \'2024-01-01\'"). If not provided, all rows will be updated.',
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
    url: (params: SnowflakeUpdateRowsParams) => {
      const cleanUrl = parseAccountUrl(params.accountUrl)
      return `https://${cleanUrl}/api/v2/statements`
    },
    method: 'POST',
    headers: (params: SnowflakeUpdateRowsParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
      'X-Snowflake-Authorization-Token-Type': 'OAUTH',
    }),
    body: (params: SnowflakeUpdateRowsParams) => {
      // Validate inputs
      if (!params.updates || typeof params.updates !== 'object' || Object.keys(params.updates).length === 0) {
        throw new Error('Updates must be a non-empty object with column-value pairs')
      }

      // Build UPDATE SQL
      const updateSQL = buildUpdateSQL(
        params.database,
        params.schema,
        params.table,
        params.updates,
        params.whereClause
      )

      logger.info('Building UPDATE statement', {
        database: params.database,
        schema: params.schema,
        table: params.table,
        updateColumnCount: Object.keys(params.updates).length,
        hasWhereClause: !!params.whereClause,
      })

      // Log warning if no WHERE clause provided
      if (!params.whereClause) {
        logger.warn('UPDATE statement has no WHERE clause - all rows will be updated', {
          table: `${params.database}.${params.schema}.${params.table}`,
        })
      }

      const requestBody: Record<string, any> = {
        statement: updateSQL,
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

  transformResponse: async (response: Response, params?: SnowflakeUpdateRowsParams) => {
    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to update rows in Snowflake table', {
        status: response.status,
        errorText,
        table: params ? `${params.database}.${params.schema}.${params.table}` : 'unknown',
      })
      throw new Error(`Failed to update rows: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    // Extract number of rows updated from response
    const rowsUpdated = data.statementStatusUrl ? 'unknown' : 0

    return {
      success: true,
      output: {
        statementHandle: data.statementHandle,
        rowsUpdated,
        message: `Successfully updated rows in ${params?.database}.${params?.schema}.${params?.table}`,
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
      description: 'Update operation result',
    },
  },
}

