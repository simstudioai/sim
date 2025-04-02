import { ToolConfig } from '../types'
import { PostgreSQLQueryParams, PostgreSQLResponse } from './types'

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
    url: 'http://localhost:3000/api/postgresql',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json'
    }),
    body: (params) => ({
      connection: {
        host: params.host || 'localhost',
        port: parseInt(params.port || '5432'),
        username: params.username || 'postgres',
        password: params.password || 'postgres',
        database: params.database || 'simstudio',
        ssl: params.ssl === 'true'
      },
      operation: params.operation,
      query: params.query,
      params: params.params,
      options: params.options
    })
  },
  directExecution: async (params) => {
    const startTime = Date.now()
    
    try {
      console.log('[PostgreSQL Tool] Starting execution with params:', {
        ...params,
        password: '[REDACTED]'
      })

      const requestBody = {
        connection: {
          host: params.host || 'localhost',
          port: parseInt(params.port || '5432'),
          username: params.username || 'postgres',
          password: params.password || 'postgres',
          database: params.database || 'simstudio',
          ssl: params.ssl === 'true'
        },
        operation: params.operation,
        query: params.query,
        params: params.params,
        options: params.options
      }

      console.log('[PostgreSQL Tool] Making API request to:', 'http://localhost:3000/api/postgresql')
      
      const response = await fetch('http://localhost:3000/api/postgresql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      })

      console.log('[PostgreSQL Tool] API response status:', response.status)

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[PostgreSQL Tool] API error response:', errorText)
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`)
      }

      const result = await response.json()
      console.log('[PostgreSQL Tool] API response result:', result)

      return {
        success: true,
        output: {
          rows: JSON.stringify(result.rows || []),
          affectedRows: JSON.stringify(result.rowCount || 0),
          metadata: JSON.stringify({
            operation: params.operation,
            query: params.query,
            executionTime: Date.now() - startTime,
            fields: result.fields || []
          })
        }
      }
    } catch (error) {
      console.error('[PostgreSQL Tool] Error during execution:', error)
      return {
        success: false,
        output: {
          rows: '[]',
          affectedRows: '0',
          metadata: JSON.stringify({
            operation: params.operation,
            query: params.query,
            executionTime: Date.now() - startTime
          })
        },
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }
}

export default toolConfig 