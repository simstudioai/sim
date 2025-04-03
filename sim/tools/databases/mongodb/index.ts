import { ToolConfig } from '../../types'
import { MongoDBQueryParams, MongoDBResponse } from './types'
import { getDatabaseApiUrl } from '../../utils'

const API_URL = getDatabaseApiUrl('mongodb')

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
      description: 'Collection name'
    },
    query: {
      type: 'json',
      required: false,
      description: 'Query filter'
    },
    projection: {
      type: 'json',
      required: false,
      description: 'Projection fields'
    },
    document: {
      type: 'json',
      required: false,
      description: 'Document to insert'
    },
    update: {
      type: 'json',
      required: false,
      description: 'Update operation'
    },
    pipeline: {
      type: 'json',
      required: false,
      description: 'Aggregation pipeline'
    },
    options: {
      type: 'json',
      required: false,
      description: 'Operation options'
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
      console.log('[MongoDB Tool] Starting execution with params:', {
        ...params,
        connection: {
          ...params.connection,
          password: '[REDACTED]'
        }
      })

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(params)
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[MongoDB Tool] API error response:', errorText)
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`)
      }

      const result = await response.json()
      console.log('[MongoDB Tool] API response result:', result)

      return {
        success: true,
        output: {
          result: JSON.stringify(result.data || []),
          affectedCount: JSON.stringify(result.affectedCount || 0),
          metadata: JSON.stringify({
            operation: params.operation,
            collection: params.collection,
            executionTime: Date.now() - startTime,
            fields: result.fields || []
          })
        }
      }
    } catch (error) {
      console.error('[MongoDB Tool] Error during execution:', error)
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