import { ToolConfig } from '../types'
import { MongoDBQueryParams, MongoDBResponse } from './types'

const toolConfig: ToolConfig<MongoDBQueryParams, MongoDBResponse> = {
  id: 'mongodb',
  name: 'MongoDB',
  description: 'Execute MongoDB operations on your database',
  version: '1.0.0',
  params: {
    connection: {
      type: 'json',
      required: true,
      description: 'MongoDB connection configuration'
    },
    operation: {
      type: 'string',
      required: true,
      description: 'MongoDB operation to perform'
    },
    collection: {
      type: 'string',
      required: true,
      description: 'Collection name to operate on'
    },
    query: {
      type: 'json',
      required: false,
      description: 'Query/filter for the operation'
    },
    update: {
      type: 'json',
      required: false,
      description: 'Update document for update operations'
    },
    options: {
      type: 'json',
      required: false,
      description: 'Additional options for the operation'
    }
  },
  request: {
    url: 'http://localhost:3000/api/mongodb',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json'
    }),
    body: (params) => params
  },
  directExecution: async (params) => {
    const startTime = Date.now()
    
    try {
      // Instead of direct MongoDB connection, we'll make an HTTP request to your MongoDB API
      const response = await fetch('http://localhost:3000/api/mongodb', {
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
          result: JSON.stringify(result.data),
          affectedCount: JSON.stringify(result.affectedCount || 0),
          metadata: JSON.stringify({
            operation: params.operation,
            collection: params.collection,
            executionTime: Date.now() - startTime
          })
        }
      }
    } catch (error) {
      return {
        success: false,
        output: {
          result: '[]',
          affectedCount: '0',
          metadata: JSON.stringify({
            operation: params.operation,
            collection: params.collection,
            executionTime: Date.now() - startTime
          })
        },
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }
}

export default toolConfig 