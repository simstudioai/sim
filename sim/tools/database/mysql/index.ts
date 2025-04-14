import { ToolConfig } from '../../types'
import { MySQLQueryParams, MySQLResponse } from './types'
import { getDatabaseApiUrl } from '../../utils'

const API_URL = getDatabaseApiUrl('mysql')

const toolConfig: ToolConfig<MySQLQueryParams, MySQLResponse> = {
  id: 'mysql',
  name: 'MySQL',
  description: 'Execute MySQL operations on your database',
  version: '1.0.0',
  params: {
    connection: {
      type: 'json',
      required: true,
      description: 'MySQL connection configuration'
    },
    operation: {
      type: 'string',
      required: true,
      description: 'SQL operation to perform'
    },
    query: {
      type: 'string',
      required: true,
      description: 'SQL query to execute'
    },
    params: {
      type: 'json',
      required: false,
      description: 'Query parameters for parameterized queries'
    },
    options: {
      type: 'json',
      required: false,
      description: 'Additional options for the operation'
    }
  },
  request: {
    url: API_URL,
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json'
    }),
    body: (params) => params
  },
  directExecution: async (params) => {
    const startTime = Date.now()
    
    try {
      console.log('[MySQL Tool] Starting execution with params:', {
        ...params,
        connection: {
          ...params.connection,
          password: '[REDACTED]'
        }
      })

      // Basic query validation
      if (!params.query || params.query.trim() === '') {
        throw new Error('SQL query cannot be empty')
      }

      // Check for common SQL syntax issues
      const query = params.query.trim().toLowerCase()
      if (query.startsWith('select') && !query.includes('from')) {
        throw new Error('SQL Error: SELECT statement must include a FROM clause')
      }
      if (query.startsWith('insert') && !query.includes('into')) {
        throw new Error('SQL Error: INSERT statement must include INTO clause')
      }
      if (query.startsWith('update') && !query.includes('set')) {
        throw new Error('SQL Error: UPDATE statement must include SET clause')
      }
      if (query.startsWith('delete') && !query.includes('from')) {
        throw new Error('SQL Error: DELETE statement must include FROM clause')
      }

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(params)
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[MySQL Tool] API error response:', errorText)
        // Try to parse the error as JSON to get the MySQL error message
        try {
          const errorJson = JSON.parse(errorText)
          // Extract specific MySQL error details
          const errorMessage = errorJson.message || errorJson.error || errorText
          const errorCode = errorJson.code || ''
          const errorSqlState = errorJson.sqlState || ''
          const errorSqlMessage = errorJson.sqlMessage || ''
          
          throw new Error(`MySQL Error: ${errorMessage}${errorCode ? ` (${errorCode})` : ''}${errorSqlState ? ` [${errorSqlState}]` : ''}${errorSqlMessage ? ` - ${errorSqlMessage}` : ''}`)
        } catch (e) {
          throw new Error(`Database error: ${errorText}`)
        }
      }

      const result = await response.json()
      console.log('[MySQL Tool] API response result:', {
        ...result,
        rows: result.rows ? `[${result.rows.length} rows]` : undefined,
        fields: result.fields ? `[${result.fields.length} fields]` : undefined
      })

      return {
        success: true,
        output: {
          rows: result.rows || [],
          affectedRows: result.affectedRows || 0,
          fields: result.fields || [],
          executionTime: Date.now() - startTime
        },
        timing: {
          startTime: new Date(startTime).toISOString(),
          endTime: new Date().toISOString(),
          duration: Date.now() - startTime
        }
      }
    } catch (error) {
      console.error('[MySQL Tool] Error during execution:', error)
      
      // Format the error message to be more user-friendly
      let errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      
      // Add query context to the error
      if (params.query) {
        errorMessage = `${errorMessage}\n\nQuery: ${params.query}`
      }
      
      return {
        success: false,
        output: {
          rows: [],
          affectedRows: 0,
          fields: [],
          executionTime: Date.now() - startTime
        },
        error: errorMessage,
        timing: {
          startTime: new Date(startTime).toISOString(),
          endTime: new Date().toISOString(),
          duration: Date.now() - startTime
        }
      }
    }
  },
  transformResponse: async (response, params) => {
    const startTime = Date.now()
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error('[MySQL Tool] API error response:', errorText)
      
      try {
        const errorJson = JSON.parse(errorText)
        // Extract specific MySQL error details
        const errorMessage = errorJson.message || errorJson.error || errorText
        const errorCode = errorJson.code || ''
        const errorSqlState = errorJson.sqlState || ''
        const errorSqlMessage = errorJson.sqlMessage || ''
        
        return {
          success: false,
          output: {
            rows: [],
            affectedRows: 0,
            fields: [],
            executionTime: Date.now() - startTime
          },
          error: `MySQL Error: ${errorMessage}${errorCode ? ` (${errorCode})` : ''}${errorSqlState ? ` [${errorSqlState}]` : ''}${errorSqlMessage ? ` - ${errorSqlMessage}` : ''}`,
          timing: {
            startTime: new Date(startTime).toISOString(),
            endTime: new Date().toISOString(),
            duration: Date.now() - startTime
          }
        }
      } catch (e) {
        return {
          success: false,
          output: {
            rows: [],
            affectedRows: 0,
            fields: [],
            executionTime: Date.now() - startTime
          },
          error: `Database error: ${errorText}`,
          timing: {
            startTime: new Date(startTime).toISOString(),
            endTime: new Date().toISOString(),
            duration: Date.now() - startTime
          }
        }
      }
    }
    
    const result = await response.json()
    console.log('[MySQL Tool] API response result:', {
      ...result,
      rows: result.rows ? `[${result.rows.length} rows]` : undefined,
      fields: result.fields ? `[${result.fields.length} fields]` : undefined
    })
    
    return {
      success: true,
      output: {
        rows: result.rows || [],
        affectedRows: result.affectedRows || 0,
        fields: result.fields || [],
        executionTime: Date.now() - startTime
      },
      timing: {
        startTime: new Date(startTime).toISOString(),
        endTime: new Date().toISOString(),
        duration: Date.now() - startTime
      }
    }
  },
  transformError: (error) => {
    console.error('[MySQL Tool] Error during execution:', error)
    
    // Format the error message to be more user-friendly
    let errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    
    return Promise.resolve({
      success: false,
      output: {
        rows: [],
        affectedRows: 0,
        fields: [],
        executionTime: 0
      },
      error: errorMessage,
      timing: {
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        duration: 0
      }
    })
  }
}

export default toolConfig 