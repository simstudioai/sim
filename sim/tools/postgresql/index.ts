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
    body: (params) => params
  },
  directExecution: async (params) => {
    const startTime = Date.now()
    
    try {
      // Instead of direct PostgreSQL connection, we'll make an HTTP request to your PostgreSQL API
      const response = await fetch('http://localhost:3000/api/postgresql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(params)
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const result = await response.json()

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