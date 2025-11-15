import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import type {
  SnowflakeInsertRowsParams,
  SnowflakeInsertRowsResponse,
} from '@/tools/snowflake/types'
import { extractResponseData, parseAccountUrl } from '@/tools/snowflake/utils'

const logger = createLogger('SnowflakeInsertRowsTool')

/**
 * Build INSERT SQL statement from parameters
 */
function buildInsertSQL(
  database: string,
  schema: string,
  table: string,
  columns: string[],
  values: any[][]
): string {
  const fullTableName = `${database}.${schema}.${table}`
  const columnList = columns.join(', ')
  
  // Build values clause for multiple rows
  const valuesClause = values
    .map((rowValues) => {
      const formattedValues = rowValues.map((val) => {
        if (val === null || val === undefined) {
          return 'NULL'
        }
        if (typeof val === 'string') {
          // Escape single quotes by doubling them
          return `'${val.replace(/'/g, "''")}'`
        }
        if (typeof val === 'boolean') {
          return val ? 'TRUE' : 'FALSE'
        }
        return String(val)
      })
      return `(${formattedValues.join(', ')})`
    })
    .join(', ')

  return `INSERT INTO ${fullTableName} (${columnList}) VALUES ${valuesClause}`
}

export const snowflakeInsertRowsTool: ToolConfig<
  SnowflakeInsertRowsParams,
  SnowflakeInsertRowsResponse
> = {
  id: 'snowflake_insert_rows',
  name: 'Snowflake Insert Rows',
  description: 'Insert rows into a Snowflake table',
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
    columns: {
      type: 'array',
      required: true,
      visibility: 'user-only',
      description: 'Array of column names to insert data into',
    },
    values: {
      type: 'array',
      required: true,
      visibility: 'user-only',
      description:
        'Array of arrays containing values to insert. Each inner array represents one row and must match the order of columns.',
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
    url: (params: SnowflakeInsertRowsParams) => {
      const cleanUrl = parseAccountUrl(params.accountUrl)
      return `https://${cleanUrl}/api/v2/statements`
    },
    method: 'POST',
    headers: (params: SnowflakeInsertRowsParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
      'X-Snowflake-Authorization-Token-Type': 'OAUTH',
    }),
    body: (params: SnowflakeInsertRowsParams) => {
      // Validate inputs
      if (!Array.isArray(params.columns) || params.columns.length === 0) {
        throw new Error('Columns must be a non-empty array')
      }

      if (!Array.isArray(params.values) || params.values.length === 0) {
        throw new Error('Values must be a non-empty array')
      }

      // Validate each row has correct number of values
      for (let i = 0; i < params.values.length; i++) {
        if (!Array.isArray(params.values[i])) {
          throw new Error(`Values row ${i} must be an array`)
        }
        if (params.values[i].length !== params.columns.length) {
          throw new Error(
            `Values row ${i} has ${params.values[i].length} values but ${params.columns.length} columns were specified`
          )
        }
      }

      // Build INSERT SQL
      const insertSQL = buildInsertSQL(
        params.database,
        params.schema,
        params.table,
        params.columns,
        params.values
      )

      logger.info('Building INSERT statement', {
        database: params.database,
        schema: params.schema,
        table: params.table,
        columnCount: params.columns.length,
        rowCount: params.values.length,
      })

      const requestBody: Record<string, any> = {
        statement: insertSQL,
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

  transformResponse: async (response: Response, params?: SnowflakeInsertRowsParams) => {
    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to insert rows into Snowflake table', {
        status: response.status,
        errorText,
        table: params ? `${params.database}.${params.schema}.${params.table}` : 'unknown',
      })
      throw new Error(`Failed to insert rows: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    // Get number of rows inserted from response
    const rowsInserted = data.statementStatusUrl ? params?.values.length || 0 : 0

    return {
      success: true,
      output: {
        statementHandle: data.statementHandle,
        rowsInserted,
        message: `Successfully inserted ${rowsInserted} row(s) into ${params?.database}.${params?.schema}.${params?.table}`,
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
      description: 'Insert operation result with row count',
    },
  },
}

