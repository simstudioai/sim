import { ToolConfig } from '../../types'
import { PostgreSQLQueryParams, PostgreSQLResponse } from './types'
import { getDatabaseApiUrl } from '../../utils'

const API_URL = getDatabaseApiUrl('postgresql')

const toolConfig: ToolConfig<PostgreSQLQueryParams, PostgreSQLResponse> = {
  id: 'postgresql',
  name: 'PostgreSQL',
  description: 'Execute PostgreSQL operations on your database',
  version: '1.0.0',
  params: {
    connection: {
      type: 'json',
      required: true,
      description: 'PostgreSQL connection configuration'
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
      // Sanitize sensitive information before logging
      const sanitizedParams = {
        connection: params.connection ? {
          host: params.connection.host,
          port: params.connection.port,
          user: '[REDACTED]',
          password: '[REDACTED]',
          database: params.connection.database,
          ssl: params.connection.ssl,
          schema: params.connection.schema
        } : undefined,
        operation: params.operation,
        query: params.query,
        // Don't log actual parameter values as they might contain sensitive data
        params: params.params ? '[REDACTED]' : undefined,
        options: params.options ? {
          timeout: params.options.timeout,
          maxRows: params.options.maxRows,
          fetchSize: params.options.fetchSize
        } : undefined
      }

      console.log('[PostgreSQL Tool] Starting execution with params:', sanitizedParams)

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
        console.error('[PostgreSQL Tool] API error response:', errorText)
        // Try to parse the error as JSON to get the SQL error message
        try {
          const errorJson = JSON.parse(errorText)
          // Extract specific PostgreSQL error details
          const errorMessage = errorJson.message || errorJson.error || errorText
          const errorDetail = errorJson.detail || ''
          const errorHint = errorJson.hint ? `\nHint: ${errorJson.hint}` : ''
          const errorPosition = errorJson.position ? `\nPosition: ${errorJson.position}` : ''
          const errorWhere = errorJson.where ? `\nContext: ${errorJson.where}` : ''
          
          throw new Error(`PostgreSQL Error: ${errorMessage}${errorDetail}${errorHint}${errorPosition}${errorWhere}`)
        } catch (e) {
          throw new Error(`Database error: ${errorText}`)
        }
      }

      const result = await response.json()
      // Log sanitized response without sensitive data
      console.log('[PostgreSQL Tool] API response result:', {
        ...result,
        rows: result.rows ? `[${result.rows.length} rows]` : undefined,
        fields: result.fields ? `[${result.fields.length} fields]` : undefined
      })

      const executionTime = Date.now() - startTime
      return {
        success: true,
        output: {
          rows: result.rows || [],
          rowCount: result.rowCount || 0,
          fields: result.fields || [],
          executionTime
        },
        metadata: {
          startTime: new Date(startTime).toISOString(),
          endTime: new Date().toISOString(),
          duration: executionTime,
          rowCount: result.rowCount || 0,
          fieldCount: result.fields?.length || 0
        },
        timing: {
          startTime: new Date(startTime).toISOString(),
          endTime: new Date().toISOString(),
          duration: executionTime
        }
      }
    } catch (error) {
      console.error('[PostgreSQL Tool] Error during execution:', error)
      
      // Format the error message to be more user-friendly
      let errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      
      // Add query context to the error if available
      if (params?.query) {
        errorMessage = `${errorMessage}\n\nQuery: ${params.query}`
      }

      const executionTime = Date.now() - startTime
      return {
        success: false,
        output: {
          rows: [],
          rowCount: 0,
          fields: [],
          executionTime
        },
        error: errorMessage,
        metadata: {
          startTime: new Date(startTime).toISOString(),
          endTime: new Date().toISOString(),
          duration: executionTime,
          rowCount: 0,
          fieldCount: 0,
          error: errorMessage
        },
        timing: {
          startTime: new Date(startTime).toISOString(),
          endTime: new Date().toISOString(),
          duration: executionTime
        }
      }
    }
  },
  transformResponse: async (response, params) => {
    const startTime = Date.now()
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error('[PostgreSQL Tool] API error response:', errorText)
      
      try {
        const errorJson = JSON.parse(errorText)
        // Extract specific PostgreSQL error details
        const errorMessage = errorJson.message || errorJson.error || errorText
        const errorDetail = errorJson.detail || ''
        const errorHint = errorJson.hint ? `\nHint: ${errorJson.hint}` : ''
        const errorPosition = errorJson.position ? `\nPosition: ${errorJson.position}` : ''
        const errorWhere = errorJson.where ? `\nContext: ${errorJson.where}` : ''
        
        return {
          success: false,
          output: {
            rows: [],
            rowCount: 0,
            fields: [],
            executionTime: Date.now() - startTime
          },
          error: `PostgreSQL Error: ${errorMessage}${errorDetail}${errorHint}${errorPosition}${errorWhere}`,
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
            rowCount: 0,
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
    console.log('[PostgreSQL Tool] API response result:', result)
    
    return {
      success: true,
      output: {
        rows: result.rows || [],
        rowCount: result.rowCount || 0,
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
    console.error('[PostgreSQL Tool] Error during execution:', error)
    
    // Format the error message to be more user-friendly
    let errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    
    return Promise.resolve({
      success: false,
      output: {
        rows: [],
        rowCount: 0,
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