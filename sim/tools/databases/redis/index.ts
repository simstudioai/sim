import { ToolConfig } from '../../types'
import { RedisResponse } from './types'
import { getDatabaseApiUrl } from '../../utils'

const API_URL = getDatabaseApiUrl('redis')

const toolConfig: ToolConfig<any, RedisResponse> = {
  id: 'redis',
  name: 'Redis',
  description: 'Execute Redis operations on your database',
  version: '1.0.0',
  params: {
    host: {
      type: 'string',
      required: true,
      description: 'Redis server hostname'
    },
    port: {
      type: 'string',
      required: true,
      description: 'Redis server port'
    },
    password: {
      type: 'string',
      required: true,
      description: 'Redis server password'
    },
    db: {
      type: 'string',
      required: true,
      description: 'Redis database number'
    },
    tls: {
      type: 'boolean',
      required: true,
      description: 'Whether to use TLS'
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
    url: API_URL,
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json'
    }),
    body: (params) => ({
      connection: {
        host: params.host || 'redis',
        port: parseInt(params.port || '6379'),
        username: params.username || '',
        password: params.password || 'redis',
        db: parseInt(params.db || '0'),
        tls: params.tls
      },
      operation: params.operation,
      key: params.key,
      value: params.value,
      ttl: params.ttl ? parseInt(params.ttl) : undefined,
      options: params.options ? JSON.parse(params.options) : undefined
    })
  },
  directExecution: async (params) => {
    const startTime = Date.now()
    
    try {
      console.log('[Redis Tool] Starting execution with params:', {
        ...params,
        password: '[REDACTED]'
      })

      const requestBody = {
        connection: {
          host: params.host || 'redis',
          port: parseInt(params.port || '6379'),
          username: params.username || '',
          password: params.password || 'redis',
          db: parseInt(params.db || '0'),
          tls: params.tls
        },
        operation: params.operation,
        key: params.key,
        value: params.value,
        ttl: params.ttl ? parseInt(params.ttl) : undefined,
        options: params.options ? JSON.parse(params.options) : undefined
      }

      console.log('[Redis Tool] Making API request to:', API_URL)
      
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      })

      console.log('[Redis Tool] API response status:', response.status)

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[Redis Tool] API error response:', errorText)
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`)
      }

      const result = await response.json()
      console.log('[Redis Tool] API response result:', result)

      return {
        success: true,
        output: {
          result: JSON.stringify(result.data || null),
          metadata: JSON.stringify({
            operation: params.operation,
            key: params.key,
            executionTime: Date.now() - startTime
          })
        }
      }
    } catch (error) {
      console.error('[Redis Tool] Error during execution:', error)
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