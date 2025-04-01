import { ToolConfig } from '../types'
import { RedisResponse } from './types'

const toolConfig: ToolConfig<any, RedisResponse> = {
  id: 'redis',
  name: 'Redis',
  description: 'Execute Redis operations on your database',
  version: '1.0.0',
  params: {
    connection: {
      type: 'json',
      required: true,
      description: 'Redis connection configuration'
    },
    operation: {
      type: 'string',
      required: true,
      description: 'Redis operation to perform'
    },
    key: {
      type: 'string',
      required: true,
      description: 'Redis key for the operation'
    },
    value: {
      type: 'string',
      required: false,
      description: 'Value for set operations'
    },
    ttl: {
      type: 'number',
      required: false,
      description: 'Time to live in seconds'
    },
    options: {
      type: 'json',
      required: false,
      description: 'Additional options for the operation'
    }
  },
  request: {
    url: 'http://localhost:3000/api/redis',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json'
    }),
    body: (params) => params
  },
  directExecution: async (params) => {
    const startTime = Date.now()
    
    try {
      const response = await fetch('http://localhost:3000/api/redis', {
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
          result: JSON.stringify(result.value || null),
          metadata: JSON.stringify({
            operation: params.operation,
            key: params.key,
            executionTime: Date.now() - startTime
          })
        }
      }
    } catch (error) {
      return {
        success: false,
        output: {
          result: 'null',
          metadata: JSON.stringify({
            operation: params.operation,
            key: params.key,
            executionTime: Date.now() - startTime
          })
        },
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }
}

export default toolConfig 