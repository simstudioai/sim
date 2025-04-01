import { ToolResponse } from '../types'

export interface RedisConnectionConfig {
  host: string
  port: number
  password?: string
  db?: number
  tls?: boolean
  username?: string
}

export interface RedisQueryParams {
  connection: RedisConnectionConfig
  operation: 'get' | 'set' | 'delete' | 'publish' | 'subscribe' | 'keys' | 'hget' | 'hset' | 'lpush' | 'lrange' | 'sadd' | 'smembers'
  key?: string
  pattern?: string
  value?: any
  ttl?: number
  channel?: string
  message?: any
  options?: {
    timeout?: number
    retry?: number
    maxRetries?: number
  }
}

export interface RedisResponse extends ToolResponse {
  output: {
    result: string
    metadata: string
  }
} 