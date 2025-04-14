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
      console.log('[PostgreSQL Tool] Starting execution with params:', {
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
      console.log('[PostgreSQL Tool] API response result:', result)

      return {
        success: true,
        output: {
          rows: result.rows || [],
          rowCount: result.rowCount || 0,
          fields: result.fields || []
        }
      }
    } catch (error) {
      console.error('[PostgreSQL Tool] Error during execution:', error)
      
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
          rowCount: 0,
          fields: []
        },
        error: errorMessage
      }
    }
  }
}

export default toolConfig 